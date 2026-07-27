/**
 * MODES GATE \u2014 step 5.
 *
 * Plays whole matches in node. The rules and the match state machine are pure on
 * purpose, so nothing here needs a GPU, a canvas or a running engine; the
 * subsystem itself is checked by reading it, since spawning agents needs three.
 *
 *   node tools/verify-modes.mjs
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIDTH = 60;

let passed = 0;
const failures = [];
let current = '';

function group(name) {
  current = name;
  console.log(`\n${name}`);
}

function check(label, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${label}`);
  } catch (err) {
    failures.push(`${current} / ${label}: ${err.message}`);
    console.log(`  x ${label}`);
    console.log(`      ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const R = await load('src/modes/rules.js');
const M = await load('src/modes/match.js');

/** A fresh match with N bots on side 1, already live. */
function seed(o, bots = 0) {
  const m = new M.Match(o).start();
  m.addPlayer({ id: 'you', name: '\u0412\u042b', team: 0 });
  for (let i = 0; i < bots; i++) m.addPlayer({ id: `b${i}`, team: 1, bot: true });
  return m;
}

/* ============================================================ rules ===== */

group('rules: the tables hold together');

check('the rule set validates itself', () => {
  assert(R.validateRules() === true, 'validateRules did not pass');
});

check('three modes, in the order the menu shows them', () => {
  assert(R.MODE_ORDER.join() === 'bots,duel,squad', `order is ${R.MODE_ORDER.join()}`);
  for (const id of R.MODE_ORDER) assert(R.MODES[id].id === id, `${id} is missing`);
});

check('the garrison is sixty strong, and difficulty scales it', () => {
  assert(R.botForce('normal').total === 60, `normal is ${R.botForce('normal').total}`);
  assert(R.botForce('easy').total < 60, 'easy should send fewer');
  assert(R.botForce('hard').total > 60, 'hard should send more');
  assert(R.botForce('normal').waves.length === 4, 'four waves');
});

check('easy bots are worse than hard bots on every axis', () => {
  for (const axis of R.INVERTED_AXES) {
    assert(R.DIFFICULTIES.easy[axis] > R.DIFFICULTIES.hard[axis], `${axis} is not inverted`);
  }
  for (const axis of R.DIRECT_AXES) {
    assert(R.DIFFICULTIES.easy[axis] < R.DIFFICULTIES.hard[axis], `${axis} is not direct`);
  }
});

check('an unknown difficulty falls back instead of throwing', () => {
  assert(R.difficultyFor('impossible').key === 'normal', 'no fallback');
  assert(R.difficultyFor(undefined).key === 'normal', 'no fallback for undefined');
});

check('an unknown mode is refused loudly', () => {
  let threw = false;
  try { R.modeFor('battleroyale'); } catch { threw = true; }
  assert(threw, 'modeFor accepted a mode that does not exist');
});

check('difficulty scaling never mutates the template', () => {
  const base = { aimError: 1, fireDelay: 1, reactionTime: 0.4, leadFactor: 0.6, aggression: 0.8 };
  const out = R.applyDifficulty(base, 'hard');
  assert(base.aimError === 1, 'the base template was written to');
  assert(out.aimError < 1, 'hard bots should aim better');
  assert(out.health === 125, `hard health is ${out.health}`);
  assert(out.leadFactor <= 1, 'lead factor must stay clamped');
  assert(R.applyDifficulty(base, 'easy').aggression <= 1.2, 'aggression must stay clamped');
});

check('the objective is worth more than a kill', () => {
  assert(R.SCORE.capture > R.SCORE.kill * 4, 'a capture should be worth carrying a flag for');
  assert(R.SCORE.headshotBonus > 0, 'headshots should pay');
  assert(R.SCORE.suicide < 0 && R.SCORE.teamKill < 0, 'penalties must be negative');
  assert(R.killScore({ headshot: true }) === R.SCORE.kill + R.SCORE.headshotBonus, 'headshot maths');
  assert(R.streakScore(3) === 25 && R.streakScore(4) === 0 && R.streakScore(6) === 50, 'streak steps');
});

check('roles rotate so a wave does not move as one blob', () => {
  const seen = new Set();
  for (let i = 0; i < 10; i++) seen.add(R.roleFor(i));
  assert(seen.size >= 4, `only ${seen.size} roles in ten bots`);
});

/* ===================================================== bots: objective == */

group('match: one player against the garrison');

check('carrying the flag home wins the match', () => {
  const m = seed({ mode: 'bots', submode: 'ctf' }, 3);
  m.capture('you');
  assert(m.state === 'over', `state is ${m.state}`);
  assert(m.winner === 0, `winner is ${m.winner}`);
  assert(m.endReason === 'capture', `reason is ${m.endReason}`);
  assert(m.players.get('you').score >= R.SCORE.capture, 'the capture was not paid for');
});

check('clearing the field wins deathmatch', () => {
  const m = seed({ mode: 'bots', submode: 'dm' }, 2);
  m.registerKill({ killer: 'you', victim: 'b0' });
  m.registerKill({ killer: 'you', victim: 'b1' });
  assert(m.state === 'live', 'the match ended on its own without being told');
  m.fieldCleared();
  assert(m.state === 'over' && m.endReason === 'cleared', `${m.state}/${m.endReason}`);
});

check('the garrison does not come back', () => {
  const m = seed({ mode: 'bots', submode: 'dm' }, 1);
  m.registerKill({ killer: 'you', victim: 'b0' });
  const due = m.tick(60);
  assert(!due.includes('b0'), 'a dead bot respawned');
  assert(m.players.get('b0').respawnAt === null, 'a bot was queued for respawn');
});

check('the player does come back, on the clock', () => {
  const m = seed({ mode: 'bots', submode: 'dm' }, 1);
  m.registerKill({ killer: null, victim: 'you' });
  assert(m.players.get('you').alive === false, 'still alive after dying');
  assert(m.tick(5.9).length === 0, 'respawned early');
  assert(m.tick(0.2).includes('you'), 'never respawned');
  assert(m.players.get('you').alive === true, 'came back dead');
});

check('nothing scores once the match is over', () => {
  const m = seed({ mode: 'bots', submode: 'ctf' }, 1);
  m.capture('you');
  const before = m.players.get('you').score;
  assert(m.registerKill({ killer: 'you', victim: 'b0' }) === null, 'a kill landed after the end');
  assert(m.players.get('you').score === before, 'the score moved after the end');
});

/* =========================================================== duel ====== */

group('match: the duel is best of five');

check('one kill takes one round, not the match', () => {
  const m = seed({ mode: 'duel' });
  m.addPlayer({ id: 'rival', team: 1 });
  m.registerKill({ killer: 'you', victim: 'rival' });
  assert(m.state === 'roundOver', `state is ${m.state}`);
  assert(m.teams.get(0).rounds === 1, 'the round was not awarded');
  assert(m.winner === null, 'the match ended after one round');
});

check('five round wins take the match', () => {
  const m = seed({ mode: 'duel' });
  m.addPlayer({ id: 'rival', team: 1 });
  for (let i = 0; i < 5; i++) {
    m.registerKill({ killer: 'you', victim: 'rival' });
    m.nextRound();
  }
  assert(m.teams.get(0).rounds === 5, `rounds ${m.teams.get(0).rounds}`);
  assert(m.state === 'over' && m.winner === 0 && m.endReason === 'rounds', `${m.state}/${m.winner}/${m.endReason}`);
  assert(m.round === 5, `round counter is ${m.round}`);
});

check('the relay can override the format', () => {
  const m = seed({ mode: 'duel', roundsToWin: 3 });
  m.addPlayer({ id: 'rival', team: 1 });
  for (let i = 0; i < 3; i++) {
    m.registerKill({ killer: 'you', victim: 'rival' });
    m.nextRound();
  }
  assert(m.state === 'over', 'a three-win match did not end at three');
});

check('the next round only starts from a finished round', () => {
  const m = seed({ mode: 'duel' });
  m.addPlayer({ id: 'rival', team: 1 });
  assert(m.nextRound() === false, 'a live round was restarted');
  m.registerKill({ killer: 'you', victim: 'rival' });
  assert(m.nextRound() === true, 'a finished round would not advance');
  assert(m.players.get('rival').alive === true, 'the loser stayed down');
  assert(m.players.get('you').streak === 0, 'streaks should not cross rounds');
});

/* ========================================================== squad ====== */

group('match: ten against ten');

check('the sides fill to ten each without being told', () => {
  const m = new M.Match({ mode: 'squad' }).start();
  for (let i = 0; i < 20; i++) m.addPlayer({ id: `p${i}`, bot: i > 0 });
  assert(m.teamCount(0) === 10 && m.teamCount(1) === 10, `${m.teamCount(0)}/${m.teamCount(1)}`);
});

check('fifty kills ends it', () => {
  const m = seed({ mode: 'squad' }, 10);
  for (let i = 0; i < 50; i++) {
    m.registerKill({ killer: 'you', victim: `b${i % 10}` });
    m.tick(5.1);
  }
  assert(m.teams.get(0).kills === 50, `kills ${m.teams.get(0).kills}`);
  assert(m.state === 'over' && m.endReason === 'killLimit', `${m.state}/${m.endReason}`);
});

check('the clock ends it, and a tie has no winner', () => {
  const m = seed({ mode: 'squad' }, 2);
  m.tick(600);
  assert(m.state === 'over' && m.endReason === 'time', `${m.state}/${m.endReason}`);
  assert(m.winner === null, `a drawn match named ${m.winner} the winner`);
});

check('the clock ends it in favour of whoever is ahead', () => {
  const m = seed({ mode: 'squad' }, 2);
  m.registerKill({ killer: 'you', victim: 'b0' });
  m.tick(600);
  assert(m.state === 'over' && m.winner === 0, `${m.state}/${m.winner}`);
});

check('autobalance waits for a real imbalance', () => {
  const m = new M.Match({ mode: 'squad' }).start();
  m.addPlayer({ id: 'a', team: 0 });
  m.addPlayer({ id: 'b', team: 0 });
  m.addPlayer({ id: 'c', team: 1 });
  assert(m.balanceHint() === null, 'moved someone at a difference of one');
  m.addPlayer({ id: 'd', team: 0, bot: true });
  const hint = m.balanceHint();
  assert(hint && hint.from === 0 && hint.to === 1, `hint is ${JSON.stringify(hint)}`);
  assert(hint.playerId === 'd', `it should move the bot, not ${hint.playerId}`);
  m.applyBalance();
  assert(Math.abs(m.teamCount(0) - m.teamCount(1)) <= 1, 'still lopsided after balancing');
  assert(m.balanceHint() === null, 'it wants to keep shuffling forever');
});

check('modes without autobalance are left alone', () => {
  const m = seed({ mode: 'bots', submode: 'dm' }, 6);
  assert(m.balanceHint() === null, 'bots mode tried to balance the garrison');
});

/* ======================================================== scoring ====== */

group('match: scoring, streaks and the scoreboard');

check('a headshot pays more than a body shot', () => {
  const m = seed({ mode: 'squad' }, 4);
  m.registerKill({ killer: 'you', victim: 'b0', headshot: true });
  assert(m.players.get('you').score === 150, `score ${m.players.get('you').score}`);
});

check('a streak pays a bonus every third kill', () => {
  const m = seed({ mode: 'squad' }, 8);
  for (let i = 0; i < 3; i++) m.registerKill({ killer: 'you', victim: `b${i}` });
  assert(m.players.get('you').score === 325, `score after three is ${m.players.get('you').score}`);
  for (let i = 3; i < 6; i++) m.registerKill({ killer: 'you', victim: `b${i}` });
  assert(m.players.get('you').score === 675, `score after six is ${m.players.get('you').score}`);
  assert(m.players.get('you').bestStreak === 6, 'best streak not tracked');
});

check('dying resets the streak but keeps the best', () => {
  const m = seed({ mode: 'squad' }, 4);
  m.registerKill({ killer: 'you', victim: 'b0' });
  m.registerKill({ killer: 'you', victim: 'b1' });
  m.registerKill({ killer: 'b2', victim: 'you' });
  assert(m.players.get('you').streak === 0, 'streak survived death');
  assert(m.players.get('you').bestStreak === 2, 'best streak was reset too');
});

check('a fall costs you points and costs nobody else anything', () => {
  const m = seed({ mode: 'squad' }, 2);
  m.registerKill({ killer: null, victim: 'you' });
  assert(m.players.get('you').score === -50, `score ${m.players.get('you').score}`);
  assert(m.teams.get(1).kills === 0, 'the other side was credited with a fall');
  assert(m.teams.get(0).score === 0, 'a suicide moved the team score');
});

check('a team kill is punished and never scores', () => {
  const m = new M.Match({ mode: 'squad' }).start();
  m.addPlayer({ id: 'you', team: 0 });
  m.addPlayer({ id: 'mate', team: 0 });
  m.registerKill({ killer: 'you', victim: 'mate' });
  assert(m.players.get('you').score === -100, `score ${m.players.get('you').score}`);
  assert(m.players.get('you').kills === 0, 'a team kill counted as a kill');
  assert(m.teams.get(0).kills === 0, 'the team was credited');
  assert(m.players.get('mate').deaths === 1, 'the victim did not die');
});

check('the scoreboard ranks by score, then kills, then deaths', () => {
  const m = seed({ mode: 'squad' }, 4);
  m.registerKill({ killer: 'b0', victim: 'you' });
  m.registerKill({ killer: 'b1', victim: 'you' });
  m.registerKill({ killer: 'b1', victim: 'you' });
  const table = m.standings();
  assert(table[0].id === 'b1', `top is ${table[0].id}`);
  assert(table[table.length - 1].id === 'you', 'the corpse is not last');
});

check('the MVP is the best player, and nobody before the first point', () => {
  const m = seed({ mode: 'squad' }, 3);
  assert(m.mvp() === null, 'an empty match already had an MVP');
  m.registerKill({ killer: 'b0', victim: 'you', headshot: true });
  assert(m.mvp().id === 'b0', `mvp is ${m.mvp()?.id}`);
});

check('an assist is worth recording', () => {
  const m = seed({ mode: 'squad' }, 2);
  m.registerAssist('you');
  assert(m.players.get('you').assists === 1, 'assist not counted');
  assert(m.players.get('you').score === R.SCORE.assist, 'assist not paid');
});

check('the kill feed is capped so it cannot grow forever', () => {
  const m = seed({ mode: 'squad' }, 10);
  for (let i = 0; i < 40; i++) {
    m.registerKill({ killer: 'you', victim: `b${i % 10}` });
    m.tick(5.1);
    if (m.state !== 'live') break;
  }
  assert(m.feed.length <= 12, `feed holds ${m.feed.length} rows`);
});

check('the snapshot carries everything a results screen needs', () => {
  const m = seed({ mode: 'squad' }, 4);
  m.registerKill({ killer: 'you', victim: 'b0', headshot: true });
  const s = m.snapshot();
  for (const key of ['mode', 'label', 'state', 'clock', 'timeLeft', 'killLimit', 'teams', 'winner', 'mvp', 'feed']) {
    assert(key in s, `snapshot has no ${key}`);
  }
  assert(s.teams.length === 2, 'both sides must be reported');
  assert(s.feed.length <= 5, 'the snapshot feed should stay short');
  assert(s.mvp.id === 'you', 'mvp missing from the snapshot');
});

check('an unknown victim is a bug, not a shrug', () => {
  const m = seed({ mode: 'squad' }, 1);
  let threw = false;
  try { m.registerKill({ killer: 'you', victim: 'ghost' }); } catch { threw = true; }
  assert(threw, 'a kill on a player who is not in the match was accepted');
});

/* ================================================== subsystem wiring === */

group('modes subsystem: wiring and hygiene');

const SRC = read('src/modes/index.js');

check('it registers as a subsystem the engine can resolve', () => {
  assert(/static id = 'modes'/.test(SRC), 'no static id');
  const deps = SRC.match(/static deps = \[([^\]]+)\]/);
  assert(deps, 'no static deps');
  for (const need of ['ai', 'world', 'ui']) {
    assert(deps[1].includes(`'${need}'`), `${need} is missing from deps`);
  }
});

check('it reaches other subsystems through ctx, never by import', () => {
  const imports = [...SRC.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  for (const spec of imports) {
    const ok = spec === 'three' || spec.startsWith('./');
    assert(ok, `index.js imports ${spec} directly`);
  }
  assert(/ctx\.get\('ai'\)/.test(SRC), 'the ai system is never fetched');
  assert(/peek\('world'\)/.test(SRC), 'the world is never fetched');
});

check('it draws randomness from the seeded engine rng', () => {
  assert(!/Math\.random/.test(SRC), 'Math.random breaks deterministic capture runs');
  assert(/ctx\.rng\.fork\(\)/.test(SRC), 'no forked rng');
});

check('fire rate is DIVIDED by the difficulty multiplier, not multiplied', () => {
  const tuneAt = SRC.indexOf('#tune(agent) {');
  const tune = SRC.slice(tuneAt, SRC.indexOf('aliveBots() {', tuneAt));
  assert(tune.length > 40, 'could not find #tune');
  assert(/fireRate \/= d\.fireMul/.test(tune), 'fireRate must be divided: the base engine counts shots per second, FPS Arena counted seconds per shot');
  assert(/spread \*= d\.accMul/.test(tune), 'accMul scales aim error');
  assert(/agent\.team = 1/.test(tune), 'bots must be on the other side');
});

check('a death is scored exactly once', () => {
  const hits = [...SRC.matchAll(/registerKill\(/g)].length;
  assert(hits === 2, `registerKill is called ${hits} times: expected one for bots and one for the player`);
  const handler = SRC.slice(SRC.indexOf('#onActorDeath(e) {'), SRC.indexOf('#playerDied()'));
  assert(!/killfeed\.push/.test(handler), 'the HUD already draws its own row off actor:death');
});

check('reserves are held back instead of parked on the map', () => {
  assert(/if \(wave\.role === 'reserve'\) this\.reserve\.push/.test(SRC), 'the reserve wave is spawned immediately');
  assert(/#maybeReleaseReserve\(\)/.test(SRC), 'reserves are never released');
});

check('the HUD is updated a few times a second, not every frame', () => {
  assert(/HUD_PERIOD/.test(SRC), 'no HUD throttle');
  const hud = SRC.slice(SRC.indexOf('this._hudTimer -= dt;'), SRC.indexOf('#hud() {'));
  assert(/_hudTimer = HUD_PERIOD/.test(hud), 'the throttle is never rearmed');
});

check('teardown gives back everything it took', () => {
  const d = SRC.slice(SRC.indexOf('dispose() {'));
  assert(/for \(const off of this\._unsubs/.test(d), 'event handlers are left subscribed');
  assert(/res\.dispose\?\.\(\)/.test(d), 'geometries and materials are leaked');
  assert(/scene\.remove\(this\.root\)/.test(d), 'the group is left in the scene');
});

check('the flag lives on constant resources, allocated once', () => {
  const flag = SRC.slice(SRC.indexOf('#buildFlag() {'), SRC.indexOf('#updateFlag(dt) {'));
  const geos = [...flag.matchAll(/new THREE\.[A-Za-z]+Geometry/g)].length;
  assert(geos === 3, `the flag builds ${geos} geometries: pole, cloth and aura is three`);
  assert(/this\._owned\.push/.test(flag), 'the flag resources are not tracked for disposal');
  const upd = SRC.slice(SRC.indexOf('#updateFlag(dt) {'), SRC.indexOf('#dropFlag() {'));
  assert(!/new THREE\./.test(upd), 'the flag allocates every frame');
});

check('dying with the flag drops it where you fell', () => {
  const died = SRC.slice(SRC.indexOf('#playerDied() {'), SRC.indexOf('#respawnPlayer() {'));
  assert(/#dropFlag\(\)/.test(died), 'the flag teleports home with the corpse');
});

/* ========================================================== summary ==== */

console.log(`\n${'-'.repeat(WIDTH)}`);
if (failures.length) {
  console.log(`FAILED \u2014 ${failures.length} of ${passed + failures.length} checks`);
  for (const f of failures) console.log(`  \u00b7 ${f}`);
  process.exit(1);
}
console.log(`all green \u2014 ${passed} mode checks passed`);
