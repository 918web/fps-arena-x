/**
 * MODES \u2014 rules.
 *
 * Pure data and pure functions: no three.js, no DOM, no engine context. That is
 * what lets the test gate import this file in node and interrogate every balance
 * number directly, instead of trusting a comment.
 *
 * Three modes, carried over from FPS Arena:
 *   bots   one player against a finite garrison, capture-the-flag or deathmatch
 *   duel   1v1, first to N round wins
 *   squad  10v10, kill limit or time limit, autobalanced
 */

export const MODE_ORDER = ['bots', 'duel', 'squad'];

/**
 * `respawn` is in seconds. `null` means "does not come back" \u2014 the garrison in
 * bots mode is a finite force on purpose: it is what turns the match into a
 * campaign with a front line instead of an endless fountain of targets.
 */
export const MODES = {
  bots: {
    id: 'bots',
    label: '\u0418\u0413\u0420\u0410 \u0421 \u0411\u041e\u0422\u0410\u041c\u0418',
    eyebrow: '\u0420\u0415\u0416\u0418\u041c 01 \u00b7 \u041f\u041e\u041b\u0418\u0413\u041e\u041d',
    blurb: '\u041e\u0434\u0438\u043d \u043f\u0440\u043e\u0442\u0438\u0432 \u0433\u0430\u0440\u043d\u0438\u0437\u043e\u043d\u0430. \u0417\u0430\u0445\u0432\u0430\u0442 \u0444\u043b\u0430\u0433\u0430 \u0438\u043b\u0438 \u0437\u0430\u0447\u0438\u0441\u0442\u043a\u0430 \u043f\u043e\u043b\u044f.',
    kind: 'solo',
    teams: [0, 1],
    teamSize: 1,
    submodes: ['ctf', 'dm'],
    defaultSubmode: 'ctf',
    difficulty: true,
    killLimit: null,
    timeLimit: null,
    roundsToWin: null,
    respawn: { player: 6, bot: null },
    friendlyFire: false,
    autobalance: false,
  },
  duel: {
    id: 'duel',
    label: '\u041e\u041d\u041b\u0410\u0419\u041d 1\u00d71',
    eyebrow: '\u0420\u0415\u0416\u0418\u041c 02 \u00b7 \u0414\u0423\u042d\u041b\u042c',
    blurb: '\u0424\u043e\u0440\u043c\u0430\u0442 \u0434\u043e 5 \u043f\u043e\u0431\u0435\u0434.',
    kind: 'pvp',
    teams: [0, 1],
    teamSize: 1,
    submodes: ['rounds'],
    defaultSubmode: 'rounds',
    difficulty: false,
    killLimit: null,
    timeLimit: null,
    /**
     * Five, to match the mode-select copy. The relay is authoritative in play:
     * FPS Arena's server ships PVP_MATCH_TARGET=3 and broadcasts `match_target`,
     * so the net layer overrides this per match rather than arguing with it.
     */
    roundsToWin: 5,
    respawn: { player: 3, bot: null },
    friendlyFire: false,
    autobalance: false,
  },
  squad: {
    id: 'squad',
    label: '\u041a\u041e\u041c\u0410\u041d\u0414\u042b 10\u00d710',
    eyebrow: '\u0420\u0415\u0416\u0418\u041c 03 \u00b7 \u041e\u0422\u0420\u042f\u0414',
    blurb: '\u0410\u0432\u0442\u043e\u0431\u0430\u043b\u0430\u043d\u0441, \u043b\u0438\u043c\u0438\u0442 \u0443\u0431\u0438\u0439\u0441\u0442\u0432 \u0438 \u0442\u0430\u0439\u043c\u0435\u0440 \u043c\u0430\u0442\u0447\u0430.',
    kind: 'pvp',
    teams: [0, 1],
    teamSize: 10,
    submodes: ['tdm'],
    defaultSubmode: 'tdm',
    difficulty: false,
    /** Both ported from the FPS Arena relay verbatim. */
    killLimit: 50,
    timeLimit: 600,
    roundsToWin: null,
    respawn: { player: 5, bot: null },
    friendlyFire: false,
    autobalance: true,
  },
};

export const TEAM_LABELS = { 0: '\u0421\u0418\u041d\u0418\u0415', 1: '\u041e\u0420\u0410\u041d\u0416\u0415\u0412\u042b\u0415' };

/* ------------------------------------------------------------- difficulty */

export const DIFFICULTY_ORDER = ['easy', 'normal', 'hard'];

/**
 * Ported from FPS Arena unchanged, including the counter-intuitive part:
 *
 *   accMul  multiplies the bot's aim ERROR, so 1.70 on easy makes it miss MORE.
 *   fireMul multiplies the delay between shots, so 1.40 on easy is SLOWER fire.
 *   reactMul multiplies reaction time, so 1.70 on easy is a slower flinch.
 *
 * leadMul, aggrMul, hpMul and countMul read the intuitive way round: bigger is
 * more dangerous. Mixing the two conventions in one table is a trap, hence the
 * gate check that easy is worse than hard on every single axis.
 */
export const DIFFICULTIES = {
  easy: {
    key: 'easy', label: '\u041b\u0401\u0413\u041a\u041e',
    accMul: 1.70, fireMul: 1.40, reactMul: 1.70,
    leadMul: 0.40, aggrMul: 0.75, hpMul: 0.80, countMul: 0.60,
  },
  normal: {
    key: 'normal', label: '\u041d\u041e\u0420\u041c\u0410',
    accMul: 1.00, fireMul: 1.00, reactMul: 1.00,
    leadMul: 1.00, aggrMul: 1.00, hpMul: 1.00, countMul: 1.00,
  },
  hard: {
    key: 'hard', label: '\u0425\u0410\u0420\u0414\u041a\u041e\u0420',
    accMul: 0.60, fireMul: 0.72, reactMul: 0.55,
    leadMul: 1.40, aggrMul: 1.30, hpMul: 1.25, countMul: 1.20,
  },
};

/** Axes where a BIGGER multiplier means an EASIER bot. */
export const INVERTED_AXES = ['accMul', 'fireMul', 'reactMul'];
/** Axes where a BIGGER multiplier means a HARDER bot. */
export const DIRECT_AXES = ['leadMul', 'aggrMul', 'hpMul', 'countMul'];

/* ------------------------------------------------------------------ waves */

/**
 * The garrison arrives in four waves. Sixty bots at NORMA, scaled by countMul.
 *
 * `spawn` names a spawn ring the mode system resolves against the world's own
 * spawn points; `phase` is the state the agent starts in. Wave 1 starts on
 * ADVANCE rather than ENGAGE so the player gets a few seconds to reach the
 * weapon bench instead of being shot on the spawn pad.
 */
export const WAVES = [
  { n: 1, count: 20, spawn: 'field',   phase: 'advance', role: 'mixed',    stagger: [4.0, 8.0] },
  { n: 2, count: 10, spawn: 'gate',    phase: 'advance', role: 'mixed',    stagger: [0.0, 4.5] },
  { n: 3, count: 12, spawn: 'reserve', phase: 'idle',    role: 'reserve',  stagger: [0.0, 0.0] },
  { n: 4, count: 18, spawn: 'defend',  phase: 'hold',    role: 'defender', stagger: [0.0, 0.0] },
];

/** Reserves are released when the field thins out this far. */
export const RESERVE_RELEASE_AT = 22;

/** Role mix for advancing waves, so they do not move as one blob. */
export const ROLE_MIX = ['flank_left', 'flank_right', 'support', 'assault', 'assault'];

/** Character variants the base engine ships, cycled across the garrison. */
export const BOT_VARIANTS = ['vanguard', 'irregular', 'breacher'];

/* -------------------------------------------------------------------- ctf */

export const CTF = {
  pickupRadius: 2.6,
  deliverRadius: 3.0,
  /** Seconds a dropped flag lies on the ground before it returns home. */
  dropResetTime: 30,
  /** Carrying is a commitment: you move slower and you are visible. */
  carrierSpeedMul: 0.92,
  capturesToWin: 1,
};

/* ------------------------------------------------------------------ score */

export const SCORE = {
  kill: 100,
  headshotBonus: 50,
  assist: 35,
  capture: 500,
  flagPickup: 50,
  flagReturn: 150,
  defend: 75,
  /** Added once per step of three kills without dying. */
  streakStep: 3,
  streakBonus: 25,
  suicide: -50,
  teamKill: -100,
};

/* -------------------------------------------------------------- functions */

export function modeFor(id) {
  const m = MODES[id];
  if (!m) throw new Error(`unknown mode ${id}`);
  return m;
}

export function difficultyFor(key) {
  return DIFFICULTIES[String(key ?? '').toLowerCase()] ?? DIFFICULTIES.normal;
}

export function submodeFor(modeId, submode) {
  const m = modeFor(modeId);
  if (!submode) return m.defaultSubmode;
  return m.submodes.includes(submode) ? submode : m.defaultSubmode;
}

/**
 * Wave sizes for a difficulty. Each wave is rounded on its own so the mix
 * (field / rush / reserve / defenders) stays proportional instead of the
 * rounding error piling up in the last wave.
 */
export function botForce(difficultyKey) {
  const cm = difficultyFor(difficultyKey).countMul;
  const waves = WAVES.map((w) => ({ ...w, count: Math.max(1, Math.round(w.count * cm)) }));
  const total = waves.reduce((n, w) => n + w.count, 0);
  return { waves, total, releaseAt: Math.round(RESERVE_RELEASE_AT * cm) };
}

/**
 * Scale one agent's combat stats by a difficulty. Returns a NEW object; the
 * caller's base template is never touched.
 */
export function applyDifficulty(base, difficultyKey) {
  const d = difficultyFor(difficultyKey);
  return {
    ...base,
    aimError: (base.aimError ?? 1) * d.accMul,
    fireDelay: (base.fireDelay ?? 1) * d.fireMul,
    reactionTime: (base.reactionTime ?? 0.35) * d.reactMul,
    leadFactor: Math.min(1, (base.leadFactor ?? 0.5) * d.leadMul),
    aggression: Math.min(1.2, (base.aggression ?? 0.7) * d.aggrMul),
    health: Math.round(100 * d.hpMul),
    maxHealth: Math.round(100 * d.hpMul),
    difficulty: d.key,
  };
}

/** Role for the i-th advancing bot. */
export function roleFor(i) {
  return ROLE_MIX[i % ROLE_MIX.length];
}

/** Points for one kill, before streak bonuses. */
export function killScore({ headshot = false, teamKill = false, suicide = false } = {}) {
  if (suicide) return SCORE.suicide;
  if (teamKill) return SCORE.teamKill;
  return SCORE.kill + (headshot ? SCORE.headshotBonus : 0);
}

/** Bonus for reaching this streak length, or 0 if it is not a milestone. */
export function streakScore(streak) {
  if (streak <= 0 || streak % SCORE.streakStep !== 0) return 0;
  return SCORE.streakBonus * (streak / SCORE.streakStep);
}

export function respawnDelay(modeId, who = 'player') {
  return modeFor(modeId).respawn[who] ?? null;
}

/**
 * Self-check over the tables above. Called by the gate, and cheap enough to be
 * called at boot: a mode with no way to win is a bug that only shows up after
 * ten minutes of play, which is the worst possible time to find it.
 */
export function validateRules() {
  for (const id of MODE_ORDER) {
    const m = modeFor(id);
    if (m.id !== id) throw new Error(`${id}: id mismatch`);
    if (!m.submodes.length) throw new Error(`${id}: no submodes`);
    if (!m.submodes.includes(m.defaultSubmode)) throw new Error(`${id}: default submode is not in the list`);
    if (m.teams.length !== 2) throw new Error(`${id}: every mode needs two sides`);
    const winnable = m.killLimit !== null || m.timeLimit !== null || m.roundsToWin !== null || m.id === 'bots';
    if (!winnable) throw new Error(`${id}: no win condition`);
    if (m.respawn.player !== null && m.respawn.player <= 0) throw new Error(`${id}: respawn delay must be positive`);
  }
  for (const axis of INVERTED_AXES) {
    if (!(DIFFICULTIES.easy[axis] > DIFFICULTIES.hard[axis])) throw new Error(`difficulty axis ${axis} is not inverted`);
  }
  for (const axis of DIRECT_AXES) {
    if (!(DIFFICULTIES.easy[axis] < DIFFICULTIES.hard[axis])) throw new Error(`difficulty axis ${axis} is not direct`);
  }
  if (botForce('normal').total !== 60) throw new Error('the garrison should be sixty strong at NORMA');
  if (!(CTF.deliverRadius > CTF.pickupRadius * 0.5)) throw new Error('CTF radii are nonsense');
  return true;
}
