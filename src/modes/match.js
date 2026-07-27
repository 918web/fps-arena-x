/**
 * MODES \u2014 the match state machine.
 *
 * One class, no three.js, no DOM, no engine context: scores, streaks, deaths,
 * the respawn queue, autobalance, round wins, the kill feed and the win check.
 * Everything the scoreboard shows is computed here, so the gate can play whole
 * matches in node and assert on the outcome.
 *
 * Time is passed in, never read: `tick(dt)` is the only clock. That is what lets
 * a test fast-forward ten minutes in one call, and it is why the respawn queue
 * stores absolute match time rather than a wall-clock stamp.
 */

import {
  MODES, TEAM_LABELS, SCORE,
  modeFor, submodeFor, difficultyFor, killScore, streakScore,
} from './rules.js';

const FEED_MAX = 12;

export class Match {
  /**
   * @param {object} o
   * @param {string} o.mode 'bots' | 'duel' | 'squad'
   * @param {string} [o.submode]
   * @param {string} [o.difficulty] bots mode only
   * @param {number} [o.roundsToWin] relay override for duels
   * @param {number} [o.killLimit] relay override
   * @param {number} [o.timeLimit] relay override
   * @param {() => number} [o.rng] deterministic 0..1 source; only used to break
   *   a perfectly even autobalance tie, never for anything the player can see
   */
  constructor(o) {
    this.mode = modeFor(o.mode);
    this.modeId = this.mode.id;
    this.submode = submodeFor(this.modeId, o.submode);
    this.difficulty = this.mode.difficulty ? difficultyFor(o.difficulty).key : null;
    this.roundsToWin = o.roundsToWin ?? this.mode.roundsToWin;
    this.killLimit = o.killLimit ?? this.mode.killLimit;
    this.timeLimit = o.timeLimit ?? this.mode.timeLimit;
    this.rng = o.rng ?? null;

    this.state = 'warmup';
    this.clock = 0;
    this.round = 1;
    this.winner = null;
    this.endReason = null;

    this.teams = new Map();
    for (const id of this.mode.teams) {
      this.teams.set(id, { id, label: TEAM_LABELS[id] ?? `\u041a\u041e\u041c\u0410\u041d\u0414\u0410 ${id}`, score: 0, kills: 0, captures: 0, rounds: 0 });
    }

    this.players = new Map();
    this.feed = [];
    this._respawns = [];
    this._joinSeq = 0;
  }

  /* ------------------------------------------------------------ lifecycle */

  start() {
    if (this.state === 'over') return this;
    this.state = 'live';
    return this;
  }

  /** Free-standing so the caller can stop a match without inventing a winner. */
  abort(reason = 'aborted') {
    this.state = 'over';
    this.endReason = reason;
    return this;
  }

  /* --------------------------------------------------------------- roster */

  /**
   * @param {object} p
   * @param {string} p.id
   * @param {string} [p.name]
   * @param {number|null} [p.team] null picks the side that needs a body
   * @param {boolean} [p.bot]
   */
  addPlayer(p) {
    if (this.players.has(p.id)) return this.players.get(p.id);
    const team = p.team ?? this.#thinnestTeam();
    if (!this.teams.has(team)) throw new Error(`no team ${team} in ${this.modeId}`);
    const rec = {
      id: p.id,
      name: p.name ?? p.id,
      team,
      bot: !!p.bot,
      kills: 0,
      deaths: 0,
      assists: 0,
      captures: 0,
      score: 0,
      streak: 0,
      bestStreak: 0,
      alive: true,
      respawnAt: null,
      joined: this._joinSeq++,
    };
    this.players.set(p.id, rec);
    return rec;
  }

  removePlayer(id) {
    this._respawns = this._respawns.filter((r) => r.id !== id);
    return this.players.delete(id);
  }

  teamCount(teamId) {
    let n = 0;
    for (const p of this.players.values()) if (p.team === teamId) n += 1;
    return n;
  }

  #thinnestTeam() {
    const ids = [...this.teams.keys()];
    let best = ids[0];
    let bestN = Infinity;
    for (const id of ids) {
      const n = this.teamCount(id);
      if (n < bestN) { best = id; bestN = n; }
    }
    // Perfectly even: alternate rather than always stacking side 0.
    const tied = ids.filter((id) => this.teamCount(id) === bestN);
    if (tied.length > 1) {
      if (this.rng) return tied[Math.min(tied.length - 1, Math.floor(this.rng() * tied.length))];
      return tied[this._joinSeq % tied.length];
    }
    return best;
  }

  /**
   * Who should be moved to even the sides up, or null if they are fine.
   *
   * Only ever suggests a move when a side is TWO players up, because moving
   * someone at a difference of one just swaps which side is short. Bots are
   * moved before humans, and the most recent joiner before a veteran: nobody
   * wants to be switched out of a match they have been carrying.
   */
  balanceHint() {
    if (!this.mode.autobalance) return null;
    const ids = [...this.teams.keys()];
    let big = ids[0];
    let small = ids[0];
    for (const id of ids) {
      if (this.teamCount(id) > this.teamCount(big)) big = id;
      if (this.teamCount(id) < this.teamCount(small)) small = id;
    }
    if (this.teamCount(big) - this.teamCount(small) < 2) return null;
    if (this.teamCount(small) >= this.mode.teamSize) return null;
    const pool = [...this.players.values()].filter((p) => p.team === big);
    pool.sort((a, b) => (a.bot === b.bot ? b.joined - a.joined : a.bot ? -1 : 1));
    const pick = pool[0];
    if (!pick) return null;
    return { playerId: pick.id, from: big, to: small };
  }

  /** Perform the move balanceHint() suggests. Returns the move, or null. */
  applyBalance() {
    const hint = this.balanceHint();
    if (!hint) return null;
    this.players.get(hint.playerId).team = hint.to;
    this.#push({ type: 'balance', playerId: hint.playerId, from: hint.from, to: hint.to });
    return hint;
  }

  /* ---------------------------------------------------------------- kills */

  /**
   * Record a death.
   *
   * @param {object} k
   * @param {string|null} k.killer null for falls, fire and other self-inflicted ends
   * @param {string} k.victim
   * @param {boolean} [k.headshot]
   * @param {string|null} [k.weapon]
   * @returns {object} the feed entry that was created
   */
  registerKill(k) {
    const victim = this.players.get(k.victim);
    if (!victim) throw new Error(`unknown victim ${k.victim}`);
    if (this.state !== 'live') return null;
    const killer = k.killer ? this.players.get(k.killer) ?? null : null;
    const suicide = !killer || killer.id === victim.id;
    const teamKill = !suicide && killer.team === victim.team;

    victim.deaths += 1;
    victim.streak = 0;
    victim.alive = false;
    const delay = this.mode.respawn[victim.bot ? 'bot' : 'player'];
    if (delay !== null && delay !== undefined) {
      victim.respawnAt = this.clock + delay;
      this._respawns.push({ id: victim.id, at: victim.respawnAt });
    } else {
      victim.respawnAt = null;
    }

    let gained = 0;
    if (suicide) {
      victim.score += SCORE.suicide;
      gained = SCORE.suicide;
    } else if (teamKill) {
      killer.score += SCORE.teamKill;
      gained = SCORE.teamKill;
    } else {
      killer.kills += 1;
      killer.streak += 1;
      killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
      const bonus = streakScore(killer.streak);
      gained = killScore({ headshot: !!k.headshot }) + bonus;
      killer.score += gained;
      const team = this.teams.get(killer.team);
      team.kills += 1;
      team.score += SCORE.kill;
    }

    const entry = this.#push({
      type: 'kill',
      killer: killer?.id ?? null,
      killerName: killer?.name ?? null,
      victim: victim.id,
      victimName: victim.name,
      headshot: !!k.headshot,
      weapon: k.weapon ?? null,
      suicide,
      teamKill,
      score: gained,
      streak: killer?.streak ?? 0,
      t: this.clock,
    });

    // A duel is decided a kill at a time; everything else accumulates.
    if (this.modeId === 'duel' && !suicide && !teamKill) this.#endRound(killer.team);
    else this.#checkWin();
    return entry;
  }

  /** An assist is worth recording separately: it is what keeps support play scored. */
  registerAssist(playerId) {
    const p = this.players.get(playerId);
    if (!p || this.state !== 'live') return null;
    p.assists += 1;
    p.score += SCORE.assist;
    return p;
  }

  /* ------------------------------------------------------------ objective */

  /** A flag delivered home. */
  capture(playerId) {
    const p = this.players.get(playerId);
    if (!p || this.state !== 'live') return null;
    p.captures += 1;
    p.score += SCORE.capture;
    const team = this.teams.get(p.team);
    team.captures += 1;
    team.score += SCORE.capture;
    this.#push({ type: 'capture', playerId, name: p.name, team: p.team, t: this.clock });
    this.#checkWin();
    return p;
  }

  /** Flag picked up, flag returned, objective defended \u2014 small, non-winning points. */
  award(playerId, key) {
    const p = this.players.get(playerId);
    const amount = SCORE[key];
    if (!p || amount === undefined || this.state !== 'live') return null;
    p.score += amount;
    return p;
  }

  /* ---------------------------------------------------------------- clock */

  /**
   * Advance the match.
   * @returns {string[]} ids of players whose respawn came due this tick
   */
  tick(dt) {
    if (this.state !== 'live') return [];
    this.clock += dt;
    const due = [];
    if (this._respawns.length) {
      const still = [];
      for (const r of this._respawns) {
        if (r.at <= this.clock) {
          const p = this.players.get(r.id);
          if (p) { p.alive = true; p.respawnAt = null; due.push(p.id); }
        } else still.push(r);
      }
      this._respawns = still;
    }
    this.#checkWin();
    return due;
  }

  timeLeft() {
    if (this.timeLimit === null) return null;
    return Math.max(0, this.timeLimit - this.clock);
  }

  respawnIn(playerId) {
    const p = this.players.get(playerId);
    if (!p || p.respawnAt === null) return null;
    return Math.max(0, p.respawnAt - this.clock);
  }

  /* --------------------------------------------------------------- rounds */

  #endRound(teamId) {
    const team = this.teams.get(teamId);
    team.rounds += 1;
    this.#push({ type: 'round', team: teamId, round: this.round, t: this.clock });
    if (this.roundsToWin !== null && team.rounds >= this.roundsToWin) {
      this.state = 'over';
      this.winner = teamId;
      this.endReason = 'rounds';
      return;
    }
    this.state = 'roundOver';
  }

  /** Start the next round: everyone back up, clock keeps running. */
  nextRound() {
    if (this.state !== 'roundOver') return false;
    this.round += 1;
    this._respawns = [];
    for (const p of this.players.values()) {
      p.alive = true;
      p.respawnAt = null;
      p.streak = 0;
    }
    this.state = 'live';
    return true;
  }

  /* ------------------------------------------------------------ win check */

  #checkWin() {
    if (this.state !== 'live') return;
    if (this.killLimit !== null) {
      for (const t of this.teams.values()) {
        if (t.kills >= this.killLimit) {
          this.state = 'over';
          this.winner = t.id;
          this.endReason = 'killLimit';
          return;
        }
      }
    }
    if (this.submode === 'ctf') {
      for (const t of this.teams.values()) {
        if (t.captures >= 1) {
          this.state = 'over';
          this.winner = t.id;
          this.endReason = 'capture';
          return;
        }
      }
    }
    if (this.timeLimit !== null && this.clock >= this.timeLimit) {
      this.state = 'over';
      this.endReason = 'time';
      const ranked = [...this.teams.values()].sort((a, b) => b.kills - a.kills || b.score - a.score);
      // A drawn match has no winner. Inventing one is worse than admitting it.
      this.winner = ranked.length > 1 && ranked[0].kills === ranked[1].kills ? null : ranked[0].id;
    }
  }

  /**
   * Bots mode ends when the garrison is gone; only the mode system knows how
   * many are left, so it reports in rather than the match guessing.
   */
  fieldCleared() {
    if (this.state !== 'live') return;
    this.state = 'over';
    this.winner = 0;
    this.endReason = 'cleared';
  }

  playerDown() {
    if (this.state !== 'live' || this.modeId !== 'bots') return;
    if (this.submode !== 'dm') return;
    this.state = 'over';
    this.winner = 1;
    this.endReason = 'down';
  }

  /* ------------------------------------------------------------- readouts */

  standings() {
    return [...this.players.values()].sort(
      (a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths || a.joined - b.joined
    );
  }

  /** Best player of the match, or null before anyone has done anything. */
  mvp() {
    const top = this.standings()[0];
    return top && top.score > 0 ? top : null;
  }

  teamStandings() {
    return [...this.teams.values()].sort((a, b) => b.kills - a.kills || b.score - a.score);
  }

  /** Everything the HUD and the results screen need, in one plain object. */
  snapshot() {
    const mvp = this.mvp();
    return {
      mode: this.modeId,
      label: this.mode.label,
      submode: this.submode,
      difficulty: this.difficulty,
      state: this.state,
      round: this.round,
      roundsToWin: this.roundsToWin,
      clock: this.clock,
      timeLeft: this.timeLeft(),
      killLimit: this.killLimit,
      teams: this.teamStandings().map((t) => ({ ...t })),
      players: this.players.size,
      winner: this.winner,
      endReason: this.endReason,
      mvp: mvp ? { id: mvp.id, name: mvp.name, score: mvp.score, kills: mvp.kills } : null,
      feed: this.feed.slice(-5),
    };
  }

  #push(entry) {
    this.feed.push(entry);
    if (this.feed.length > FEED_MAX) this.feed.shift();
    return entry;
  }
}

/** Convenience for the mode system and the tests. */
export function newMatch(o) {
  return new Match(o).start();
}

export { MODES };
