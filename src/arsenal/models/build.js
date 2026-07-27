import { Assembly, box, blob, dome, extrude, roundRect, latheZ, rodZ, tubeZ } from '../../weapons/geometry.js';
import {
  addBarrel,
  addGasBlock,
  addMuzzleDevice,
  addHandguard,
  addUpperReceiver,
  addLowerReceiver,
  addBoltCarrier,
  addRail,
  addPistolGrip,
  addCarbineStock,
  addFrontSight,
  addRearSight,
  addRollmark,
  addQdSocket,
  addSlingLoop,
  addPin,
  addScrew,
  buildMagazine,
  buildOptic,
  buildMiniReflex,
  buildSlide,
  chargingHandlePart,
  selectorPart,
  triggerPart,
  cartridge,
  knurlBand,
} from '../../weapons/parts.js';
import { specFor, nodesOf, layoutOf, validateSpec, MOVING_PARTS } from './specs.js';

/**
 * ARSENAL — the model builder.
 *
 * One function builds all nine weapons from the specs in specs.js, using the
 * same parts kit and the same call order as the base engine's reference carbine.
 * That reference is the fidelity floor: chamfered receivers, a real bore cavity,
 * pinned takedowns, knurled nuts, engraved rollmarks, a hollow magwell, and
 * glass with a measured aperture.
 *
 * Why a builder instead of nine files: the detail work in the reference model is
 * about 300 lines of solved millimetres. Copied nine times, every future fix has
 * to be made nine times, and the AKM quietly ends up with less care than the
 * M416. Here the care lives once and the differences are declared as data.
 *
 * What each pattern actually changes — these are architectures, not skins:
 *   'ar'     split upper/lower, receiver-extension stock, AR magwell, flat top
 *   'ak'     riveted trunnion receiver, dust cover, gas tube ABOVE the barrel,
 *            left-side optic rail, no flat top at all
 *   'battle' monolithic SCAR upper, side-folding stock, ambidextrous handle
 *   'dmr'    long barrel, wood furniture, thumbhole stock, cheek rest, side mount
 *   'smg'    tubular receiver, wrap-around handguard, claw mount lugs
 *   'pump'   tube magazine under the barrel, sliding forend on action bars,
 *            vented rib and a bead — no detachable magazine, no bolt handle
 *   'pistol' slide on a frame, no stock, no handguard, mini reflex mount
 */

/** Material keys, from the base engine's weapon material set. */
const M = {
  alu: 'alu',
  aluFine: 'alu_fine',
  steel: 'steel',
  bright: 'steel_bright',
  soot: 'steel_soot',
  cavity: 'cavity',
  poly: 'polymer',
  rubber: 'rubber',
  brass: 'brass',
};

/** Furniture material for a spec: wood-furniture guns read warm, not black. */
function furnitureMat(spec) {
  return spec.features.includes('woodFurniture') ? M.rubber : M.poly;
}

/* ------------------------------------------------------------------ receiver */

function buildReceiver(body, spec) {
  const L = layoutOf(spec);

  addUpperReceiver(body, M.alu, M.steel, M.cavity, {
    zRear: spec.zUpperRear,
    zFront: spec.zUpperFront,
    bore: spec.bore,
    r: spec.rUpper,
    portZ: spec.portZ,
  });

  addLowerReceiver(body, M.alu, M.steel, {
    bore: spec.bore,
    zRear: spec.zUpperRear,
    zFront: spec.zUpperFront,
    magZ: spec.magZ ?? spec.zUpperFront + 0.02,
    magW: spec.mag.w + 0.0038,
    magD: spec.mag.d + 0.0052,
    magTilt: spec.magTilt,
  });

  // Takedown and pivot pins, plus the receiver screws. Small, but they are what
  // stops a receiver reading as an extruded block in ADS.
  addPin(body, M.bright, 0, spec.bore - 0.016, spec.zUpperRear - 0.012);
  addPin(body, M.bright, 0, spec.bore - 0.016, spec.zUpperFront + 0.014);
  addScrew(body, M.bright, spec.rUpper * 0.7, spec.bore - 0.006, spec.gripZ + 0.03, 0.0021, 'x');

  for (const r of spec.rollmarks) {
    addRollmark(body, M.soot, {
      x: r.x,
      y: r.y,
      z: r.z,
      h: r.h,
      pattern: r.pattern,
      axis: 'x',
    });
  }

  if (spec.pattern === 'ak' || spec.pattern === 'dmr') {
    // Dust cover: a pressed steel lid with two stiffening ribs, sitting on top
    // of the receiver where an AR would have its rail.
    const cover = latheZ(
      [
        [0, spec.rUpper * 0.5],
        [0, spec.rUpper + 0.001],
        [0.004, spec.rUpper + 0.0016],
        [L.receiverLen - 0.01, spec.rUpper + 0.0016],
        [L.receiverLen - 0.006, spec.rUpper * 0.6],
      ],
      14
    );
    body.add(cover, M.steel, { y: spec.bore, z: spec.zUpperFront + 0.004 });
    cover.dispose();
    for (let i = 0; i < 2; i++) {
      const rib = box(0.0032, 0.0022, L.receiverLen - 0.02, 0.0005, 1);
      body.add(rib, M.steel, {
        x: (i ? 1 : -1) * spec.rUpper * 0.52,
        y: spec.bore + spec.rUpper * 0.86,
        z: (spec.zUpperRear + spec.zUpperFront) / 2,
      });
      rib.dispose();
    }
    // Side rail for the optic mount — the real AK optic interface.
    const rail = box(0.0092, 0.0182, 0.062, 0.0009, 2);
    body.add(rail, M.steel, {
      x: -spec.rUpper - 0.005,
      y: spec.bore + 0.014,
      z: spec.opticZ,
    });
    rail.dispose();
    addScrew(body, M.bright, -spec.rUpper - 0.009, spec.bore + 0.02, spec.opticZ + 0.022, 0.0024, 'x');
  } else if (spec.pattern !== 'pistol') {
    // Flat top: a real Picatinny deck the optic and the backup sights share.
    addRail(body, M.aluFine, spec.zUpperRear - 0.004, spec.zUpperFront + 0.006, L.railTop, 0, {
      slots: 9,
    });
  }

  if (spec.pattern === 'smg') {
    // MP5 claw mount: two lugs over the tubular receiver.
    for (let i = 0; i < 2; i++) {
      const lug = box(0.0068, 0.011, 0.0132, 0.0008, 1);
      body.add(lug, M.steel, {
        x: (i ? 1 : -1) * (spec.rUpper - 0.001),
        y: spec.bore + spec.rUpper * 0.9,
        z: spec.opticZ + (i ? 0.024 : -0.024),
      });
      lug.dispose();
    }
  }
}

/* -------------------------------------------------------------------- barrel */

function buildBarrelGroup(body, spec) {
  const L = layoutOf(spec);

  addBarrel(body, M.steel, M.cavity, {
    y: spec.bore,
    zBreech: spec.zBreech,
    zMuzzle: spec.zBarrelEnd,
    rBarrel: spec.rBarrel,
    rChamber: spec.rChamber,
  });

  if (spec.gasAt !== null) {
    addGasBlock(body, M.soot, {
      y: spec.bore,
      z: spec.gasAt,
      rBarrel: spec.rBarrel,
      w: spec.pattern === 'ak' || spec.pattern === 'dmr' ? 0.024 : 0.021,
      h: 0.02,
    });
  }

  if (spec.pattern === 'ak' || spec.pattern === 'dmr') {
    // The gas tube: the single most recognisable line on an AK's silhouette.
    const tube = tubeZ(0.0082, 0.0064, Math.abs(spec.gasAt - spec.hgZ0) + 0.03, 14, 0.0004);
    body.add(tube, M.steel, {
      y: spec.bore + spec.rBarrel + 0.0112,
      z: (spec.gasAt + spec.hgZ0) / 2,
    });
    tube.dispose();
  }

  let crownZ = spec.zBarrelEnd;
  if (spec.muzzleKind !== 'none') {
    const dev = addMuzzleDevice(body, M.soot, M.cavity, spec.muzzleKind, spec.zBarrelEnd, spec.rBarrel, spec.bore);
    crownZ = dev?.crownZ ?? L.muzzleZ;
  }

  if (spec.tubeMag) {
    // Shotgun magazine tube plus its front cap, slung under the barrel.
    const t = spec.tubeMag;
    const tube = tubeZ(t.r, t.r - 0.0018, Math.abs(t.z1 - t.z0), 18, 0.0005);
    body.add(tube, M.steel, { y: spec.bore - t.drop, z: (t.z0 + t.z1) / 2 });
    tube.dispose();
    const cap = latheZ(
      [
        [0, 0],
        [0, t.r + 0.0012],
        [0.006, t.r + 0.0016],
        [0.014, t.r * 0.8],
      ],
      16
    );
    body.add(cap, M.steel, { y: spec.bore - t.drop, z: t.z1 - 0.014 });
    cap.dispose();
    const grip = knurlBand(t.r + 0.0018, 0.009, 26, 0.0004, 3);
    body.add(grip, M.steel, { y: spec.bore - t.drop, z: t.z1 - 0.006 });
    grip.dispose();
  }

  return crownZ;
}

/* ---------------------------------------------------------------- handguard */

function buildHandguardGroup(body, spec) {
  if (spec.hgR === null) return;
  const L = layoutOf(spec);

  addHandguard(body, spec.features.includes('railedHandguard') ? M.alu : furnitureMat(spec), {
    y: spec.bore,
    z0: spec.hgZ0,
    z1: spec.hgZ1,
    r: spec.hgR,
    sides: spec.hgSides,
    slats: spec.hgSides,
  });

  if (spec.hgSlots > 0) {
    // Top rail segment over the handguard: this is what a front-mounted optic or
    // a laser actually clamps to, so it has to be real geometry, not a decal.
    addRail(body, M.aluFine, spec.hgZ0 - 0.008, spec.hgZ1 + 0.01, L.railTop, 0, {
      slots: spec.hgSlots,
    });
  }

  if (spec.features.includes('slidingForend')) {
    // Action bars: two steel straps from the forend back into the receiver. They
    // are why a pump reads as a mechanism when it cycles.
    for (let i = 0; i < 2; i++) {
      const bar = box(0.0038, 0.0052, Math.abs(spec.hgZ0 - spec.zUpperFront) + 0.05, 0.0006, 1);
      body.add(bar, M.bright, {
        x: (i ? 1 : -1) * 0.0132,
        y: spec.bore - spec.tubeMag.drop - 0.004,
        z: (spec.hgZ0 + spec.zUpperFront) / 2 - 0.02,
      });
      bar.dispose();
    }
  }
}

/* -------------------------------------------------------- grip and shoulder */

function buildGripAndStock(body, spec) {
  addPistolGrip(body, furnitureMat(spec), M.rubber, {
    len: spec.pattern === 'pistol' ? 0.116 : 0.108,
    w: spec.pattern === 'pistol' ? 0.0324 : 0.031,
    angle: spec.gripAngle,
    y: spec.bore - 0.03,
    z: spec.gripZ,
  });

  if (spec.stockRear === null) return;

  if (spec.features.includes('thumbholeStock')) {
    // SVD: a skeletonised thumbhole stock with a cheek rest, not a tube.
    const rails = [
      { y: spec.bore - 0.006, h: 0.014 },
      { y: spec.bore - 0.062, h: 0.016 },
    ];
    for (const r of rails) {
      const bar = box(0.026, r.h, spec.stockRear - spec.zUpperRear - 0.01, 0.0022, 2);
      body.add(bar, M.rubber, { y: r.y, z: (spec.stockRear + spec.zUpperRear) / 2 });
      bar.dispose();
    }
    const butt = box(0.028, 0.09, 0.024, 0.0035, 2);
    body.add(butt, M.rubber, { y: spec.bore - 0.03, z: spec.stockRear - 0.012 });
    butt.dispose();
    const pad = box(0.03, 0.092, 0.016, 0.004, 2);
    body.add(pad, M.rubber, { y: spec.bore - 0.03, z: spec.stockRear + 0.006 });
    pad.dispose();
    if (spec.features.includes('cheekRest')) {
      const cheek = blob(0.03, 0.03, 0.09, 0.008, 3);
      body.add(cheek, M.rubber, { y: spec.bore + 0.026, z: spec.stockRear - 0.07 });
      cheek.dispose();
    }
    return;
  }

  if (spec.features.includes('fixedStock')) {
    // AK: a solid one-piece stock with a straight comb.
    const comb = box(0.03, 0.058, spec.stockRear - spec.zUpperRear, 0.004, 2);
    body.add(comb, furnitureMat(spec), {
      y: spec.bore - 0.022,
      z: (spec.stockRear + spec.zUpperRear) / 2,
      rx: -0.035,
    });
    comb.dispose();
    const pad = box(0.032, 0.088, 0.014, 0.0035, 2);
    body.add(pad, M.rubber, { y: spec.bore - 0.036, z: spec.stockRear + 0.005 });
    pad.dispose();
    return;
  }

  addCarbineStock(body, M.alu, furnitureMat(spec), M.rubber, {
    bore: spec.bore,
    zRear: spec.stockRear,
    zFront: spec.zUpperRear,
  });

  if (spec.features.includes('foldingStock')) {
    // SCAR: the folding hinge, plus the pin it turns on.
    const hinge = latheZ(
      [
        [0, 0],
        [0, 0.0092],
        [0.016, 0.0092],
        [0.016, 0],
      ],
      14
    );
    body.add(hinge, M.alu, { x: 0.014, y: spec.bore - 0.012, z: spec.zUpperRear + 0.01, ry: Math.PI / 2 });
    hinge.dispose();
    addPin(body, M.bright, 0.014, spec.bore - 0.012, spec.zUpperRear + 0.01, 0.0026, 0.02);
  }
  if (spec.features.includes('adjustableCheek')) {
    const riser = box(0.028, 0.018, 0.062, 0.0035, 2);
    body.add(riser, furnitureMat(spec), { y: spec.bore + 0.026, z: spec.stockRear - 0.075 });
    riser.dispose();
  }
}

/* ------------------------------------------------------------------- sights */

function buildSights(body, spec) {
  const L = layoutOf(spec);

  if (spec.features.includes('beadSight')) {
    // Shotgun: a vented rib with a brass bead. No optic tube by default.
    const rib = box(0.0092, 0.0042, Math.abs(spec.zBarrelEnd - spec.zUpperFront) - 0.02, 0.0006, 1);
    body.add(rib, M.steel, {
      y: spec.bore + spec.rBarrel + 0.004,
      z: (spec.zBarrelEnd + spec.zUpperFront) / 2,
    });
    rib.dispose();
    const bead = dome(0.0022, 10);
    body.add(bead, M.brass, { y: spec.bore + spec.rBarrel + 0.0072, z: spec.zBarrelEnd + 0.02 });
    bead.dispose();
    return null;
  }

  if (spec.pattern === 'pistol') {
    // Pistol irons: a dovetailed rear notch and a front post, both on the slide.
    const rear = box(0.0132, 0.0052, 0.0048, 0.0006, 1);
    body.add(rear, M.soot, { y: L.railTop + 0.002, z: spec.zUpperRear - 0.008 });
    rear.dispose();
    const notch = box(0.0034, 0.0042, 0.005, 0.0004, 1);
    body.add(notch, M.cavity, { y: L.railTop + 0.0032, z: spec.zUpperRear - 0.008 });
    notch.dispose();
    const front = box(0.0026, 0.0054, 0.0036, 0.0004, 1);
    body.add(front, M.soot, { y: L.railTop + 0.0022, z: spec.zUpperFront + 0.01 });
    front.dispose();
    return null;
  }

  addFrontSight(body, M.soot, M.alu, 0, L.railTop, spec.hgZ1 !== null ? spec.hgZ1 + 0.016 : spec.zUpperFront + 0.02, true);
  addRearSight(body, M.soot, M.alu, 0, L.railTop, spec.zUpperRear - 0.018, true);
  return null;
}

/* -------------------------------------------------------------- accessories */

function buildAccessories(body, spec) {
  if (spec.features.includes('qdSocket')) {
    addQdSocket(body, M.alu, M.bright, spec.hgR + 0.002, spec.bore - 0.012, spec.hgZ0 - 0.03);
  }
  if (spec.features.includes('slingLoop')) {
    const z = spec.stockRear !== null ? spec.zUpperRear + 0.02 : spec.gripZ + 0.03;
    addSlingLoop(body, M.bright, 0.008, spec.bore - 0.03, z);
  }
  if (spec.features.includes('bipodLug')) {
    const lug = box(0.0132, 0.0092, 0.018, 0.001, 1);
    body.add(lug, M.steel, { y: spec.bore - spec.rBarrel - 0.008, z: spec.hgZ1 - 0.02 });
    lug.dispose();
  }
  if (spec.features.includes('accessoryRail')) {
    // Pistol dust-cover rail: the mount a laser or a light hangs from.
    addRail(body, M.poly, spec.zUpperFront + 0.052, spec.zUpperFront + 0.012, spec.bore - 0.0152, 0, {
      slots: 2,
    });
  }
  if (spec.features.includes('ventedRib')) {
    for (let i = 0; i < 4; i++) {
      const slot = box(0.0056, 0.0026, 0.0092, 0.0004, 1);
      body.add(slot, M.cavity, {
        y: spec.bore + spec.rBarrel + 0.0032,
        z: spec.zUpperFront - 0.03 - i * 0.019,
      });
      slot.dispose();
    }
  }
}

/* ------------------------------------------------------------ moving pieces */

function buildMovingParts(spec) {
  const magazine = new Assembly(`${spec.id}-magazine`);
  if (spec.mag.len > 0) {
    buildMagazine(magazine, { poly: furnitureMat(spec), steel: M.steel, brass: M.brass }, {
      w: spec.mag.w,
      d: spec.mag.d,
      len: spec.mag.len,
      curve: spec.mag.curve,
      segs: spec.mag.segs,
      poly: furnitureMat(spec),
    });
  }

  const charging = new Assembly(`${spec.id}-charging`);
  const ch = chargingHandlePart();
  charging.add(ch.geo ?? ch, M.alu, {});
  (ch.geo ?? ch).dispose?.();

  const bolt = new Assembly(`${spec.id}-bolt`);
  if (spec.slide) {
    buildSlide(bolt, {
      w: spec.slide.w,
      h: spec.slide.h,
      len: spec.slide.len,
      zRear: spec.slide.zRear,
      mat: M.steel,
    });
  } else {
    addBoltCarrier(bolt, M.bright, {
      r: spec.rUpper - 0.004,
      len: spec.pattern === 'smg' ? 0.082 : 0.092,
      z: 0,
    });
  }
  // A chambered round, pushed far enough forward that only the case head shows.
  const round = cartridge(spec.shell.caseLen, spec.shell.rimR, spec.shell.caseLen * 0.42);
  bolt.add(round.brass, M.brass, { z: -spec.shell.caseLen - 0.045, ry: Math.PI });
  round.brass.dispose();
  round.bullet.dispose();

  const trigger = new Assembly(`${spec.id}-trigger`);
  const trg = triggerPart(M.bright);
  trigger.add(trg.geo, M.bright, {});
  trg.geo.dispose();

  const selector = new Assembly(`${spec.id}-selector`);
  const sel = selectorPart(M.alu, M.steel);
  selector.add(sel.geo, M.alu, {});
  sel.geo.dispose();
  const selR = selectorPart(M.alu, M.steel);
  selector.add(selR.geo, M.alu, { sx: -1 });
  selR.geo.dispose();

  return { magazine, charging, bolt, trigger, selector };
}

/* ---------------------------------------------------------------- the optic */

function buildDefaultOptic(body, spec) {
  const L = layoutOf(spec);
  if (spec.features.includes('miniReflexMount')) {
    return buildMiniReflex(body, { y: L.opticY, z: spec.opticZ, matBody: M.alu });
  }
  if (spec.features.includes('beadSight')) return null;
  return buildOptic(body, {
    rTube: 0.0155,
    len: spec.pattern === 'dmr' ? 0.196 : 0.052,
    hood: 0.007,
    y: L.opticY,
    z: spec.opticZ,
    railTop: L.railTop,
    matBody: M.alu,
    matSteel: M.steel,
  });
}

/* ----------------------------------------------------------------- assemble */

/**
 * Build one weapon.
 *
 * @param {string} id  a key from MODEL_SPECS
 * @returns {{id:string,label:string,fxClass:string,body:Assembly,
 *   moving:Record<string,Assembly>,nodes:object,shell:object,magSize:object}}
 *   the same shape the base engine's own models return, so the weapons system
 *   and the hand rig consume it without a special case.
 */
export function buildArsenalModel(id) {
  const spec = specFor(id);
  validateSpec(spec);

  const body = new Assembly(`${spec.id}-body`);

  buildReceiver(body, spec);
  const crownZ = buildBarrelGroup(body, spec);
  buildHandguardGroup(body, spec);
  buildGripAndStock(body, spec);
  buildSights(body, spec);
  buildAccessories(body, spec);
  const optic = buildDefaultOptic(body, spec);
  const moving = buildMovingParts(spec);

  const nodes = nodesOf(spec);
  // The crown and the lens are only known once the geometry exists, so they
  // override the estimates from the spec rather than being guessed twice.
  nodes.muzzle = [0, spec.bore, crownZ];
  if (optic?.lensZ !== undefined) nodes.sight = [0, layoutOf(spec).opticY, optic.lensZ];
  nodes.opticGlass = optic;

  return {
    id: spec.id,
    label: spec.label,
    fxClass: spec.fxClass,
    body,
    moving,
    nodes,
    shell: { caseLen: spec.shell.caseLen, rimR: spec.shell.rimR },
    magSize: { len: spec.mag.len, w: spec.mag.w, d: spec.mag.d },
  };
}

/** Every model, in menu order. Used by the gunsmith board and the preview tool. */
export function buildAllArsenalModels(ids) {
  const out = {};
  for (const id of ids) out[id] = buildArsenalModel(id);
  return out;
}

export { MOVING_PARTS };
