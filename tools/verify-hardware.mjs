/**
 * VERIFY-HARDWARE — the test gate for the detachable hardware layer (step 3).
 *
 * Its own runnable file rather than another block bolted into verify-arena.mjs,
 * so a failure names the layer that broke and `node tools/verify-hardware.mjs`
 * is a two-second loop while working on mounts. Same conventions, same exit
 * code: 1 on any failure.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

let passed = 0;
const failures = [];
const groups = [];
let current = null;

function group(name) {
  current = { name, tests: 0, failed: 0 };
  groups.push(current);
}
function check(label, fn) {
  if (current) current.tests += 1;
  try {
    fn();
    passed += 1;
  } catch (err) {
    if (current) current.failed += 1;
    failures.push({ group: current?.name ?? '-', label, message: err.message });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function near(a, b, eps, msg) {
  assert(Math.abs(a - b) <= eps, `${msg ?? ''} expected ~${b}, got ${a}`);
}

/* ---------------------------------------------------------------- hardware */
/**
 * Step 3: detachable hardware.
 *
 * hardware/specs.js decides WHERE a part goes and is pure, so it is tested for
 * real here. hardware/build.js and hardware/rig.js need three.js, so they are
 * checked structurally - for the two properties that actually break a game if
 * they regress: a constant light count, and no allocation in the update path.
 */
async function hardware() {
  const hwPath = join(SRC, 'arsenal/hardware/specs.js');
  if (!existsSync(hwPath)) return;
  const H = await import(pathToFileURL(hwPath).href);
  const M = await import(pathToFileURL(join(SRC, 'arsenal/models/specs.js')).href);
  const A = await import(pathToFileURL(join(SRC, 'arsenal/attachments.js')).href);
  const D = await import(pathToFileURL(join(SRC, 'arsenal/defs.js')).href);
  const {
    interfacesOf, placementFor, placementsFor, clearanceIssues, opticInterface,
    laserSpec, LIGHT_POOL, DEVICE_LEN, deviceRadius, OPTIC_RISE, NEEDS, INTERFACES,
  } = H;
  const { MODEL_SPECS, MODEL_ORDER, layoutOf } = M;
  const { ATTACHMENTS, SLOT_ORDER, canMount, defaultLoadout, BY_SLOT } = A;
  const { ARSENAL_DEFS } = D;

  group('hardware: interfaces');
  check('every attachment kind declares what it bolts to', () => {
    for (const att of Object.values(ATTACHMENTS)) {
      assert(NEEDS[att.kind] !== undefined, `no interface declared for kind ${att.kind}`);
      const need = NEEDS[att.kind];
      assert(need === null || INTERFACES.includes(need), `${att.kind} needs unknown interface ${need}`);
    }
  });
  check('every weapon offers a top deck and a muzzle thread', () => {
    for (const id of MODEL_ORDER) {
      const i = interfacesOf(MODEL_SPECS[id]);
      assert(i.railTop && i.thread, `${id} is missing a mounting interface`);
      assert(i.railTop.z0 > i.railTop.z1, `${id}: top rail runs backwards`);
      assert(i.thread.z <= MODEL_SPECS[id].zBarrelEnd + 1e-9, `${id}: thread is not at the crown`);
    }
  });
  check('the AK family and the SVD mount optics on the side dovetail', () => {
    for (const id of ['akm', 'ak74', 'svd']) {
      assert(interfacesOf(MODEL_SPECS[id]).sideRail, `${id} should have a side rail`);
      assert(opticInterface(MODEL_SPECS[id]) === 'sideRail', `${id} should mount optics on the side`);
    }
    for (const id of ['m416', 'scar', 'mp5']) {
      assert(opticInterface(MODEL_SPECS[id]) === 'railTop', `${id} should mount optics on top`);
    }
  });
  check('a dust cover never carries the optic', () => {
    // The whole reason the side rail exists: anything zeroed to a lift-off lid walks.
    for (const id of MODEL_ORDER) {
      const spec = MODEL_SPECS[id];
      if (!spec.features.includes('sideRail')) continue;
      const p = placementFor(spec, 'reddot');
      assert(p.iface === 'sideRail', `${id}: optic ended up on the dust cover`);
      assert(p.pos[0] < 0, `${id}: the dovetail is on the left of the receiver`);
    }
  });
  check('rifles keep a rail free for a grip when a light is fitted', () => {
    for (const id of ['m416', 'scar', 'akm']) {
      const spec = MODEL_SPECS[id];
      const i = interfacesOf(spec);
      assert(i.railSide, `${id} should have a 3 o'clock rail`);
      const light = placementFor(spec, 'flashlight');
      const grip = placementFor(spec, 'foregrip');
      assert(Math.abs(light.pos[0] - grip.pos[0]) > 0.008, `${id}: light and grip share a rail`);
    }
  });
  check('pistols get a short accessory rail and no handguard rail', () => {
    for (const id of ['glock18', 'deagle']) {
      const i = interfacesOf(MODEL_SPECS[id]);
      assert(i.railBottom, `${id} needs an accessory rail`);
      assert(!i.railSide, `${id} should not have a handguard rail`);
      assert(Math.abs(i.railBottom.z1 - i.railBottom.z0) < 0.06, `${id}: accessory rail is too long`);
    }
  });

  group('hardware: placement');
  for (const id of MODEL_ORDER) {
    const spec = MODEL_SPECS[id];
    const def = ARSENAL_DEFS[id];
    const legal = Object.keys(ATTACHMENTS).filter((a) => canMount(def, a).ok);

    check(`${id}: every legal attachment solves to finite numbers`, () => {
      assert(legal.length >= 3, `${id} can only take ${legal.length} attachments`);
      for (const attId of legal) {
        const p = placementFor(spec, attId);
        for (const v of p.pos) assert(Number.isFinite(v), `${attId}: non-finite position`);
        for (const v of p.rot) assert(Number.isFinite(v), `${attId}: non-finite rotation`);
        assert(Number.isFinite(p.len) && p.len >= 0, `${attId}: bad length ${p.len}`);
      }
    });

    check(`${id}: optics sit above the rail and near the bore`, () => {
      for (const attId of legal.filter((a) => ATTACHMENTS[a].slot === 'optic' && a !== 'iron')) {
        const p = placementFor(spec, attId);
        assert(p.axisY > p.railTop, `${attId}: axis is inside the rail`);
        const over = p.axisY - spec.bore;
        assert(over > 0.015 && over < 0.085, `${attId}: axis ${over.toFixed(3)} m over the bore`);
        assert(p.len > 0.03, `${attId}: body is too short to hold glass`);
      }
    });

    check(`${id}: a can grows forward from the crown and is the longest device`, () => {
      if (!canMount(def, 'suppressor').ok) return;
      const can = placementFor(spec, 'suppressor');
      assert(can.growsForward, 'a muzzle device must grow forward');
      assert(can.crownZ < spec.zBarrelEnd, 'the can ends behind the barrel');
      near(can.crownZ, spec.zBarrelEnd - DEVICE_LEN.suppressor, 1e-9, 'crown position');
      const brake = placementFor(spec, 'brake');
      assert(can.len > brake.len * 2, 'a can should dwarf a brake');
      assert(deviceRadius(spec, 'suppressor') > deviceRadius(spec, 'brake'), 'a can is fatter than a brake');
    });

    check(`${id}: the laser fires past the muzzle, not into the furniture`, () => {
      if (!canMount(def, 'laser').ok) return;
      const p = placementFor(spec, 'laser');
      const L = laserSpec(spec, p);
      assert(p.emitZ < p.pos[2], 'the emitter faces forward');
      near(Math.hypot(...L.dir), 1, 1e-9, 'beam direction length');
      assert(L.dir[2] < 0, 'the beam points downrange');
      assert(L.range > 20, 'the beam should reach across a room and then some');
      assert(p.pos[1] <= spec.bore, 'a light or laser hangs below the bore, not over the sights');
    });

    check(`${id}: a maximal legal build has no clearance problems`, () => {
      const build = { ...defaultLoadout(def) };
      for (const slot of SLOT_ORDER) {
        const pick = BY_SLOT[slot].find((a) => canMount(def, a).ok && ATTACHMENTS[a].detachable);
        if (pick) build[slot] = pick;
      }
      const issues = clearanceIssues(spec, placementsFor(spec, build));
      assert(issues.length === 0, `${JSON.stringify(build)} -> ${issues.join('; ')}`);
    });

    check(`${id}: a bipod reaches the ground and folds away`, () => {
      if (!canMount(def, 'bipod').ok) return;
      const p = placementFor(spec, 'bipod');
      assert(p.legLen > 0.12, `legs are only ${p.legLen} m: they would not reach a parapet`);
      assert(p.stowedAngle > p.deployedAngle, 'stowed legs should be folded further than deployed ones');
    });
  }

  group('hardware: clearance test has teeth');
  check('an optic hanging off the receiver is rejected', () => {
    const spec = MODEL_SPECS.m416;
    const bad = { optic: { ...placementFor(spec, 'scope3x'), pos: [0, 0.1, spec.zUpperRear + 0.05] } };
    assert(clearanceIssues(spec, bad).length > 0, 'an overhanging optic should be caught');
  });
  check('a can that ends inside the handguard is rejected', () => {
    const spec = MODEL_SPECS.m416;
    const can = placementFor(spec, 'suppressor');
    const bad = { muzzle: { ...can, crownZ: spec.hgZ1 + 0.02 } };
    assert(clearanceIssues(spec, bad).length > 0, 'a buried can should be caught');
  });
  check('a grip fighting the light for one slot is rejected', () => {
    const spec = MODEL_SPECS.m416;
    const tac = placementFor(spec, 'flashlight');
    const bad = {
      tactical: tac,
      underbarrel: { ...placementFor(spec, 'foregrip'), iface: tac.iface, pos: [tac.pos[0], tac.pos[1], tac.pos[2]] },
    };
    assert(clearanceIssues(spec, bad).length > 0, 'two parts on one slot should be caught');
  });

  group('hardware: light budget and runtime');
  const rigCode = existsSync(join(SRC, 'arsenal/hardware/rig.js'))
    ? readFileSync(join(SRC, 'arsenal/hardware/rig.js'), 'utf8')
    : '';
  const buildCode = existsSync(join(SRC, 'arsenal/hardware/build.js'))
    ? readFileSync(join(SRC, 'arsenal/hardware/build.js'), 'utf8')
    : '';
  check('the pool is a fixed, small number of real lights', () => {
    assert(LIGHT_POOL.spot === 1 && LIGHT_POOL.point === 0, JSON.stringify(LIGHT_POOL));
  });
  check('lights are created in the constructor, never on mount', () => {
    assert(rigCode.length > 0, 'rig.js is missing');
    const ctor = rigCode.slice(rigCode.indexOf('constructor('), rigCode.indexOf('/* ---------------------------------------------------------------- rails */'));
    assert(/new THREE\.SpotLight/.test(ctor), 'the spot light should exist from the start');
    const afterCtor = rigCode.slice(rigCode.indexOf('mount(attId)'));
    assert(!/new THREE\.SpotLight/.test(afterCtor), 'a light created on mount would stall the renderer');
  });
  check('toggling a torch changes an intensity, not the light count', () => {
    const fn = rigCode.slice(rigCode.indexOf('toggleLight()'), rigCode.indexOf('setBipod('));
    assert(/intensity/.test(fn), 'the toggle should drive intensity');
    assert(!/add\(|remove\(/.test(fn), 'the toggle must not add or remove anything from the scene');
  });
  check('the update path allocates nothing', () => {
    const fn = rigCode.slice(rigCode.indexOf('update(dt, aim)'), rigCode.indexOf('/* ------------------------------------------------------------- queries */'));
    assert(fn.length > 100, 'update() not found');
    assert(!/new [A-Z]/.test(fn), 'update() allocates: that is a garbage-collection spike every frame');
    assert(/_pos|_target/.test(fn), 'update() should reuse the module scratch vectors');
  });
  check('unmounting keeps geometry cached instead of rebuilding it', () => {
    assert(/this\.cache/.test(rigCode), 'no geometry cache');
    const un = rigCode.slice(rigCode.indexOf('unmount(slot)'), rigCode.indexOf('swap(slot, attId)'));
    assert(/visible = false/.test(un), 'unmount should hide, not destroy');
    assert(!/dispose\(\)/.test(un), 'unmount must not dispose: the player swaps back constantly');
  });
  check('dispose hands back the beam, the dot, the cache and the lights', () => {
    const fn = rigCode.slice(rigCode.indexOf('dispose() {'));
    for (const needle of ['beam', 'dot', 'cache.clear()', 'lights']) {
      assert(fn.includes(needle), `dispose() forgets ${needle}`);
    }
    assert((fn.match(/dispose\(\)/g) || []).length >= 5, 'dispose() looks too shallow to be real');
  });
  check('the builder uses the base parts kit and cleans up after itself', () => {
    assert(buildCode.length > 0, 'build.js is missing');
    for (const fn of ['addRail(', 'addMuzzleDevice(', 'buildOptic(', 'buildMiniReflex(', 'buildMagazine(', 'addForeGrip(']) {
      assert(buildCode.includes(fn), `builder never calls ${fn}`);
    }
    const disposes = (buildCode.match(/\.dispose\(\)/g) || []).length;
    assert(disposes >= 15, `only ${disposes} dispose() calls in the hardware builder`);
  });
  check('rails belong to the weapon, so an empty mount still reads as a mount', () => {
    assert(buildCode.includes('addMountingRails'), 'no rail builder');
    assert(rigCode.includes('static rails('), 'the weapon builder needs a way to add the rails');
  });
}

/* -------------------------------------------------------------------- main */
await hardware();

const WIDTH = 60;
for (const g of groups) {
  if (!g.tests) continue;
  const mark = g.failed ? 'FAIL' : ' ok ';
  const dots = '.'.repeat(Math.max(2, WIDTH - g.name.length));
  console.log(`[${mark}] ${g.name} ${dots} ${g.tests - g.failed}/${g.tests}`);
}
console.log('');
if (failures.length) {
  console.log(`${failures.length} failure(s):\n`);
  for (const f of failures) console.log(`  x ${f.group} / ${f.label}\n      ${f.message}`);
  process.exit(1);
}
console.log(`all green - ${passed} hardware checks passed`);
