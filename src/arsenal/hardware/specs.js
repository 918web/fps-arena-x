/**
 * ARSENAL / HARDWARE — where a detachable part physically goes.
 *
 * Pure data and pure maths: no three.js import, so every mounting decision is
 * testable in node. `build.js` next door turns these placements into geometry.
 *
 * The rule this file exists to enforce: an attachment is bolted to a real
 * INTERFACE on the weapon (a rail deck, a muzzle thread, a side dovetail, the
 * handguard's underside), never to a hand-picked offset. Change a barrel length
 * in models/specs.js and the can, the laser and the bipod all follow it.
 */

import { MODEL_SPECS, MODEL_ORDER, layoutOf, MUZZLE_LEN } from '../models/specs.js';
import { ATTACHMENTS, SLOT_ORDER } from '../attachments.js';

/** Physical interface kinds. An attachment declares which one it needs. */
export const INTERFACES = ['railTop', 'sideRail', 'railBottom', 'thread', 'dovetail', 'magwell'];

/** What each attachment kind bolts to. */
export const NEEDS = {
  irons: null,
  reflex: 'railTop',
  holo: 'railTop',
  scope: 'railTop',
  brake: 'thread',
  comp: 'thread',
  suppressor: 'thread',
  laser: 'railBottom',
  light: 'railBottom',
  combo: 'railBottom',
  foregrip: 'railBottom',
  bipod: 'railBottom',
  mag: 'magwell',
};

/**
 * The optic on an AK or an SVD goes on the left-side dovetail, not on top of the
 * dust cover: a dust cover is a sheet-metal lid that lifts off, so anything
 * zeroed to it walks. The base receiver models publish a `sideRail` node for
 * exactly this, and the PSO-1 is the one optic that only fits there.
 */
export function opticInterface(spec) {
  return spec.features.includes('sideRail') ? 'sideRail' : 'railTop';
}

/**
 * Every interface a weapon actually offers, in weapon space (metres, +Z is
 * towards the shooter, +X is right, Y is up from the grip web).
 */
export function interfacesOf(spec) {
  const L = layoutOf(spec);
  const out = {};

  // Top deck: from just behind the front sight back to the rear of the receiver.
  out.railTop = {
    kind: 'railTop',
    x: 0,
    y: L.railTop,
    z0: spec.zUpperRear - 0.004,
    z1: spec.pattern === 'pistol' ? spec.slide.zRear - spec.slide.len + 0.02 : spec.zUpperFront + 0.006,
    slots: spec.pattern === 'pistol' ? 3 : 9,
  };

  // Side dovetail, AK/SVD pattern: left of the receiver, above the trigger.
  if (spec.features.includes('sideRail')) {
    out.sideRail = {
      kind: 'sideRail',
      x: -(spec.rUpper + 0.011),
      y: spec.bore + 0.019,
      z0: spec.zUpperRear - 0.018,
      z1: spec.zUpperRear - 0.086,
      slots: 3,
    };
  }

  // Muzzle thread: the crown of the barrel, so a device grows FORWARD from it.
  out.thread = {
    kind: 'thread',
    x: 0,
    y: spec.bore,
    z: spec.zBarrelEnd,
    r: spec.rBarrel,
    pitch: spec.bore > 0.05 ? '14x1L' : '1/2-28',
  };

  // Underside of the handguard (rifles) or the dust cover rail (pistols).
  if (spec.hgR !== null) {
    out.railBottom = {
      kind: 'railBottom',
      x: 0,
      y: spec.bore - spec.hgR - 0.0042,
      z0: spec.hgZ0 - 0.01,
      z1: spec.hgZ1 + 0.012,
      slots: 5,
    };
    // A laser or a light on the 3 o'clock rail keeps the 6 o'clock rail free for
    // a grip, which is how anyone who actually runs both sets a gun up.
    out.railSide = {
      kind: 'railBottom',
      x: spec.hgR + 0.0046,
      y: spec.bore - 0.004,
      z0: spec.hgZ0 - 0.014,
      z1: spec.hgZ1 + 0.02,
      slots: 4,
    };
  } else {
    // Pistol accessory rail: short, under the dust cover, ahead of the trigger.
    out.railBottom = {
      kind: 'railBottom',
      x: 0,
      y: spec.bore - spec.slide.h * 0.5 - 0.004,
      z0: -0.028,
      z1: -0.072,
      slots: 2,
    };
  }

  if (spec.mag.len > 0) {
    out.magwell = { kind: 'magwell', x: 0, y: -0.006, z: spec.magZ, tilt: spec.magTilt };
  }
  return out;
}

/** Length a muzzle device adds ahead of the crown. */
export const DEVICE_LEN = { ...MUZZLE_LEN, suppressor: 0.168 };

/** Outer radius of each muzzle device, over the barrel. */
export function deviceRadius(spec, kind) {
  if (kind === 'suppressor') return Math.max(0.0185, spec.rBarrel + 0.0125);
  return spec.rBarrel + 0.0038;
}

/**
 * Height of an optic's optical axis over its own mounting foot. A tube scope
 * needs enough to clear the front sight tower; a reflex sits almost on the rail.
 */
export const OPTIC_RISE = { reflex: 0.0245, holo: 0.0268, scope: 0.0392 };

/** Body sizes, so `build.js` and the clearance tests agree on one number. */
export const OPTIC_BODY = {
  reflex: { len: 0.0455, w: 0.0246, h: 0.021, rTube: null },
  holo: { len: 0.062, w: 0.032, h: 0.028, rTube: null },
  scope: { len: 0.086, w: 0.036, h: 0.036, rTube: 0.0155 },
};

/**
 * Solve where one attachment sits on one weapon.
 *
 * @returns {{ id, slot, kind, iface, pos:[x,y,z], rot:[rx,ry,rz], len:number,
 *   axisY:number|null, growsForward:boolean }}
 */
export function placementFor(spec, attId) {
  const att = ATTACHMENTS[attId];
  if (!att) throw new Error(`unknown attachment ${attId}`);
  const need = NEEDS[att.kind];
  const ifaces = interfacesOf(spec);
  const L = layoutOf(spec);

  const base = { id: attId, slot: att.slot, kind: att.kind, iface: need, growsForward: false };

  if (need === null) {
    // Irons are part of the weapon: report the existing sight line, nothing new.
    return { ...base, pos: [0, L.railTop, spec.zUpperRear - 0.01], rot: [0, 0, 0], len: 0, axisY: L.railTop + 0.006 };
  }

  if (att.slot === 'optic') {
    const which = opticInterface(spec);
    const rail = ifaces[which] ?? ifaces.railTop;
    const body = OPTIC_BODY[att.kind] ?? OPTIC_BODY.reflex;
    const rise = OPTIC_RISE[att.kind] ?? OPTIC_RISE.reflex;
    // Sit the glass where the shooter's eye already is: the spec's optic Z, but
    // never so far forward that the body overhangs the ejection port.
    const z = Math.min(spec.opticZ, spec.portZ + body.len * 0.5 + 0.012);
    return {
      ...base,
      iface: which,
      pos: [rail.x, rail.y, z],
      rot: which === 'sideRail' ? [0, 0, 0] : [0, 0, 0],
      len: body.len,
      axisY: rail.y + rise,
      railTop: rail.y,
      body,
    };
  }

  if (att.slot === 'muzzle') {
    const t = ifaces.thread;
    const len = DEVICE_LEN[att.kind] ?? 0.05;
    return {
      ...base,
      pos: [t.x, t.y, t.z],
      rot: [0, 0, 0],
      len,
      axisY: null,
      growsForward: true,
      r: deviceRadius(spec, att.kind),
      crownZ: t.z - len,
    };
  }

  if (att.slot === 'tactical') {
    // Prefer the side rail when the weapon has one, so the underside stays free.
    const rail = ifaces.railSide ?? ifaces.railBottom;
    const len = att.kind === 'combo' ? 0.072 : 0.058;
    const z = rail.z1 + len * 0.5 + 0.01;
    const flip = rail === ifaces.railSide;
    return {
      ...base,
      iface: 'railBottom',
      pos: [rail.x, rail.y, z],
      rot: flip ? [0, 0, -Math.PI / 2] : [0, 0, 0],
      len,
      axisY: null,
      emitZ: z - len * 0.5 - 0.004,
    };
  }

  if (att.slot === 'underbarrel') {
    const rail = ifaces.railBottom;
    if (att.kind === 'foregrip') {
      const len = 0.062;
      return { ...base, pos: [0, rail.y - 0.002, rail.z1 + 0.052], rot: [0.25, 0, 0], len, axisY: null };
    }
    // Bipod: as far forward as the rail goes, because leverage is the point.
    const len = 0.052;
    return {
      ...base,
      pos: [0, rail.y - 0.004, rail.z1 + 0.026],
      rot: [0, 0, 0],
      len,
      axisY: null,
      legLen: 0.196,
      stowedAngle: 1.42,
      deployedAngle: 0.34,
    };
  }

  // Magazine: the magwell, tilted the way the weapon feeds.
  const m = ifaces.magwell;
  if (!m) throw new Error(`${spec.id} has no magwell`);
  const mul = ATTACHMENTS[attId].mul?.magLen ?? 1;
  return { ...base, pos: [m.x, m.y, m.z], rot: [m.tilt, 0, 0], len: spec.mag.len * mul, axisY: null };
}

/**
 * LIGHT BUDGET.
 *
 * The renderer compiles one shader per light count, so a light that appears when
 * the player mounts a torch costs a frame-long stall in the middle of a firefight.
 * The viewmodel therefore always owns exactly this many real lights; toggling a
 * torch changes an intensity, never the count.
 */
export const LIGHT_POOL = { spot: 1, point: 0 };

/** Beam and dot description for a laser, derived from its placement. */
export function laserSpec(spec, placement) {
  return {
    origin: [placement.pos[0], placement.pos[1] + 0.006, placement.emitZ],
    // Parallel to the bore, not to the barrel: a laser is zeroed, not clamped.
    dir: [0, 0, -1],
    range: 60,
    beamR: 0.00065,
    dotR: 0.019,
    colour: 0xff2a1e,
    // A visible beam is only honest in haze; in clear air only the dot shows.
    beamOpacity: 0.16,
  };
}

/** Everything that can legally hang on one weapon, solved in slot order. */
export function placementsFor(spec, loadout) {
  const out = {};
  for (const slot of SLOT_ORDER) {
    const id = loadout[slot];
    if (!id) continue;
    out[slot] = placementFor(spec, id);
  }
  return out;
}

/**
 * Clearance check: an attachment must not intersect the weapon's own parts or
 * another attachment. Returns a list of complaints, empty when the build is sane.
 */
export function clearanceIssues(spec, placements) {
  const L = layoutOf(spec);
  const issues = [];
  const optic = placements.optic;
  const muzzle = placements.muzzle;
  const tac = placements.tactical;
  const under = placements.underbarrel;

  if (optic && optic.len > 0) {
    const front = optic.pos[2] - optic.len * 0.5;
    const back = optic.pos[2] + optic.len * 0.5;
    if (optic.iface === 'railTop' && front < spec.zUpperFront) {
      issues.push('optic overhangs the front of the receiver');
    }
    if (back > spec.zUpperRear + 0.002) issues.push('optic hangs off the back of the receiver');
    if (optic.axisY <= L.railTop) issues.push('optic axis is inside the rail');
    if (optic.axisY - spec.bore > 0.085) issues.push('optic sits comically high over the bore');
  }
  if (muzzle) {
    if (muzzle.crownZ >= spec.zBarrelEnd) issues.push('muzzle device grows backwards');
    if (spec.hgR !== null && muzzle.crownZ > spec.hgZ1) issues.push('muzzle device ends inside the handguard');
    if (muzzle.r > spec.hgR + 0.02 && spec.hgR !== null && muzzle.pos[2] > spec.hgZ1) {
      issues.push('muzzle device is too fat to clear the handguard');
    }
  }
  if (tac) {
    if (tac.emitZ > spec.hgZ0 && spec.hgR !== null) issues.push('laser/light emitter faces into the handguard');
    if (tac.pos[1] > spec.bore) issues.push('tactical device is mounted above the bore line');
  }
  if (under && tac && under.iface === tac.iface && Math.abs(under.pos[2] - tac.pos[2]) < 0.02 && Math.abs(under.pos[0] - tac.pos[0]) < 0.012) {
    issues.push('grip and light are fighting for the same rail slot');
  }
  if (under && muzzle && under.pos[2] - under.len * 0.5 < muzzle.crownZ) {
    issues.push('underbarrel device sticks out past the muzzle');
  }
  return issues;
}

/** Every weapon, every legal single attachment: used by the gate. */
export function allPlacements() {
  const out = [];
  for (const id of MODEL_ORDER) {
    const spec = MODEL_SPECS[id];
    for (const attId of Object.keys(ATTACHMENTS)) {
      out.push([id, attId, spec]);
    }
  }
  return out;
}
