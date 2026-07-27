/**
 * ARSENAL — weapon data for the FPS Arena loadout, expressed in the base
 * engine's own schema (see src/weapons/defs.js).
 *
 * Every number here is either
 *   a) ported from FPS Arena's `WEAPON_STATS` (magazine, cadence, muzzle
 *      velocity, muzzle energy, ADS time, weight, zero distance), or
 *   b) derived from it, because this engine models things FPS Arena did not:
 *      per-shot deterministic recoil patterns, spread cones in degrees,
 *      viewmodel poses solved from the bore axis, drag coefficients.
 *
 * DAMAGE IS DERIVED, NOT COPIED. FPS Arena used a `baseDamage` multiplier
 * against a 100 HP player with region multipliers applied later; this engine
 * wants hitpoints at the muzzle plus a `dropoff` factor. The conversion is
 *
 *   damage = round(26 * baseDamage)      (26 HP == FPS Arena's 1.0 multiplier)
 *
 * which keeps the whole roster's relative lethality intact: АКМ 34, M416 22,
 * SCAR-H 39, СВД 83, Desert Eagle 47, and the M870's nine pellets 9 each.
 *
 * POSES. The base engine solves the hip pose from the bore axis rather than
 * from where the optic lands (the long comment in src/weapons/defs.js explains
 * why). Rather than re-deriving nine of them by hand, each weapon inherits a
 * class archetype and offsets it by the difference in its own bore height and
 * receiver length, which is what `poseFor()` does.
 */

export const CLASS_ARCHETYPES = {
  /** Shouldered rifle, bore 75 mm over the grip web. Matches the base M4A1. */
  rifle: {
    bore: 0.075,
    hipPos: [0.118, -0.185, -0.3],
    hipRot: [-0.05, 0.081, -0.135],
    sprintPos: [0.09, -0.262, -0.275],
    sprintRot: [-0.4, 0.6, 0.2],
    lowReadyPos: [0.112, -0.28, -0.289],
    lowReadyRot: [-0.46, 0.125, -0.09],
    adsCant: [0, 0, 0.004],
    eyeRelief: 0.115,
  },
  /** Compact stocked SMG — held closer, less bore offset. */
  smg: {
    bore: 0.071,
    hipPos: [0.111, -0.163, -0.288],
    hipRot: [-0.05, 0.072, -0.131],
    sprintPos: [0.088, -0.24, -0.262],
    sprintRot: [-0.38, 0.58, 0.19],
    lowReadyPos: [0.108, -0.252, -0.276],
    lowReadyRot: [-0.44, 0.125, -0.085],
    adsCant: [0, 0, 0.005],
    eyeRelief: 0.104,
  },
  /** Marksman rifle: longer receiver, heavier, sits a shade further out. */
  dmr: {
    bore: 0.079,
    hipPos: [0.122, -0.19, -0.318],
    hipRot: [-0.048, 0.079, -0.128],
    sprintPos: [0.094, -0.268, -0.29],
    sprintRot: [-0.41, 0.6, 0.2],
    lowReadyPos: [0.116, -0.288, -0.305],
    lowReadyRot: [-0.46, 0.125, -0.09],
    adsCant: [0, 0, 0.003],
    eyeRelief: 0.096,
  },
  /** Pump shotgun: bore low, weapon carried nearer the chest. */
  shotgun: {
    bore: 0.073,
    hipPos: [0.115, -0.178, -0.292],
    hipRot: [-0.052, 0.084, -0.14],
    sprintPos: [0.09, -0.256, -0.27],
    sprintRot: [-0.42, 0.58, 0.21],
    lowReadyPos: [0.11, -0.276, -0.284],
    lowReadyRot: [-0.47, 0.13, -0.095],
    adsCant: [0, 0, 0.006],
    eyeRelief: 0.108,
  },
  /** Handgun: held out on the arms, ADS is most of an arm's length. */
  pistol: {
    bore: 0.028,
    hipPos: [0.115, -0.15, -0.34],
    hipRot: [-0.05, 0.066, -0.115],
    sprintPos: [0.09, -0.25, -0.28],
    sprintRot: [-0.42, 0.5, 0.14],
    lowReadyPos: [0.1, -0.26, -0.32],
    lowReadyRot: [-0.44, 0.105, -0.07],
    adsCant: [0, 0, 0.003],
    eyeRelief: 0.34,
  },
};

/**
 * Build the pose block for a weapon from its class archetype.
 *
 * @param {keyof CLASS_ARCHETYPES} klass
 * @param {{ reach?: number, drop?: number, relief?: number }} [tweak]
 *   reach  metres to push the weapon further from the eye (heavier/longer guns)
 *   drop   metres to lower the hip pose (muzzle-heavy guns ride lower)
 *   relief override for ADS eye relief (long eye relief optics need more)
 */
export function poseFor(klass, tweak = {}) {
  const a = CLASS_ARCHETYPES[klass];
  if (!a) throw new Error(`unknown weapon class "${klass}"`);
  const reach = tweak.reach ?? 0;
  const drop = tweak.drop ?? 0;
  const off = (p) => [p[0], p[1] - drop, p[2] - reach];
  return {
    hipPos: off(a.hipPos),
    hipRot: [...a.hipRot],
    sprintPos: off(a.sprintPos),
    sprintRot: [...a.sprintRot],
    lowReadyPos: off(a.lowReadyPos),
    lowReadyRot: [...a.lowReadyRot],
    adsCant: [...a.adsCant],
    eyeRelief: tweak.relief ?? a.eyeRelief,
    bore: a.bore,
  };
}

/**
 * Recoil block generator.
 *
 * FPS Arena stored recoil as two scalars (`recoilVert`, `recoilHoriz`) in
 * radians of camera kick per shot. This engine wants a learnable pattern, so
 * the scalars become the pattern's amplitude and everything else — viewmodel
 * kick, spring frequency, climb shape — scales off cadence and weight, which is
 * how a heavier, slower gun ends up feeling different from a light fast one.
 */
function recoilFrom({ vert, horiz, rpm, weight, seed, magSize, climb, drift }) {
  const cadence = rpm / 600; // 1.0 at 600 rpm
  return {
    pitch: vert * 0.42,
    yaw: horiz * 0.42,
    kickBack: 0.0125 + vert * 0.24,
    kickUp: 0.0035 + vert * 0.14,
    roll: 0.014 + horiz * 1.6,
    punch: 0.18 + vert * 4.2,
    // Light, fast weapons oscillate quickly; heavy ones thump.
    freq: Math.max(5.2, 12.4 - weight * 1.15) * (0.85 + cadence * 0.2),
    damping: 0.38 + Math.min(0.14, weight * 0.02),
    patternLength: Math.max(8, Math.min(36, magSize)),
    patternSeed: seed,
    climbShape: climb,
    drift,
  };
}

/**
 * The roster. `slot` mirrors FPS Arena's carry slots (1 pistol / 2 rifle /
 * 3 special) so the same 1/2/3 cycling works; `mounts` lists which attachment
 * rails the weapon physically has (see attachments.js).
 */
export const ARSENAL_DEFS = {
  /* ------------------------------------------------------------------ АКМ */
  akm: {
    id: 'akm',
    label: 'АКМ',
    labelLatin: 'AKM',
    class: 'rifle',
    slot: 'rifle',
    family: 'ak',
    caliber: '7.62x39',
    rpm: 600,
    modes: ['auto', 'semi'],
    burstCount: 3,
    burstRpm: 700,
    burstDelay: 0.17,
    magSize: 30,
    reserve: 180,
    muzzleVelocity: 715,
    muzzleEnergy: 2010,
    damage: 34,
    penetration: 1.15,
    dropoff: 0.7,
    maxRange: 400,
    dragK: 0.3,
    tracerEvery: 3,
    zeroDist: 100,
    weight: 3.6,
    spreadHip: 2.45,
    spreadAds: 0.3,
    spreadPerShot: 0.36,
    spreadMax: 4.0,
    spreadDecay: 3.2,
    recoil: recoilFrom({
      vert: 0.024, horiz: 0.007, rpm: 600, weight: 3.6, seed: 0xa17b21,
      magSize: 30, climb: [1.5, 1.34, 1.18, 1.06, 1.0], drift: 0.7,
    }),
    adsTime: 0.32,
    adsFov: 0.74,
    viewFov: 0.86,
    reloadTac: 2.5,
    reloadEmpty: 3.1,
    inspectTime: 3.3,
    drawTime: 0.66,
    holsterTime: 0.42,
    swayScale: 1.05,
    bobScale: 1.0,
    magLen: 0.226,
    mounts: ['optic', 'muzzle', 'tactical', 'underbarrel', 'magazine'],
    ...poseFor('rifle', { reach: 0.004 }),
  },

  /* ---------------------------------------------------------------- АК-74 */
  ak74: {
    id: 'ak74',
    label: 'АК-74',
    labelLatin: 'AK-74',
    class: 'rifle',
    slot: 'rifle',
    family: 'ak',
    caliber: '5.45x39',
    rpm: 652,
    modes: ['auto', 'semi'],
    burstCount: 3,
    burstRpm: 760,
    burstDelay: 0.16,
    magSize: 30,
    reserve: 210,
    muzzleVelocity: 900,
    muzzleEnergy: 1390,
    damage: 26,
    penetration: 0.95,
    dropoff: 0.62,
    maxRange: 430,
    dragK: 0.27,
    tracerEvery: 3,
    zeroDist: 100,
    weight: 3.3,
    spreadHip: 2.2,
    spreadAds: 0.26,
    spreadPerShot: 0.31,
    spreadMax: 3.6,
    spreadDecay: 3.5,
    recoil: recoilFrom({
      vert: 0.02, horiz: 0.006, rpm: 652, weight: 3.3, seed: 0x74a574,
      magSize: 30, climb: [1.4, 1.26, 1.12, 1.04, 1.0], drift: 0.62,
    }),
    adsTime: 0.3,
    adsFov: 0.74,
    viewFov: 0.86,
    reloadTac: 2.4,
    reloadEmpty: 3.0,
    inspectTime: 3.2,
    drawTime: 0.64,
    holsterTime: 0.4,
    swayScale: 1.0,
    bobScale: 0.98,
    magLen: 0.218,
    mounts: ['optic', 'muzzle', 'tactical', 'underbarrel', 'magazine'],
    ...poseFor('rifle'),
  },

  /* ----------------------------------------------------------------- M416 */
  m416: {
    id: 'm416',
    label: 'M416',
    labelLatin: 'M416',
    class: 'rifle',
    slot: 'rifle',
    family: 'ar',
    caliber: '5.56x45',
    rpm: 706,
    modes: ['auto', 'burst', 'semi'],
    burstCount: 3,
    burstRpm: 900,
    burstDelay: 0.15,
    magSize: 30,
    reserve: 210,
    muzzleVelocity: 880,
    muzzleEnergy: 1796,
    damage: 22,
    penetration: 1.0,
    dropoff: 0.6,
    maxRange: 420,
    dragK: 0.28,
    tracerEvery: 3,
    zeroDist: 100,
    weight: 3.4,
    spreadHip: 2.0,
    spreadAds: 0.23,
    spreadPerShot: 0.28,
    spreadMax: 3.3,
    spreadDecay: 3.8,
    recoil: recoilFrom({
      vert: 0.017, horiz: 0.0055, rpm: 706, weight: 3.4, seed: 0x416ab3,
      magSize: 30, climb: [1.32, 1.2, 1.1, 1.02, 1.0], drift: 0.55,
    }),
    adsTime: 0.27,
    adsFov: 0.74,
    viewFov: 0.86,
    reloadTac: 2.2,
    reloadEmpty: 2.9,
    inspectTime: 3.2,
    drawTime: 0.62,
    holsterTime: 0.4,
    swayScale: 0.98,
    bobScale: 0.96,
    magLen: 0.212,
    mounts: ['optic', 'muzzle', 'tactical', 'underbarrel', 'magazine'],
    ...poseFor('rifle'),
  },

  /* --------------------------------------------------------------- SCAR-H */
  scar: {
    id: 'scar',
    label: 'SCAR-H',
    labelLatin: 'SCAR-H',
    class: 'rifle',
    slot: 'rifle',
    family: 'scar',
    caliber: '7.62x51',
    rpm: 571,
    modes: ['auto', 'semi'],
    burstCount: 2,
    burstRpm: 620,
    burstDelay: 0.18,
    magSize: 20,
    reserve: 140,
    muzzleVelocity: 870,
    muzzleEnergy: 3400,
    damage: 39,
    penetration: 1.45,
    dropoff: 0.78,
    maxRange: 520,
    dragK: 0.24,
    tracerEvery: 2,
    zeroDist: 100,
    weight: 3.8,
    spreadHip: 2.6,
    spreadAds: 0.28,
    spreadPerShot: 0.44,
    spreadMax: 4.3,
    spreadDecay: 3.0,
    recoil: recoilFrom({
      vert: 0.03, horiz: 0.0085, rpm: 571, weight: 3.8, seed: 0x5ca4f1,
      magSize: 20, climb: [1.55, 1.4, 1.22, 1.1, 1.0], drift: 0.8,
    }),
    adsTime: 0.34,
    adsFov: 0.72,
    viewFov: 0.85,
    reloadTac: 2.6,
    reloadEmpty: 3.3,
    inspectTime: 3.4,
    drawTime: 0.7,
    holsterTime: 0.46,
    swayScale: 1.12,
    bobScale: 1.05,
    magLen: 0.238,
    mounts: ['optic', 'muzzle', 'tactical', 'underbarrel', 'magazine'],
    ...poseFor('rifle', { reach: 0.008, drop: 0.004 }),
  },

  /* ------------------------------------------------------------------ СВД */
  svd: {
    id: 'svd',
    label: 'СВД',
    labelLatin: 'SVD',
    class: 'dmr',
    slot: 'rifle',
    family: 'svd',
    caliber: '7.62x54R',
    rpm: 176,
    modes: ['semi'],
    burstCount: 1,
    burstRpm: 176,
    burstDelay: 0.2,
    magSize: 10,
    reserve: 80,
    muzzleVelocity: 830,
    muzzleEnergy: 4090,
    damage: 83,
    penetration: 1.9,
    dropoff: 0.9,
    maxRange: 900,
    dragK: 0.18,
    tracerEvery: 1,
    zeroDist: 300,
    weight: 4.3,
    /** Breath hold: ADS spread is multiplied by this while Shift is held. */
    breathHold: { spread: 0.35, swayScale: 0.18, duration: 5.5, recover: 7.0 },
    spreadHip: 3.4,
    spreadAds: 0.09,
    spreadPerShot: 0.9,
    spreadMax: 5.2,
    spreadDecay: 2.2,
    recoil: recoilFrom({
      vert: 0.052, horiz: 0.009, rpm: 176, weight: 4.3, seed: 0x5bd10c,
      magSize: 10, climb: [1.0], drift: 0.35,
    }),
    adsTime: 0.42,
    adsFov: 0.52,
    viewFov: 0.84,
    reloadTac: 2.9,
    reloadEmpty: 3.6,
    inspectTime: 3.6,
    drawTime: 0.78,
    holsterTime: 0.5,
    swayScale: 1.25,
    bobScale: 1.1,
    magLen: 0.196,
    defaultOptic: 'pso4x',
    mounts: ['optic', 'muzzle', 'tactical', 'underbarrel', 'magazine'],
    ...poseFor('dmr', { reach: 0.012, relief: 0.09 }),
  },

  /* ------------------------------------------------------------------ MP5 */
  mp5: {
    id: 'mp5',
    label: 'MP5',
    labelLatin: 'MP5',
    class: 'smg',
    slot: 'special',
    family: 'mp5',
    caliber: '9x19',
    rpm: 800,
    modes: ['auto', 'burst', 'semi'],
    burstCount: 3,
    burstRpm: 900,
    burstDelay: 0.14,
    magSize: 30,
    reserve: 210,
    muzzleVelocity: 400,
    muzzleEnergy: 620,
    damage: 17,
    penetration: 0.45,
    dropoff: 0.46,
    maxRange: 220,
    dragK: 0.42,
    tracerEvery: 4,
    zeroDist: 50,
    weight: 2.5,
    spreadHip: 2.3,
    spreadAds: 0.36,
    spreadPerShot: 0.22,
    spreadMax: 3.7,
    spreadDecay: 4.6,
    recoil: recoilFrom({
      vert: 0.013, horiz: 0.005, rpm: 800, weight: 2.5, seed: 0x9e5c05,
      magSize: 30, climb: [1.26, 1.14, 1.06, 1.0], drift: 0.9,
    }),
    adsTime: 0.22,
    adsFov: 0.78,
    viewFov: 0.88,
    reloadTac: 2.1,
    reloadEmpty: 2.7,
    inspectTime: 2.9,
    drawTime: 0.52,
    holsterTime: 0.34,
    swayScale: 0.9,
    bobScale: 0.94,
    magLen: 0.2,
    mounts: ['optic', 'muzzle', 'tactical', 'underbarrel', 'magazine'],
    ...poseFor('smg'),
  },

  /* ----------------------------------------------------------------- M870 */
  m870: {
    id: 'm870',
    label: 'M870',
    labelLatin: 'M870',
    class: 'shotgun',
    slot: 'special',
    family: 'pump',
    caliber: '12 gauge',
    rpm: 70,
    modes: ['pump'],
    burstCount: 1,
    burstRpm: 70,
    burstDelay: 0.2,
    magSize: 6,
    reserve: 36,
    muzzleVelocity: 400,
    muzzleEnergy: 700,
    /** Nine pellets, each doing `damage`; the cone is `pelletSpread` radians. */
    pellets: 9,
    pelletSpread: 0.055,
    // 12 x 9 = 108 HP at contact: a centred load kills, a clipped one does not.
    damage: 12,
    penetration: 0.3,
    dropoff: 1.6,
    maxRange: 60,
    dragK: 0.9,
    tracerEvery: 0,
    zeroDist: 20,
    weight: 3.6,
    /** Shell-by-shell reload: the animation loops per round. */
    shellReload: true,
    spreadHip: 1.4,
    spreadAds: 0.9,
    spreadPerShot: 0.6,
    spreadMax: 3.0,
    spreadDecay: 2.6,
    recoil: recoilFrom({
      vert: 0.12, horiz: 0.018, rpm: 70, weight: 3.6, seed: 0x870bad,
      magSize: 8, climb: [1.0], drift: 0.5,
    }),
    adsTime: 0.3,
    adsFov: 0.86,
    viewFov: 0.9,
    reloadTac: 0.62,
    reloadEmpty: 0.62,
    inspectTime: 3.0,
    drawTime: 0.6,
    holsterTime: 0.4,
    swayScale: 1.1,
    bobScale: 1.06,
    magLen: 0.0,
    mounts: ['optic', 'tactical', 'underbarrel'],
    ...poseFor('shotgun'),
  },

  /* ------------------------------------------------------------- Glock-18 */
  glock18: {
    id: 'glock18',
    label: 'Glock-18',
    labelLatin: 'Glock-18',
    class: 'pistol',
    slot: 'pistol',
    family: 'glock',
    caliber: '9x19',
    /** The 18 is select-fire: 500 rpm on semi, 1200 rpm on its auto sear. */
    rpm: 500,
    autoRpm: 1200,
    modes: ['semi', 'auto'],
    burstCount: 2,
    burstRpm: 1200,
    burstDelay: 0.12,
    magSize: 17,
    reserve: 85,
    muzzleVelocity: 375,
    muzzleEnergy: 520,
    damage: 18,
    penetration: 0.35,
    dropoff: 0.42,
    maxRange: 160,
    dragK: 0.46,
    tracerEvery: 5,
    zeroDist: 25,
    weight: 0.9,
    spreadHip: 2.9,
    spreadAds: 0.46,
    spreadPerShot: 0.4,
    spreadMax: 4.6,
    spreadDecay: 5.4,
    recoil: recoilFrom({
      vert: 0.022, horiz: 0.0065, rpm: 500, weight: 0.9, seed: 0x18c10c,
      magSize: 17, climb: [1.0], drift: 1.15,
    }),
    adsTime: 0.15,
    adsFov: 0.86,
    viewFov: 0.92,
    reloadTac: 1.7,
    reloadEmpty: 2.2,
    inspectTime: 2.6,
    drawTime: 0.4,
    holsterTime: 0.28,
    swayScale: 1.15,
    bobScale: 1.1,
    magLen: 0.108,
    mounts: ['optic', 'muzzle', 'tactical'],
    ...poseFor('pistol'),
  },

  /* --------------------------------------------------------- Desert Eagle */
  deagle: {
    id: 'deagle',
    label: 'Desert Eagle',
    labelLatin: 'Desert Eagle',
    class: 'pistol',
    slot: 'pistol',
    family: 'deagle',
    caliber: '.50 AE',
    rpm: 214,
    modes: ['semi'],
    burstCount: 1,
    burstRpm: 214,
    burstDelay: 0.2,
    magSize: 9,
    reserve: 45,
    muzzleVelocity: 470,
    muzzleEnergy: 1900,
    damage: 47,
    penetration: 0.8,
    dropoff: 0.66,
    maxRange: 220,
    dragK: 0.38,
    tracerEvery: 2,
    zeroDist: 35,
    weight: 2.0,
    spreadHip: 3.3,
    spreadAds: 0.4,
    spreadPerShot: 1.0,
    spreadMax: 5.4,
    spreadDecay: 4.0,
    recoil: recoilFrom({
      vert: 0.055, horiz: 0.013, rpm: 214, weight: 2.0, seed: 0xde5031,
      magSize: 9, climb: [1.0], drift: 0.9,
    }),
    adsTime: 0.22,
    adsFov: 0.84,
    viewFov: 0.9,
    reloadTac: 2.0,
    reloadEmpty: 2.5,
    inspectTime: 2.8,
    drawTime: 0.46,
    holsterTime: 0.3,
    swayScale: 1.2,
    bobScale: 1.12,
    magLen: 0.114,
    mounts: ['optic', 'muzzle', 'tactical'],
    ...poseFor('pistol', { reach: 0.006 }),
  },
};

/** Carry slots, mirroring FPS Arena's 1 / 2 / 3 keys. */
export const SLOTS = ['pistol', 'rifle', 'special'];

/** Ids in a stable display order (used by the gunsmith board and the HUD). */
export const ARSENAL_ORDER = [
  'akm',
  'ak74',
  'm416',
  'scar',
  'svd',
  'mp5',
  'm870',
  'glock18',
  'deagle',
];

/** Every weapon in a given carry slot. */
export function weaponsInSlot(slot) {
  return ARSENAL_ORDER.filter((id) => ARSENAL_DEFS[id].slot === slot);
}

/**
 * Cadence in seconds between shots, honouring the Glock's auto sear.
 * @param {object} def
 * @param {string} mode current fire mode
 */
export function cycleTime(def, mode) {
  const rpm = mode === 'auto' && def.autoRpm ? def.autoRpm : def.rpm;
  return 60 / rpm;
}

/**
 * Damage at a distance. `dropoff` is the fraction of muzzle damage lost by
 * `maxRange`; a shotgun's 1.6 means it is empty well before its cone is.
 */
export function damageAt(def, metres) {
  const t = Math.min(1, Math.max(0, metres / def.maxRange));
  const falloff = 1 - def.dropoff * t * t;
  return Math.max(def.damage * 0.12, def.damage * falloff);
}
