/**
 * VERIFY-ARENA — the test gate for everything layered on top of the base engine.
 *
 * Separate from the base engine's own tools/verify.mjs on purpose: that one
 * needs a browser and a GPU, this one runs anywhere node runs.
 *
 *   --syntax   parse every source file, resolve every relative import
 *   --contract lint the engine contract: unique system ids, no Math.random,
 *              no cross-subsystem imports
 *   --unit     assertions against the pure (three-free) modules
 *
 * `node tools/verify-arena.mjs` runs all three. Exit code 1 on any failure.
 * The GPU gates (`npm run build`, headless boot, shot capture) run in CI.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/* ----------------------------------------------------------------- harness */
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

/* ------------------------------------------------------------------- files */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const ALL = walk(SRC);
/** Directories added by this project (the base engine's stay untouched). */
const NEW_DIRS = ['arsenal', 'modes', 'net', 'shell'];
const NEW = ALL.filter((p) => NEW_DIRS.some((d) => p.startsWith(join(SRC, d))));

/* ------------------------------------------------------------------ syntax */
async function syntax() {
  const { execFileSync } = await import('node:child_process');

  group('syntax');
  for (const file of ALL) {
    const rel = relative(ROOT, file);
    check(`parses ${rel}`, () => {
      // node --check honours package.json "type": "module", so this is the real
      // ESM parser rather than a regex approximation of one.
      try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      } catch (err) {
        const out = `${err.stderr ?? ''}`.split('\n').filter(Boolean);
        throw new Error(out[out.length - 1] ?? 'parse failed');
      }
    });
  }

  group('import graph');
  for (const file of ALL) {
    const code = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    const specs = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of specs) {
      if (!spec.startsWith('.')) continue;
      check(`${rel} -> ${spec}`, () => {
        const target = resolve(dirname(file), spec);
        const ok =
          (existsSync(target) && statSync(target).isFile()) ||
          existsSync(`${target}.js`) ||
          existsSync(join(target, 'index.js'));
        assert(ok, `unresolved import ${spec}`);
      });
    }
  }
}

/* ---------------------------------------------------------------- contract */
async function contract() {
  group('engine contract: system ids');
  const ids = new Map();
  for (const file of ALL) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(/static\s+id\s*=\s*'([^']+)'/g)) {
      const rel = relative(ROOT, file);
      const id = m[1];
      check(`"${id}" is unique`, () => {
        assert(!ids.has(id), `duplicate id "${id}" in ${rel} and ${ids.get(id)}`);
      });
      ids.set(id, rel);
    }
  }
  check('the base subsystem set is intact', () => {
    assert(ids.size >= 11, `found only ${ids.size} subsystem ids`);
  });

  group('engine contract: determinism');
  for (const file of NEW) {
    const code = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    check(`${rel} uses ctx.rng, not Math.random`, () => {
      assert(!/Math\.random/.test(code), 'Math.random() breaks lockstep capture; use ctx.rng');
    });
  }

  group('engine contract: subsystem isolation');
  const KIT_FILES = new Set(['weapons/geometry.js', 'weapons/parts.js', 'weapons/mathx.js']);
  const SUBSYSTEM_DIRS = new Set([
    ...NEW_DIRS, 'ai', 'audio', 'fx', 'materials', 'physics', 'player', 'render', 'sky', 'ui', 'weapons', 'world',
  ]);
  for (const file of NEW) {
    const code = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file);
    const mine = relative(SRC, file).split('/')[0];
    for (const m of code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const spec = m[1];
      const target = relative(SRC, resolve(dirname(file), spec));
      const owner = target.split('/')[0];
      if (!SUBSYSTEM_DIRS.has(owner) || owner === mine) continue;
      // The parts kit is a stateless geometry library that the base engine's own
      // models import the same way; it holds no subsystem state to reach into.
      if (KIT_FILES.has(target)) continue;
      check(`${rel} does not reach into ${owner}/`, () => {
        assert(false, `cross-subsystem import of ${owner}/: use ctx.get('${owner}') instead`);
      });
    }
  }
}

/* -------------------------------------------------------------------- unit */
async function unit() {
  if (!existsSync(join(SRC, 'arsenal/defs.js'))) return;
  const D = await import(pathToFileURL(join(SRC, 'arsenal/defs.js')).href);
  const A = await import(pathToFileURL(join(SRC, 'arsenal/attachments.js')).href);
  const { ARSENAL_DEFS, ARSENAL_ORDER, SLOTS, cycleTime, damageAt, weaponsInSlot } = D;

  group('arsenal: roster');
  check('nine weapons, all listed in display order', () => {
    const keys = Object.keys(ARSENAL_DEFS);
    assert(keys.length === 9, `expected 9 weapons, got ${keys.length}`);
    for (const k of keys) assert(ARSENAL_ORDER.includes(k), `${k} missing from ARSENAL_ORDER`);
    assert(ARSENAL_ORDER.length === 9, 'ARSENAL_ORDER has strays');
  });

  const REQUIRED = [
    'id', 'label', 'class', 'slot', 'caliber', 'rpm', 'modes', 'magSize', 'reserve',
    'muzzleVelocity', 'damage', 'penetration', 'dropoff', 'maxRange', 'dragK',
    'spreadHip', 'spreadAds', 'spreadPerShot', 'spreadMax', 'spreadDecay', 'recoil',
    'adsTime', 'adsFov', 'viewFov', 'reloadTac', 'reloadEmpty', 'inspectTime',
    'drawTime', 'holsterTime', 'hipPos', 'hipRot', 'sprintPos', 'sprintRot',
    'lowReadyPos', 'lowReadyRot', 'adsCant', 'eyeRelief', 'mounts', 'weight',
  ];
  const RECOIL_KEYS = [
    'pitch', 'yaw', 'kickBack', 'kickUp', 'roll', 'punch', 'freq', 'damping',
    'patternLength', 'patternSeed', 'climbShape', 'drift',
  ];

  for (const id of ARSENAL_ORDER) {
    const def = ARSENAL_DEFS[id];
    group(`arsenal: ${id}`);
    check('schema complete', () => {
      for (const key of REQUIRED) assert(def[key] !== undefined, `missing ${key}`);
      for (const key of RECOIL_KEYS) assert(def.recoil[key] !== undefined, `missing recoil.${key}`);
    });
    check('id matches its key', () => assert(def.id === id, `def.id=${def.id}`));
    check('carry slot is valid', () => assert(SLOTS.includes(def.slot), `bad slot ${def.slot}`));
    check('poses are finite 3-vectors', () => {
      for (const key of ['hipPos', 'hipRot', 'sprintPos', 'sprintRot', 'lowReadyPos', 'lowReadyRot', 'adsCant']) {
        assert(Array.isArray(def[key]) && def[key].length === 3, `${key} is not [x,y,z]`);
        for (const v of def[key]) assert(Number.isFinite(v), `${key} has a non-finite component`);
      }
    });
    check('numbers are in sane ranges', () => {
      assert(def.rpm >= 60 && def.rpm <= 1300, `rpm ${def.rpm}`);
      assert(def.magSize >= 1 && def.magSize <= 100, `magSize ${def.magSize}`);
      assert(def.damage > 0 && def.damage <= 120, `damage ${def.damage}`);
      assert(def.muzzleVelocity >= 250 && def.muzzleVelocity <= 1100, `v0 ${def.muzzleVelocity}`);
      assert(def.adsTime > 0.05 && def.adsTime < 1.0, `adsTime ${def.adsTime}`);
      assert(def.spreadAds < def.spreadHip, 'ADS must be tighter than the hip');
      assert(def.spreadMax > def.spreadHip, 'spreadMax must exceed the resting hip cone');
      assert(def.reloadEmpty >= def.reloadTac, 'empty reload cannot be faster than tactical');
      assert(def.eyeRelief > 0 && def.eyeRelief < 0.5, `eyeRelief ${def.eyeRelief}`);
      assert(def.adsFov > 0.2 && def.adsFov <= 1, `adsFov ${def.adsFov}`);
    });
    check('fire modes are known', () => {
      const KNOWN = ['auto', 'burst', 'semi', 'pump'];
      assert(def.modes.length > 0, 'no fire modes');
      for (const m of def.modes) assert(KNOWN.includes(m), `unknown mode ${m}`);
    });
    check('mount points are real slots', () => {
      for (const s of def.mounts) assert(A.SLOT_ORDER.includes(s), `unknown mount ${s}`);
    });
    check('damage falls off monotonically and never reaches zero', () => {
      let prev = Infinity;
      for (let d = 0; d <= def.maxRange; d += def.maxRange / 12) {
        const dmg = damageAt(def, d);
        assert(dmg <= prev + 1e-9, `damage rose at ${d} m`);
        assert(dmg > 0, `damage hit zero at ${d} m`);
        prev = dmg;
      }
    });
    check('recoil pattern is long enough to learn', () => {
      assert(def.recoil.patternLength >= 8, 'pattern too short');
      assert(def.recoil.climbShape.length >= 1, 'climbShape empty');
      assert(def.recoil.freq > 0 && def.recoil.damping > 0, 'spring would not settle');
    });
  }

  group('arsenal: ported values match FPS Arena');
  const PORTED = {
    akm: { magSize: 30, muzzleVelocity: 715, adsTime: 0.32, rpm: 600 },
    ak74: { magSize: 30, muzzleVelocity: 900, adsTime: 0.3 },
    m416: { magSize: 30, muzzleVelocity: 880, adsTime: 0.27 },
    scar: { magSize: 20, muzzleVelocity: 870, adsTime: 0.34 },
    svd: { magSize: 10, muzzleVelocity: 830, adsTime: 0.42 },
    mp5: { magSize: 30, muzzleVelocity: 400, adsTime: 0.22 },
    m870: { magSize: 6, muzzleVelocity: 400, adsTime: 0.3 },
    glock18: { magSize: 17, muzzleVelocity: 375, adsTime: 0.15 },
    deagle: { magSize: 9, muzzleVelocity: 470, adsTime: 0.22 },
  };
  for (const [id, want] of Object.entries(PORTED)) {
    check(`${id} keeps its FPS Arena numbers`, () => {
      const def = ARSENAL_DEFS[id];
      for (const [k, v] of Object.entries(want)) near(def[k], v, 1e-6, `${id}.${k}`);
    });
  }
  check('cadence conversion matches the old fireRate', () => {
    near(cycleTime(ARSENAL_DEFS.akm, 'auto'), 0.1, 1e-3, 'akm');
    near(cycleTime(ARSENAL_DEFS.m416, 'auto'), 0.085, 1e-3, 'm416');
    near(cycleTime(ARSENAL_DEFS.m870, 'pump'), 0.857, 2e-3, 'm870');
  });
  check('Glock auto sear is faster than its semi cadence', () => {
    const g = ARSENAL_DEFS.glock18;
    assert(cycleTime(g, 'auto') < cycleTime(g, 'semi'), 'auto sear not faster');
  });
  check('shotgun carries pellet data, nothing else does', () => {
    assert(ARSENAL_DEFS.m870.pellets === 9, 'M870 lost its nine pellets');
    for (const id of ARSENAL_ORDER) {
      if (id === 'm870') continue;
      assert(!ARSENAL_DEFS[id].pellets, `${id} should not fire pellets`);
    }
  });
  check('SVD carries breath-hold data and comes scoped', () => {
    assert(ARSENAL_DEFS.svd.breathHold, 'no breath hold');
    assert(ARSENAL_DEFS.svd.defaultOptic === 'pso4x', 'SVD should come scoped');
  });
  check('every carry slot has at least one weapon', () => {
    for (const slot of SLOTS) assert(weaponsInSlot(slot).length > 0, `slot ${slot} empty`);
  });
  check('relative lethality survived the damage conversion', () => {
    const d = (id) => ARSENAL_DEFS[id].damage;
    assert(d('svd') > d('deagle'), 'SVD should out-hit the Deagle');
    assert(d('deagle') > d('scar'), 'Deagle should out-hit SCAR-H per shot');
    assert(d('scar') > d('akm'), 'SCAR-H should out-hit the AKM');
    assert(d('akm') > d('ak74'), 'AKM (7.62) should out-hit the AK-74 (5.45)');
    assert(d('ak74') > d('m416'), 'AK-74 should out-hit the M416');
    assert(d('m416') > d('glock18'), 'a rifle should out-hit a pistol');
    assert(d('m870') * ARSENAL_DEFS.m870.pellets > 100, 'a centred shotgun load should kill');
  });

  /* --------------------------------------------------------- attachments */
  const {
    ATTACHMENTS, SLOT_ORDER, BY_SLOT, canMount, defaultLoadout, resolveStats, nextOptic, statDelta,
  } = A;

  group('attachments: catalog');
  check('every entry is well formed', () => {
    for (const [id, att] of Object.entries(ATTACHMENTS)) {
      assert(att.id === id, `${id}: id mismatch`);
      assert(SLOT_ORDER.includes(att.slot), `${id}: bad slot ${att.slot}`);
      assert(typeof att.label === 'string' && att.label.length, `${id}: no label`);
      assert(typeof att.mass === 'number', `${id}: no mass`);
      assert(att.mul && att.add, `${id}: missing modifier tables`);
    }
  });
  check('every slot offers something', () => {
    for (const slot of SLOT_ORDER) assert(BY_SLOT[slot].length > 0, `slot ${slot} is empty`);
  });
  check('all four FPS Arena sight tiers survived the port', () => {
    for (const id of ['iron', 'reddot', 'holo', 'scope3x']) assert(ATTACHMENTS[id], `missing optic ${id}`);
  });
  check('optics, laser, light and can are all removable', () => {
    for (const id of ['reddot', 'holo', 'scope3x', 'pso4x', 'laser', 'flashlight', 'suppressor']) {
      assert(ATTACHMENTS[id].detachable, `${id} must be removable`);
    }
    assert(ATTACHMENTS.iron.detachable === false, 'irons are part of the gun');
  });
  check('more magnification costs more ADS time', () => {
    const t = (id) => ATTACHMENTS[id].mul.adsTime ?? 1;
    assert(t('reddot') < t('holo') && t('holo') < t('scope3x') && t('scope3x') < t('pso4x'),
      'ADS penalty should grow with magnification');
    const z = (id) => ATTACHMENTS[id].zoom;
    assert(z('reddot') > z('holo') && z('holo') > z('scope3x') && z('scope3x') > z('pso4x'),
      'FOV scale should shrink with magnification');
  });

  group('attachments: compatibility');
  check('PSO-1 only fits the AK family and the SVD', () => {
    assert(canMount(ARSENAL_DEFS.svd, 'pso4x').ok, 'SVD should take a PSO');
    assert(canMount(ARSENAL_DEFS.akm, 'pso4x').ok, 'AKM should take a PSO');
    assert(!canMount(ARSENAL_DEFS.m416, 'pso4x').ok, 'M416 must not take a PSO');
  });
  check('pistols reject foregrips and mag mounts they do not have', () => {
    assert(!canMount(ARSENAL_DEFS.glock18, 'foregrip').ok, 'no foregrip on a Glock');
    assert(!canMount(ARSENAL_DEFS.glock18, 'magExtended').ok, 'Glock has no magazine mount listed');
  });
  check('the tube-fed shotgun rejects cans and box mags', () => {
    assert(!canMount(ARSENAL_DEFS.m870, 'suppressor').ok, 'M870 must not take a can');
    assert(!canMount(ARSENAL_DEFS.m870, 'magExtended').ok, 'M870 is tube-fed');
    assert(canMount(ARSENAL_DEFS.m870, 'reddot').ok, 'M870 should take a red dot');
  });
  check('bipods only fit rifles and marksman rifles', () => {
    assert(canMount(ARSENAL_DEFS.svd, 'bipod').ok, 'SVD should take a bipod');
    assert(!canMount(ARSENAL_DEFS.mp5, 'bipod').ok, 'no bipod on an MP5');
  });
  check('unknown ids fail softly with a reason', () => {
    const r = canMount(ARSENAL_DEFS.akm, 'railgun');
    assert(r.ok === false && typeof r.reason === 'string', 'should fail softly');
  });

  group('attachments: stat resolution');
  check('default loadout is irons plus a standard mag', () => {
    const l = defaultLoadout(ARSENAL_DEFS.m416);
    assert(l.optic === 'iron' && l.magazine === 'magStandard', JSON.stringify(l));
    assert(defaultLoadout(ARSENAL_DEFS.svd).optic === 'pso4x', 'SVD default optic');
    assert(defaultLoadout(ARSENAL_DEFS.m870).magazine === undefined, 'M870 has no mag slot');
  });
  check('resolving never mutates the definition', () => {
    const before = JSON.stringify(ARSENAL_DEFS.akm);
    resolveStats(ARSENAL_DEFS.akm, { optic: 'holo', muzzle: 'suppressor', magazine: 'magExtended' });
    assert(JSON.stringify(ARSENAL_DEFS.akm) === before, 'def was mutated');
  });
  check('suppressor trades velocity and damage for silence', () => {
    const base = defaultLoadout(ARSENAL_DEFS.akm);
    const bare = resolveStats(ARSENAL_DEFS.akm, base);
    const can = resolveStats(ARSENAL_DEFS.akm, { ...base, muzzle: 'suppressor' });
    assert(can.silent === true, 'not silent');
    assert(can.muzzleVelocity < bare.muzzleVelocity, 'velocity unchanged');
    assert(can.damage < bare.damage, 'damage unchanged');
    assert(can.flashScale < bare.flashScale * 0.3, 'flash not hidden');
    assert(can.adsTime > bare.adsTime, 'extra mass should slow the aim');
    assert(can.weight > bare.weight, 'mass not added');
  });
  check('extended magazine grows the mag and slows the reload', () => {
    const d = ARSENAL_DEFS.m416;
    const ext = resolveStats(d, { ...defaultLoadout(d), magazine: 'magExtended' });
    assert(ext.magSize === 42, `expected 42, got ${ext.magSize}`);
    assert(Number.isInteger(ext.magSize), 'magazine must be a whole number of rounds');
    assert(ext.reloadTac > d.reloadTac, 'reload unchanged');
    assert(ext.magLen > d.magLen, 'the model should also get a longer mag');
  });
  check('quickdraw magazine only speeds up reloads', () => {
    const d = ARSENAL_DEFS.akm;
    const q = resolveStats(d, { ...defaultLoadout(d), magazine: 'magQuick' });
    assert(q.reloadTac < d.reloadTac, 'reload unchanged');
    assert(q.magSize === d.magSize, 'mag size should not change');
  });
  check('optic sets the ADS zoom, eye relief and reticle kind', () => {
    const d = ARSENAL_DEFS.akm;
    const holo = resolveStats(d, { optic: 'holo' });
    assert(holo.zoom === ATTACHMENTS.holo.zoom, 'zoom not applied');
    near(holo.relief, d.eyeRelief + ATTACHMENTS.holo.relief, 1e-9, 'relief');
    assert(holo.opticKind === 'holo', 'opticKind not reported');
  });
  check('laser tightens the hip cone only while it is lit', () => {
    const d = ARSENAL_DEFS.akm;
    const on = resolveStats(d, { tactical: 'laser' }, { laserOn: true });
    const off = resolveStats(d, { tactical: 'laser' }, { laserOn: false });
    near(on.spreadHip, d.spreadHip * 0.72, 1e-6, 'lit');
    near(off.spreadHip, d.spreadHip, 1e-6, 'dark');
    assert(on.hasLaser && off.hasLaser, 'laser presence lost');
  });
  check('flashlight reports a light spec the renderer can use', () => {
    const s = resolveStats(ARSENAL_DEFS.m416, { tactical: 'flashlight' });
    assert(s.hasLight && s.light && s.light.angle > 0 && s.light.distance > 0, 'no usable light spec');
  });
  check('bipod bonus applies only when deployed', () => {
    const d = ARSENAL_DEFS.svd;
    const up = resolveStats(d, { underbarrel: 'bipod' });
    const down = resolveStats(d, { underbarrel: 'bipod' }, { bipodDeployed: true });
    assert(down.recoilPitch < up.recoilPitch, 'deployed bipod did nothing');
    assert(down.spreadAds < up.spreadAds, 'deployed bipod did not steady the aim');
  });
  check('incompatible entries are reported, not silently mounted', () => {
    const s = resolveStats(ARSENAL_DEFS.m416, { optic: 'pso4x' });
    assert(s.rejected.length === 1, 'expected one rejection');
    assert(s.attachments.optic === undefined, 'illegal optic was mounted');
    assert(s.zoom === ARSENAL_DEFS.m416.adsFov, 'zoom should fall back to irons');
  });
  check('a maximal build on every weapon stays finite and playable', () => {
    for (const id of ARSENAL_ORDER) {
      const def = ARSENAL_DEFS[id];
      const build = { ...defaultLoadout(def) };
      for (const slot of SLOT_ORDER) {
        const pick = BY_SLOT[slot].find((a) => canMount(def, a).ok && ATTACHMENTS[a].detachable);
        if (pick) build[slot] = pick;
      }
      const s = resolveStats(def, build, { laserOn: true });
      assert(s.rejected.length === 0, `${id}: ${JSON.stringify(s.rejected)}`);
      for (const key of ['damage', 'adsTime', 'spreadHip', 'spreadAds', 'magSize', 'recoilPitch', 'weight', 'muzzleVelocity']) {
        assert(Number.isFinite(s[key]) && s[key] > 0, `${id}.${key} = ${s[key]}`);
      }
      assert(s.spreadAds < s.spreadHip, `${id}: the ADS cone must stay tighter than the hip`);
      assert(s.adsTime < 1.4, `${id}: ADS time ${s.adsTime.toFixed(2)} s is unplayable`);
    }
  });
  check('optic cycling walks the ring and comes home', () => {
    const d = ARSENAL_DEFS.akm;
    const seen = new Set();
    let cur = 'iron';
    for (let i = 0; i < 12; i += 1) {
      cur = nextOptic(d, cur);
      seen.add(cur);
      if (cur === 'iron' && i > 0) break;
    }
    assert(seen.has('reddot') && seen.has('holo') && seen.has('scope3x'), `ring was ${[...seen]}`);
    assert(cur === 'iron', 'cycle did not return to irons');
  });
  check('optic cycling respects what the player owns', () => {
    const d = ARSENAL_DEFS.m416;
    const owned = new Set(['reddot']);
    let cur = 'iron';
    const ring = [];
    for (let i = 0; i < 4; i += 1) {
      cur = nextOptic(d, cur, owned);
      ring.push(cur);
    }
    assert(!ring.includes('holo'), 'offered an unowned holo sight');
    assert(ring.includes('reddot'), 'never offered the owned red dot');
  });
  check('stat delta reads the right way round', () => {
    const d = ARSENAL_DEFS.akm;
    const rows = statDelta(d, { ...defaultLoadout(d), muzzle: 'brake', magazine: 'magExtended' });
    const byStat = Object.fromEntries(rows.map((r) => [r.stat, r]));
    assert(byStat.recoilPitch?.better, 'a brake should read as an improvement');
    assert(byStat.magSize?.better, 'a bigger mag should read as an improvement');
    assert(byStat.reloadTac && !byStat.reloadTac.better, 'a slower reload should read as a downside');
  });
}

/* ------------------------------------------------------------------ models */
/**
 * Step 2 of the plan: the nine weapon models.
 *
 * build.js needs three.js, so it cannot be imported here. That is deliberate:
 * everything that decides how a weapon LOOKS and where a hand GOES lives in
 * specs.js as plain data, which is fully testable offline. build.js is then
 * checked structurally - that it calls the parts kit and publishes every node.
 */
async function models() {
  const specsPath = join(SRC, 'arsenal/models/specs.js');
  if (!existsSync(specsPath)) return;
  const S = await import(pathToFileURL(specsPath).href);
  const D = await import(pathToFileURL(join(SRC, 'arsenal/defs.js')).href);
  const {
    MODEL_SPECS, MODEL_ORDER, REQUIRED_NODES, MUZZLE_LEN,
    specFor, layoutOf, nodesOf, triangleEstimate, validateSpec,
  } = S;
  const { ARSENAL_DEFS, ARSENAL_ORDER, CLASS_ARCHETYPES } = D;

  group('models: roster');
  check('a spec for every weapon in the arsenal, in the same order', () => {
    assert(MODEL_ORDER.length === 9, `expected 9 specs, got ${MODEL_ORDER.length}`);
    assert(MODEL_ORDER.join() === ARSENAL_ORDER.join(), 'model order diverged from the arsenal order');
    for (const id of MODEL_ORDER) assert(MODEL_SPECS[id], `no spec for ${id}`);
  });
  check('every architecture is represented', () => {
    const seen = new Set(MODEL_ORDER.map((id) => MODEL_SPECS[id].pattern));
    for (const p of ['ar', 'ak', 'battle', 'dmr', 'smg', 'pump', 'pistol']) {
      assert(seen.has(p), `no weapon uses the ${p} pattern`);
    }
  });
  check('the local muzzle table matches the parts kit', () => {
    const kit = readFileSync(join(SRC, 'weapons/parts.js'), 'utf8');
    const m = kit.match(/MUZZLE_LEN\s*=\s*\{([^}]+)\}/);
    assert(m, 'MUZZLE_LEN not found in parts.js');
    for (const pair of m[1].split(',')) {
      const [k, v] = pair.split(':').map((s) => s.trim());
      if (!k) continue;
      near(MUZZLE_LEN[k], Number(v), 1e-9, `muzzle device ${k}:`);
    }
  });

  for (const id of MODEL_ORDER) {
    const spec = specFor(id);
    const def = ARSENAL_DEFS[id];
    const L = layoutOf(spec);
    const nodes = nodesOf(spec);
    group(`models: ${id}`);

    check('spec is internally consistent', () => {
      assert(validateSpec(spec) === true, 'validateSpec did not pass');
      assert(spec.id === id, 'spec id does not match its key');
      assert(spec.features.length >= 5, `only ${spec.features.length} detail features`);
      assert(spec.rollmarks.length >= 1, 'no engraving: the receiver will read as an extrusion');
    });

    check('geometry agrees with the ballistics data', () => {
      near(spec.bore, CLASS_ARCHETYPES[def.class].bore, 1e-9, 'bore height:');
      near(spec.mag.len, def.magLen, 1e-9, 'magazine length:');
      assert(spec.label === def.label, `label ${spec.label} != ${def.label}`);
    });

    check('parts are ordered front to back with no overlap', () => {
      assert(L.muzzleZ < spec.zBarrelEnd + 1e-9, 'muzzle device points backwards');
      assert(spec.zBarrelEnd < spec.zUpperFront, 'barrel ends behind the receiver');
      assert(spec.portZ < spec.zUpperRear && spec.portZ > spec.zUpperFront, 'ejection port is off the receiver');
      if (spec.hgR !== null) {
        assert(spec.hgZ1 > L.muzzleZ, 'handguard covers the muzzle');
        assert(spec.handZ < spec.hgZ0 && spec.handZ > spec.hgZ1, 'support hand is off the handguard');
      }
    });

    check('overall length is plausible', () => {
      // Real figures, because a weapon that is the wrong SIZE is the one thing a
      // player notices instantly: a Glock 18 is 186 mm end to end, a Desert Eagle
      // 269 mm, an MP5 with the stock in 490 mm, an SVD 1225 mm.
      const [lo, hi] = spec.pattern === 'pistol' ? [0.15, 0.33] : [0.42, 1.25];
      assert(L.overall > lo && L.overall < hi, `overall length ${L.overall.toFixed(3)} m out of ${lo}-${hi} m`);
      assert(L.barrelLen > 0.1 || spec.pattern === 'pistol', `barrel only ${L.barrelLen.toFixed(3)} m`);
      if (spec.pattern === 'pistol') {
        assert(L.barrelLen > 0.08 && L.barrelLen < 0.2, `pistol barrel ${L.barrelLen.toFixed(3)} m`);
      }
    });

    check('sight line sits over the bore, not in it', () => {
      assert(L.sightOverBore > 0.02 && L.sightOverBore < 0.08, `optic ${L.sightOverBore.toFixed(3)} m over bore`);
      assert(L.railTop > spec.bore, 'rail deck is below the bore');
      assert(nodes.ironSight[1] > L.railTop, 'iron sight is inside the rail');
    });

    check('publishes every node the weapons system reads', () => {
      for (const key of REQUIRED_NODES) {
        if (key === 'opticGlass') continue; // built from real geometry in build.js
        assert(nodes[key] !== undefined, `missing node ${key}`);
      }
    });

    check('node shapes match the engine contract', () => {
      for (const key of ['muzzle', 'chamber', 'eject', 'ejectDir', 'sight', 'sightAxis', 'ironSight', 'magDrop']) {
        assert(Array.isArray(nodes[key]) && nodes[key].length === 3, `${key} must be a 3-vector`);
        for (const n of nodes[key]) assert(Number.isFinite(n), `${key} has a non-finite component`);
      }
      for (const key of ['chargePull', 'boltTravel']) {
        assert(Array.isArray(nodes[key]) && nodes[key].length === 3, `${key} must be a travel vector`);
      }
      assert(typeof nodes.triggerPull === 'number', 'triggerPull is a rotation in radians');
      for (const key of ['gripR', 'gripL']) {
        const g = nodes[key];
        for (const part of ['pos', 'finger', 'back']) {
          assert(Array.isArray(g[part]) && g[part].length === 3, `${key}.${part} must be a 3-vector`);
        }
        const len = Math.hypot(...g.finger);
        near(len, 1, 0.2, `${key}.finger should be a direction, its length is`);
      }
      for (const key of ['chargeRest', 'boltRest', 'triggerPivot', 'selectorPivot', 'magSeat']) {
        assert(Array.isArray(nodes[key].pos) && nodes[key].pos.length === 3, `${key}.pos must be a 3-vector`);
        assert(Array.isArray(nodes[key].rot) && nodes[key].rot.length === 3, `${key}.rot must be a 3-vector`);
      }
    });

    check('brass ejects right and up, and clears the shooter', () => {
      const d = nodes.ejectDir;
      assert(d[0] > 0.5, 'cases should fly to the right');
      assert(d[1] > 0.3, 'cases should fly upward, not into the receiver');
      near(Math.hypot(...d), 1, 0.15, 'ejection direction length');
      assert(nodes.eject[0] > 0, 'ejection port is on the wrong side');
    });

    check('support hand rides the handguard, under the bore', () => {
      const g = nodes.gripL;
      assert(g.pos[1] < spec.bore, 'support hand is above the bore: it would cover the sights');
      if (spec.hgR !== null) {
        assert(nodes.handguard.r > spec.hgR, 'grip cylinder ignores the handguard panels');
        assert(nodes.handguard.z0 > nodes.handguard.z1, 'handguard cylinder runs backwards');
      }
    });

    check('triangle budget stays within reach of the reference M4A1', () => {
      const base = triangleEstimate(MODEL_SPECS.m416);
      const t = triangleEstimate(spec);
      assert(t > base * 0.4, `${t} tris is too cheap to hold up in ADS`);
      assert(t < base * 2.5, `${t} tris blows the budget (${base} for the reference)`);
    });
  }

  group('models: architectures differ, not just numbers');
  check('an AK is not an AR with different figures', () => {
    const ak = MODEL_SPECS.akm;
    const ar = MODEL_SPECS.m416;
    assert(ak.features.includes('gasTube') && !ar.features.includes('gasTube'), 'AK needs its gas tube');
    assert(ak.features.includes('sideRail') && !ar.features.includes('sideRail'), 'AK mounts optics on the side');
    assert(nodesOf(ak).sideRail, 'AK should publish a side rail node');
    assert(!nodesOf(ar).sideRail, 'an AR has no side rail');
    assert(ak.magTilt > ar.magTilt, 'the AK magazine rocks in at a steeper angle');
  });
  check('the pump has no detachable magazine but does have a forend', () => {
    const n = nodesOf(MODEL_SPECS.m870);
    assert(MODEL_SPECS.m870.mag.len === 0, 'a tube-fed shotgun has no box magazine');
    assert(MODEL_SPECS.m870.tubeMag, 'no magazine tube');
    assert(n.forendRest && n.forendTravel, 'the forend has to be a moving part');
    assert(n.shellPort, 'shell-by-shell reloads need a loading port');
  });
  check('pistols carry a slide and no stock', () => {
    for (const id of ['glock18', 'deagle']) {
      const s = MODEL_SPECS[id];
      assert(s.slide, `${id} needs a slide`);
      assert(s.stockRear === null, `${id} should not have a stock`);
      assert(s.hgR === null, `${id} should not have a handguard`);
      assert(Math.hypot(...nodesOf(s).boltTravel) < 0.04, 'slide travel is shorter than a rifle bolt');
    }
  });
  check('the SVD is the longest weapon and the Glock the shortest', () => {
    const lens = MODEL_ORDER.map((id) => [id, layoutOf(MODEL_SPECS[id]).overall]);
    lens.sort((a, b) => b[1] - a[1]);
    assert(lens[0][0] === 'svd', `longest weapon is ${lens[0][0]}, expected the SVD`);
    assert(lens[lens.length - 1][0] === 'glock18', `shortest is ${lens[lens.length - 1][0]}`);
  });
  check('validateSpec actually rejects bad geometry', () => {
    let threw = false;
    try {
      validateSpec({ ...MODEL_SPECS.m416, zBarrelEnd: 0.2 });
    } catch {
      threw = true;
    }
    assert(threw, 'a barrel behind the breech should be rejected');
  });

  group('models: builder wiring');
  const buildPath = join(SRC, 'arsenal/models/build.js');
  const code = existsSync(buildPath) ? readFileSync(buildPath, 'utf8') : '';
  check('builder exists and uses the base engine parts kit', () => {
    assert(code.length > 0, 'build.js is missing');
    for (const fn of [
      'addUpperReceiver', 'addLowerReceiver', 'addBarrel', 'addMuzzleDevice', 'addHandguard',
      'addRail', 'addPistolGrip', 'addCarbineStock', 'addFrontSight', 'addRearSight',
      'addRollmark', 'buildMagazine', 'buildOptic', 'buildSlide', 'buildMiniReflex',
      'triggerPart', 'selectorPart', 'chargingHandlePart', 'cartridge',
    ]) {
      assert(code.includes(`${fn}(`), `builder never calls ${fn}`);
    }
  });
  check('builder publishes the full node set and the moving parts', () => {
    assert(code.includes('nodesOf(spec)'), 'builder should take its nodes from the tested specs');
    assert(code.includes('nodes.opticGlass'), 'the optic node has to come from the built glass');
    for (const part of ['magazine', 'charging', 'bolt', 'trigger', 'selector']) {
      assert(code.includes(part), `no moving part named ${part}`);
    }
  });
  check('builder disposes the geometry it creates', () => {
    const disposes = (code.match(/\.dispose\(\)/g) || []).length;
    assert(disposes >= 12, `only ${disposes} dispose() calls: geometry would leak on rebuild`);
  });
  check('builder validates before it builds', () => {
    assert(code.includes('validateSpec(spec)'), 'a bad spec should fail loudly, not build silently');
  });
}

/* -------------------------------------------------------------------- main */
const args = process.argv.slice(2);
const want = (flag) => args.length === 0 || args.includes(flag);

if (want('--syntax')) await syntax();
if (want('--contract')) await contract();
if (want('--unit')) await unit();
if (want('--unit')) await models();

const WIDTH = 60;
let quietSyntax = 0;
for (const g of groups) {
  if (!g.tests) continue;
  // The per-file syntax and import checks are numerous and dull; collapse them.
  if (g.name === 'syntax' || g.name === 'import graph') {
    quietSyntax += g.tests;
    if (g.failed === 0) {
      console.log(`[ ok ] ${g.name} ${'.'.repeat(Math.max(2, WIDTH - g.name.length))} ${g.tests}/${g.tests}`);
      continue;
    }
  }
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
console.log(`all green - ${passed} checks passed (${quietSyntax} of them file-level)`);
