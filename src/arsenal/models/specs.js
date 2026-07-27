/**
 * ARSENAL — model specifications.
 *
 * The base engine builds its reference carbine in one file: about fifteen calls
 * into the parts kit, each one fed hand-solved millimetre figures. That file is
 * the quality bar for this project, and copying it nine times would mean nine
 * places to get the same detail wrong.
 *
 * So the geometry is split in two:
 *
 *   specs.js  (this file)  pure numbers and pure functions. No three.js, no
 *                          Assembly, nothing that needs a GPU — which means the
 *                          entire layout of all nine weapons is unit-testable
 *                          in node, including every attachment node position.
 *   build.js               turns one spec into real geometry by mirroring the
 *                          reference call sequence against the parts kit.
 *
 * COORDINATES, copied from the base engine so everything lines up:
 *   -Z points down range (the muzzle is at negative z)
 *   +Y is up; `bore` is the height of the barrel axis above the grip web
 *   +X is right
 * All figures are METRES. A 5 mm mistake is visible in ADS.
 *
 * The `pattern` field selects the receiver architecture in build.js. Seven real
 * architectures cover the roster, which is why an AK does not end up looking
 * like an AR with different numbers:
 *   'ar'     split upper/lower, receiver extension stock, AR magwell
 *   'ak'     riveted receiver, dust cover, gas tube over the barrel, side rail
 *   'battle' SCAR-pattern monolithic upper with a folding side stock
 *   'dmr'    long-barrelled SVD: wood furniture, thumbhole stock, side mount
 *   'smg'    MP5-pattern tubular receiver with a wrap-around handguard
 *   'pump'   tube-fed shotgun with a sliding forend and no detachable magazine
 *   'pistol' slide + polymer or steel frame, no stock, mini reflex mount
 */

/** Every node the weapons system expects a model to publish. */
export const REQUIRED_NODES = [
  'muzzle',
  'chamber',
  'eject',
  'ejectDir',
  'sight',
  'sightAxis',
  'ironSight',
  'gripR',
  'gripL',
  'handguard',
  'magSeat',
  'magDrop',
  'chargeRest',
  'chargePull',
  'boltRest',
  'boltTravel',
  'triggerPivot',
  'triggerPull',
  'selectorPivot',
  'opticGlass',
];

/** Moving parts every model animates. Pumps and pistols swap some of these. */
export const MOVING_PARTS = ['magazine', 'charging', 'bolt', 'trigger', 'selector'];

/**
 * The nine specs.
 *
 * Numbers are anchored to the reference carbine wherever the real weapons agree
 * with it (bore height, rail deck, eye line) and diverge wherever the real
 * weapons do. `zBarrelEnd` minus `zUpperRear` is the receiver-to-muzzle
 * distance, so it is also what makes an SVD feel long in the hands and an MP5
 * feel stubby.
 */
export const MODEL_SPECS = {
  /* ----------------------------------------------------------------- M416 */
  m416: {
    id: 'm416',
    label: 'M416',
    pattern: 'ar',
    fxClass: 'carbine',
    bore: 0.075,
    rUpper: 0.0192,
    railRise: 0.0286,
    zUpperRear: 0.055,
    zUpperFront: -0.145,
    portZ: -0.052,
    zBreech: -0.1,
    zBarrelEnd: -0.452,
    rBarrel: 0.0077,
    rChamber: 0.0112,
    gasAt: -0.3,
    hgZ0: -0.147,
    hgZ1: -0.4,
    hgR: 0.0238,
    hgSides: 8,
    hgSlots: 4,
    handZ: -0.245,
    gripZ: 0.015,
    gripAngle: 0.38,
    stockRear: 0.245,
    muzzleKind: 'brake',
    magZ: -0.058,
    magTilt: 0.08,
    mag: { w: 0.0292, d: 0.0672, len: 0.212, curve: 0.024, segs: 8 },
    opticRise: 0.067,
    opticZ: -0.022,
    shell: { caseLen: 0.0446, rimR: 0.00495 },
    features: ['railedHandguard', 'buis', 'qdSocket', 'slingLoop', 'boltCatch', 'brassDeflector'],
    rollmarks: [
      { x: -0.0149, y: 0.0355, z: -0.031, h: 0.0036 },
      { x: -0.0149, y: 0.0295, z: -0.031, h: 0.0026, pattern: [2, 3, 1, 0, 2, 2, 3, 0, 3, 2] },
    ],
  },

  /* ------------------------------------------------------------------ АКМ */
  akm: {
    id: 'akm',
    label: 'АКМ',
    pattern: 'ak',
    fxClass: 'rifle',
    bore: 0.075,
    rUpper: 0.0198,
    railRise: 0.0262,
    zUpperRear: 0.048,
    zUpperFront: -0.138,
    portZ: -0.044,
    zBreech: -0.096,
    zBarrelEnd: -0.43,
    rBarrel: 0.0082,
    rChamber: 0.0118,
    gasAt: -0.276,
    hgZ0: -0.14,
    hgZ1: -0.322,
    hgR: 0.0252,
    hgSides: 6,
    hgSlots: 0,
    handZ: -0.226,
    gripZ: 0.012,
    gripAngle: 0.44,
    stockRear: 0.258,
    muzzleKind: 'brake',
    magZ: -0.05,
    magTilt: 0.16,
    mag: { w: 0.029, d: 0.069, len: 0.226, curve: 0.036, segs: 9 },
    opticRise: 0.062,
    opticZ: -0.016,
    shell: { caseLen: 0.0388, rimR: 0.00565 },
    features: ['gasTube', 'dustCover', 'sideRail', 'woodFurniture', 'fixedStock', 'slingLoop'],
    rollmarks: [{ x: -0.0155, y: 0.0338, z: -0.026, h: 0.0034, pattern: [3, 1, 2, 3, 0, 2, 3, 1] }],
  },

  /* ---------------------------------------------------------------- АК-74 */
  ak74: {
    id: 'ak74',
    label: 'АК-74',
    pattern: 'ak',
    fxClass: 'rifle',
    bore: 0.075,
    rUpper: 0.0194,
    railRise: 0.0262,
    zUpperRear: 0.048,
    zUpperFront: -0.138,
    portZ: -0.044,
    zBreech: -0.096,
    zBarrelEnd: -0.437,
    rBarrel: 0.0074,
    rChamber: 0.0108,
    gasAt: -0.282,
    hgZ0: -0.14,
    hgZ1: -0.33,
    hgR: 0.0248,
    hgSides: 6,
    hgSlots: 0,
    handZ: -0.23,
    gripZ: 0.012,
    gripAngle: 0.44,
    stockRear: 0.256,
    muzzleKind: 'comp',
    magZ: -0.05,
    magTilt: 0.16,
    mag: { w: 0.0278, d: 0.0662, len: 0.218, curve: 0.03, segs: 9 },
    opticRise: 0.062,
    opticZ: -0.016,
    shell: { caseLen: 0.0398, rimR: 0.00505 },
    features: ['gasTube', 'dustCover', 'sideRail', 'polymerFurniture', 'fixedStock', 'slingLoop'],
    rollmarks: [{ x: -0.0152, y: 0.0338, z: -0.026, h: 0.0032, pattern: [2, 3, 3, 1, 0, 3, 2, 2] }],
  },

  /* --------------------------------------------------------------- SCAR-H */
  scar: {
    id: 'scar',
    label: 'SCAR-H',
    pattern: 'battle',
    fxClass: 'rifle',
    bore: 0.075,
    rUpper: 0.0206,
    railRise: 0.0302,
    zUpperRear: 0.052,
    zUpperFront: -0.152,
    portZ: -0.05,
    zBreech: -0.104,
    zBarrelEnd: -0.47,
    rBarrel: 0.0086,
    rChamber: 0.0124,
    gasAt: -0.31,
    hgZ0: -0.154,
    hgZ1: -0.372,
    hgR: 0.0262,
    hgSides: 8,
    hgSlots: 5,
    handZ: -0.252,
    gripZ: 0.018,
    gripAngle: 0.36,
    stockRear: 0.25,
    muzzleKind: 'a2',
    magZ: -0.062,
    magTilt: 0.06,
    mag: { w: 0.0308, d: 0.0724, len: 0.238, curve: 0.02, segs: 8 },
    opticRise: 0.071,
    opticZ: -0.026,
    shell: { caseLen: 0.0512, rimR: 0.00595 },
    features: [
      'railedHandguard',
      'foldingStock',
      'adjustableCheek',
      'ambiCharging',
      'qdSocket',
      'slingLoop',
    ],
    rollmarks: [{ x: -0.016, y: 0.0362, z: -0.034, h: 0.0034, pattern: [3, 2, 0, 3, 1, 2, 3, 3] }],
  },

  /* ------------------------------------------------------------------ СВД */
  svd: {
    id: 'svd',
    label: 'СВД',
    pattern: 'dmr',
    fxClass: 'rifle',
    bore: 0.079,
    rUpper: 0.0202,
    railRise: 0.0268,
    zUpperRear: 0.062,
    zUpperFront: -0.162,
    portZ: -0.056,
    zBreech: -0.112,
    zBarrelEnd: -0.612,
    rBarrel: 0.0079,
    rChamber: 0.0126,
    gasAt: -0.4,
    hgZ0: -0.166,
    hgZ1: -0.316,
    hgR: 0.0272,
    hgSides: 6,
    hgSlots: 0,
    handZ: -0.24,
    gripZ: 0.02,
    gripAngle: 0.4,
    stockRear: 0.278,
    muzzleKind: 'comp',
    magZ: -0.058,
    magTilt: 0.12,
    mag: { w: 0.0296, d: 0.0742, len: 0.196, curve: 0.026, segs: 6 },
    opticRise: 0.058,
    opticZ: -0.008,
    shell: { caseLen: 0.0535, rimR: 0.0063 },
    features: [
      'gasTube',
      'sideRail',
      'woodFurniture',
      'thumbholeStock',
      'cheekRest',
      'slingLoop',
      'bipodLug',
    ],
    rollmarks: [{ x: -0.0158, y: 0.0352, z: -0.03, h: 0.0032, pattern: [3, 3, 1, 2, 0, 3, 2, 1] }],
  },

  /* ------------------------------------------------------------------ MP5 */
  mp5: {
    id: 'mp5',
    label: 'MP5',
    pattern: 'smg',
    fxClass: 'smg',
    bore: 0.071,
    rUpper: 0.0178,
    railRise: 0.0248,
    zUpperRear: 0.046,
    zUpperFront: -0.118,
    portZ: -0.04,
    zBreech: -0.082,
    zBarrelEnd: -0.292,
    rBarrel: 0.0068,
    rChamber: 0.0098,
    gasAt: null,
    hgZ0: -0.12,
    hgZ1: -0.268,
    hgR: 0.0226,
    hgSides: 8,
    hgSlots: 2,
    handZ: -0.196,
    gripZ: 0.008,
    gripAngle: 0.42,
    stockRear: 0.218,
    muzzleKind: 'trilug',
    magZ: -0.044,
    magTilt: 0.04,
    mag: { w: 0.026, d: 0.0582, len: 0.2, curve: 0.016, segs: 7 },
    opticRise: 0.056,
    opticZ: -0.012,
    shell: { caseLen: 0.0192, rimR: 0.00478 },
    features: [
      'tubularReceiver',
      'wrapHandguard',
      'rollerDelay',
      'collapsingStock',
      'clawMount',
      'slingLoop',
    ],
    rollmarks: [{ x: -0.0138, y: 0.0308, z: -0.022, h: 0.0028, pattern: [2, 2, 3, 0, 1, 3, 2] }],
  },

  /* ----------------------------------------------------------------- M870 */
  m870: {
    id: 'm870',
    label: 'M870',
    pattern: 'pump',
    fxClass: 'shotgun',
    bore: 0.073,
    rUpper: 0.0224,
    railRise: 0.0288,
    zUpperRear: 0.05,
    zUpperFront: -0.132,
    portZ: -0.046,
    zBreech: -0.096,
    zBarrelEnd: -0.53,
    rBarrel: 0.0106,
    rChamber: 0.0142,
    gasAt: null,
    hgZ0: -0.166,
    hgZ1: -0.302,
    hgR: 0.0268,
    hgSides: 8,
    hgSlots: 0,
    handZ: -0.232,
    gripZ: 0.016,
    gripAngle: 0.46,
    stockRear: 0.264,
    muzzleKind: 'none',
    magZ: null,
    magTilt: 0,
    mag: { w: 0, d: 0, len: 0, curve: 0, segs: 0 },
    tubeMag: { r: 0.0128, z0: -0.13, z1: -0.44, drop: 0.0216 },
    opticRise: 0.06,
    opticZ: -0.014,
    shell: { caseLen: 0.0699, rimR: 0.00985 },
    features: [
      'tubeMagazine',
      'slidingForend',
      'actionBars',
      'shellLifter',
      'ventedRib',
      'beadSight',
      'slingLoop',
    ],
    rollmarks: [{ x: -0.017, y: 0.0342, z: -0.024, h: 0.003, pattern: [3, 1, 3, 2, 0, 2, 3] }],
  },

  /* ------------------------------------------------------------- Glock-18 */
  glock18: {
    id: 'glock18',
    label: 'Glock-18',
    pattern: 'pistol',
    fxClass: 'pistol',
    bore: 0.028,
    rUpper: 0.0131,
    railRise: 0.0142,
    zUpperRear: 0.052,
    zUpperFront: -0.131,
    portZ: 0.014,
    zBreech: -0.006,
    zBarrelEnd: -0.138,
    rBarrel: 0.0062,
    rChamber: 0.0092,
    gasAt: null,
    hgZ0: null,
    hgZ1: null,
    hgR: null,
    hgSides: 0,
    hgSlots: 0,
    handZ: -0.05,
    gripZ: 0.014,
    gripAngle: 0.32,
    stockRear: null,
    muzzleKind: 'none',
    magZ: 0.006,
    magTilt: 0.1,
    mag: { w: 0.0224, d: 0.0332, len: 0.108, curve: 0.004, segs: 4 },
    slide: { w: 0.0262, h: 0.0248, len: 0.183, zRear: 0.052 },
    opticRise: 0.026,
    opticZ: 0.012,
    shell: { caseLen: 0.0192, rimR: 0.00478 },
    features: [
      'polymerFrame',
      'slideSerrations',
      'triggerSafety',
      'accessoryRail',
      'autoSear',
      'miniReflexMount',
    ],
    rollmarks: [{ x: -0.0128, y: 0.0332, z: -0.04, h: 0.0024, pattern: [2, 3, 1, 2, 0, 3] }],
  },

  /* --------------------------------------------------------- Desert Eagle */
  deagle: {
    id: 'deagle',
    label: 'Desert Eagle',
    pattern: 'pistol',
    fxClass: 'pistol',
    bore: 0.028,
    rUpper: 0.0146,
    railRise: 0.0158,
    zUpperRear: 0.058,
    zUpperFront: -0.157,
    portZ: 0.016,
    zBreech: -0.008,
    zBarrelEnd: -0.166,
    rBarrel: 0.0082,
    rChamber: 0.0116,
    gasAt: -0.11,
    hgZ0: null,
    hgZ1: null,
    hgR: null,
    hgSides: 0,
    hgSlots: 0,
    handZ: -0.06,
    gripZ: 0.016,
    gripAngle: 0.3,
    stockRear: null,
    muzzleKind: 'none',
    magZ: 0.008,
    magTilt: 0.08,
    mag: { w: 0.0246, d: 0.0398, len: 0.114, curve: 0.003, segs: 4 },
    slide: { w: 0.0288, h: 0.0286, len: 0.215, zRear: 0.058 },
    opticRise: 0.03,
    opticZ: 0.014,
    shell: { caseLen: 0.0327, rimR: 0.00636 },
    features: [
      'steelFrame',
      'gasPiston',
      'ventedRib',
      'triangularBarrel',
      'slideSerrations',
      'miniReflexMount',
    ],
    rollmarks: [{ x: -0.0142, y: 0.0358, z: -0.05, h: 0.0026, pattern: [3, 2, 2, 0, 3, 1] }],
  },
};

export const MODEL_ORDER = [
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

/** Look up a spec, failing loudly rather than building a half-formed weapon. */
export function specFor(id) {
  const spec = MODEL_SPECS[id];
  if (!spec) throw new Error(`no model spec for "${id}"`);
  return spec;
}

/**
 * Derived layout figures. These are the numbers a person would otherwise write
 * in a comment and then let drift: rail deck height, sight radius, overall
 * length, where the eye sits relative to the glass.
 */
export function layoutOf(spec) {
  const railTop = spec.bore + spec.railRise;
  const opticY = spec.bore + spec.opticRise;
  const rearEnd = spec.stockRear ?? spec.zUpperRear + 0.006;
  const muzzleZ = spec.zBarrelEnd - (spec.muzzleKind === 'none' ? 0 : MUZZLE_LEN[spec.muzzleKind]);
  return {
    railTop,
    opticY,
    muzzleZ,
    overall: rearEnd - muzzleZ,
    barrelLen: spec.zBreech - spec.zBarrelEnd,
    receiverLen: spec.zUpperRear - spec.zUpperFront,
    sightRadius: Math.abs(spec.zUpperRear - spec.zUpperFront),
    // Height of the optic centre over the bore: this is what has to be undone
    // when the sight is zeroed, and what makes a scoped SVD shoot high at 25 m.
    sightOverBore: opticY - spec.bore,
  };
}

/**
 * Muzzle device lengths, mirroring MUZZLE_LEN in the parts kit. Kept as a local
 * copy so this file stays importable without three.js; the gate asserts the two
 * tables agree.
 */
export const MUZZLE_LEN = { brake: 0.062, a2: 0.0483, comp: 0.058, trilug: 0.042, none: 0 };

/**
 * Every attachment node the weapons system reads, computed as plain data.
 *
 * The shapes here are NOT invented: they are the ones the base engine's own
 * reference model publishes, because the weapons system and the hand rig consume
 * them directly. Getting one of them subtly wrong (a point where a direction is
 * expected) does not throw — it just puts a hand through the receiver, which is
 * exactly the class of defect this file exists to make testable.
 *
 *   muzzle / chamber / eject     POINTS in weapon-local metres
 *   ejectDir                     DIRECTION the case flies
 *   gripR / gripL                { pos: wrist target, finger: wrap direction,
 *                                  back: dorsum normal } — pos is a point, the
 *                                  other two are directions
 *   handguard                    collision cylinder: a point on the axis, an
 *                                  axis direction, a radius and a z span
 *   chargePull / boltTravel      TRAVEL VECTORS, not scalars
 *   triggerPull                  rotation in radians about triggerPivot
 *   opticGlass                   filled in by build.js from the built optic
 */
export function nodesOf(spec) {
  const L = layoutOf(spec);
  const isPistol = spec.pattern === 'pistol';
  const isPump = spec.pattern === 'pump';
  const isAk = spec.pattern === 'ak' || spec.pattern === 'dmr';

  const nodes = {
    muzzle: [0, spec.bore, L.muzzleZ - 0.002],
    chamber: [0, spec.bore, spec.portZ],
    eject: [spec.rUpper + 0.008, spec.bore + 0.003, spec.portZ],
    // AKs throw brass hard forward-right off a long carrier; a pistol slide
    // flicks it up and back. Same node, three genuinely different vectors.
    ejectDir: isAk ? [0.78, 0.5, 0.38] : isPistol ? [0.7, 0.68, 0.22] : [0.86, 0.44, 0.26],
    sight: [0, L.opticY, spec.opticZ],
    sightAxis: [0, 0, -1],
    ironSight: [
      0,
      L.railTop + (isPistol ? 0.009 : 0.026),
      isPistol ? spec.zUpperRear - 0.008 : spec.zUpperRear - 0.017,
    ],

    // Firing-hand wrist, one grip length behind the receiver face.
    gripR: {
      pos: [0.0251, spec.bore - 0.015, spec.zUpperRear + 0.067],
      finger: [0.05, -0.55, -0.833],
      back: [1, 0.03, 0.04],
    },
    // Support hand: under the handguard on a long gun (clock angle 250 deg, so
    // the hand never covers the muzzle from the camera), wrapped around the
    // firing hand on a pistol.
    gripL: isPistol
      ? {
          pos: [-0.058, spec.bore - 0.008, spec.zUpperRear + 0.05],
          finger: [0.86, -0.34, -0.38],
          back: [-0.3, -0.74, 0.6],
        }
      : {
          pos: [-0.1, spec.bore - 0.0016, spec.handZ + 0.0252],
          finger: [0.8977, -0.3267, -0.2955],
          back: [-0.2784, -0.7648, 0.581],
        },

    handguard: isPistol
      ? { axis: [0, spec.bore, 0], dir: [0, 0, 1], r: 0.015, z0: -0.02, z1: -0.1 }
      : {
          axis: [0, spec.bore, 0],
          dir: [0, 0, 1],
          // The hand touches the polymer slats, which stand 3.6 mm off the chassis.
          r: spec.hgR + 0.0036,
          z0: spec.hgZ0,
          z1: spec.hgZ1,
        },

    magSeat: {
      pos: [0, spec.bore - (isPistol ? 0.052 : 0.014), spec.magZ ?? spec.zUpperFront + 0.02],
      rot: [spec.magTilt, 0, 0],
    },
    magDrop: [0, -0.4, isPump ? 0 : 0.02],

    chargeRest: isPistol
      ? { pos: [0, spec.bore + 0.006, spec.zUpperRear - 0.02], rot: [0, 0, 0] }
      : isAk
        ? { pos: [spec.rUpper + 0.006, spec.bore + 0.004, spec.zUpperRear - 0.03], rot: [0, 0, 0] }
        : isPump
          ? { pos: [0, spec.bore - spec.hgR, spec.handZ], rot: [0, 0, 0] }
          : { pos: [0, spec.bore + spec.rUpper - 0.0075, spec.zUpperRear - 0.024], rot: [0, 0, 0] },
    chargePull: isPistol ? [0, 0, 0.026] : isPump ? [0, 0, 0.086] : [0, 0, 0.082],

    boltRest: { pos: [0, spec.bore, spec.zUpperRear - 0.034], rot: [0, 0, 0] },
    boltTravel: isPistol ? [0, 0, 0.032] : spec.pattern === 'smg' ? [0, 0, 0.056] : [0, 0, 0.062],

    triggerPivot: { pos: [0, spec.bore - 0.0295, spec.gripZ - 0.0205], rot: [0, 0, 0] },
    triggerPull: -0.34,
    selectorPivot: { pos: [0, spec.bore - 0.0225, spec.gripZ + 0.0055], rot: [0, 0, 0] },
  };

  if (isPump) {
    // The forend rides the action bars, so the support hand travels with it.
    nodes.forendRest = { pos: [0, spec.bore - spec.hgR, spec.handZ], rot: [0, 0, 0] };
    nodes.forendTravel = [0, 0, 0.086];
    nodes.shellPort = [0, spec.bore - 0.018, spec.zUpperFront + 0.03];
  }
  if (isAk) {
    // Side mount: the optic hangs off the left of the receiver, not over it.
    nodes.sideRail = {
      pos: [-spec.rUpper - 0.004, spec.bore + 0.016, spec.opticZ],
      rot: [0, 0, 0],
    };
  }
  return nodes;
}

/**
 * A rough triangle estimate per spec, used as a budget guard. The point is not
 * accuracy — it is catching a spec that would build something an order of
 * magnitude heavier than the reference carbine.
 */
export function triangleEstimate(spec) {
  const L = layoutOf(spec);
  let tris = 2600; // receiver, trigger group, grip
  tris += Math.round(L.barrelLen * 5200); // barrel + bore cavity
  if (spec.hgR) tris += 900 + spec.hgSides * 120 + spec.hgSlots * 180;
  if (spec.mag.len > 0) tris += 700 + spec.mag.segs * 130;
  if (spec.stockRear) tris += 1400;
  if (spec.slide) tris += 1900;
  if (spec.tubeMag) tris += 800;
  if (spec.muzzleKind !== 'none') tris += 620;
  tris += spec.features.length * 210;
  tris += spec.rollmarks.length * 240;
  return tris;
}

/** Sanity-check a spec's internal consistency. Throws on the first problem. */
export function validateSpec(spec) {
  const L = layoutOf(spec);
  if (spec.zUpperFront >= spec.zUpperRear) throw new Error(`${spec.id}: receiver runs backwards`);
  if (spec.zBarrelEnd >= spec.zBreech) throw new Error(`${spec.id}: barrel runs backwards`);
  if (L.muzzleZ > spec.zBarrelEnd) throw new Error(`${spec.id}: muzzle device points inward`);
  if (spec.rChamber <= spec.rBarrel) throw new Error(`${spec.id}: chamber thinner than the barrel`);
  if (spec.hgR !== null && spec.hgZ1 >= spec.hgZ0) throw new Error(`${spec.id}: handguard runs backwards`);
  if (spec.hgR !== null && spec.hgZ1 < L.muzzleZ) throw new Error(`${spec.id}: handguard overruns the muzzle`);
  if (spec.mag.len > 0 && spec.mag.segs < 3) throw new Error(`${spec.id}: magazine has too few segments`);
  if (spec.opticRise <= 0) throw new Error(`${spec.id}: optic sits inside the receiver`);
  if (!MUZZLE_LEN[spec.muzzleKind]) {
    if (spec.muzzleKind !== 'none') throw new Error(`${spec.id}: unknown muzzle device`);
  }
  return true;
}
