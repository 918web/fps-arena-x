#!/usr/bin/env node
/**
 * Step 4 gate — the gunsmith board.
 *
 * Two kinds of check:
 *   data    real ATTACHMENTS/defs pushed through the same functions the board
 *           calls, so a build the board offers cannot be one the rig rejects.
 *   source  properties that only exist as code shape and would otherwise be
 *           found by a player: a second stat table, an unbounded light, a
 *           renderer state leak, geometry that is never released.
 *
 * The board itself imports three.js, so it cannot be executed here (no GPU, no
 * DOM). Anything needing a live canvas is deferred to the CI pixel gate.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const WIDTH = 60;

let passed = 0;
let failed = 0;

function group(name) {
  console.log(`\n${name}`);
  console.log('-'.repeat(WIDTH));
}

function check(label, fn) {
  try {
    const note = fn();
    passed += 1;
    console.log(`  ok   ${label}${note ? ` — ${note}` : ''}`);
  } catch (err) {
    failed += 1;
    console.log(`  x    ${label}`);
    console.log(`       ${err.message}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const read = (rel) => readFileSync(join(SRC, rel), 'utf8');
const load = (rel) => import(pathToFileURL(join(SRC, rel)).href);

const {
  ATTACHMENTS,
  BY_SLOT,
  SLOT_ORDER,
  SLOT_LABELS,
  canMount,
  defaultLoadout,
  resolveStats,
  statDelta,
} = await load('arsenal/attachments.js');
const { ARSENAL_DEFS, ARSENAL_ORDER, SLOTS, weaponsInSlot } = await load('arsenal/defs.js');

async function gunsmith() {
  const screen = read('shell/screen.js');
  const preview = read('shell/preview.js');
  const bench = read('shell/bench.js');
  const shell = read('shell/index.js');
  const style = read('shell/style.js');
  const mesh = read('arsenal/mesh.js');
  const rig = read('arsenal/hardware/rig.js');

  /* ------------------------------------------------- board data contract --- */
  group('gunsmith: board data contract');

  check('every slot the board can show has a label and parts', () => {
    for (const slot of SLOT_ORDER) {
      assert(SLOT_LABELS[slot], `slot ${slot} has no label`);
      assert((BY_SLOT[slot] ?? []).length > 0, `slot ${slot} has no attachments`);
    }
    return `${SLOT_ORDER.length} slots`;
  });

  check('every part the board lists has a name and an explanation', () => {
    for (const [id, att] of Object.entries(ATTACHMENTS)) {
      assert(att.label && att.label.length > 1, `${id} has no label`);
      assert(att.note && att.note.length > 12, `${id} has no usable note`);
    }
    return `${Object.keys(ATTACHMENTS).length} parts`;
  });

  check('an incompatible part always says WHY', () => {
    let refusals = 0;
    for (const id of ARSENAL_ORDER) {
      for (const attId of Object.keys(ATTACHMENTS)) {
        const r = canMount(ARSENAL_DEFS[id], attId);
        if (r.ok) continue;
        refusals += 1;
        assert(typeof r.reason === 'string' && r.reason.length > 8, `${id}/${attId}: empty reason`);
      }
    }
    assert(refusals > 12, `only ${refusals} refusals — compatibility is not being tested`);
    return `${refusals} refusals, all explained`;
  });

  check('the factory build of every weapon is mountable', () => {
    for (const id of ARSENAL_ORDER) {
      const def = ARSENAL_DEFS[id];
      const l = defaultLoadout(def);
      for (const [slot, attId] of Object.entries(l)) {
        if (!attId) continue;
        const r = canMount(def, attId);
        assert(r.ok, `${id}: factory ${slot} ${attId} rejected — ${r.reason}`);
      }
    }
    return `${ARSENAL_ORDER.length} weapons`;
  });

  check('the rack shows every weapon exactly once', () => {
    const seen = new Set();
    let total = 0;
    for (const slot of SLOTS) {
      for (const id of weaponsInSlot(slot)) {
        assert(!seen.has(id), `${id} appears in two rack sections`);
        assert(ARSENAL_DEFS[id], `rack lists unknown weapon ${id}`);
        seen.add(id);
        total += 1;
      }
    }
    assert(total === ARSENAL_ORDER.length, `rack shows ${total} of ${ARSENAL_ORDER.length}`);
    return `${total} weapons in ${SLOTS.length} sections`;
  });

  check('every mountable part actually changes a number the board prints', () => {
    let silent = [];
    for (const id of ARSENAL_ORDER) {
      const def = ARSENAL_DEFS[id];
      for (const attId of Object.keys(ATTACHMENTS)) {
        if (!canMount(def, attId).ok) continue;
        const att = ATTACHMENTS[attId];
        const base = defaultLoadout(def);
        if (base[att.slot] === attId) continue;
        const now = { ...base, [att.slot]: attId };
        const rows = statDelta(def, now);
        const stats = resolveStats(def, now);
        const visible =
          rows.length > 0 || stats.silent || stats.hasLight || stats.hasLaser || att.kind;
        if (!visible) silent.push(`${id}/${attId}`);
      }
    }
    assert(!silent.length, `parts with no visible effect: ${silent.join(', ')}`);
    return 'no placebo attachments';
  });

  check('the board can format every stat statDelta can return', () => {
    // The formatter is a switch in screen.js; a stat with no case falls through
    // to 3 decimal places, which prints "30.000" for a magazine size.
    const stats = new Set();
    for (const id of ARSENAL_ORDER) {
      const def = ARSENAL_DEFS[id];
      for (const attId of Object.keys(ATTACHMENTS)) {
        if (!canMount(def, attId).ok) continue;
        const att = ATTACHMENTS[attId];
        const l = { ...defaultLoadout(def), [att.slot]: attId };
        for (const row of statDelta(def, l)) stats.add(row.stat);
      }
    }
    const countable = ['magSize', 'damage'];
    for (const stat of stats) {
      if (!countable.includes(stat)) continue;
      assert(screen.includes(`case '${stat}'`), `${stat} has no formatter case in screen.js`);
    }
    return `${stats.size} stats reachable`;
  });

  check('the board reads stats from the arsenal, not from its own table', () => {
    assert(screen.includes('resolveStats'), 'screen.js does not call resolveStats');
    assert(screen.includes('statDelta'), 'screen.js does not call statDelta');
    // A hand-written stat table is how a gunsmith screen starts lying.
    assert(
      !/const\s+(STATS|WEAPON_STATS|DISPLAY_STATS)\s*=\s*\{/.test(screen),
      'screen.js declares its own stat table'
    );
    return 'single source of truth';
  });

  /* -------------------------------------------------------- preview budget --- */
  group('gunsmith: preview budget');

  check('the preview scene has a fixed light count', () => {
    const dir = (preview.match(/new THREE\.DirectionalLight/g) ?? []).length;
    assert(dir === 3, `expected 3 directional lights, found ${dir}`);
    assert(!/new THREE\.PointLight/.test(preview), 'preview adds a point light');
    assert(!/new THREE\.SpotLight/.test(preview), 'preview adds a spot light');
    const ctorEnd = preview.indexOf('setWeapon(def)');
    assert(
      preview.indexOf('new THREE.DirectionalLight') < ctorEnd,
      'lights are created after the constructor'
    );
    return '3 directional, 0 punctual';
  });

  check('the preview restores renderer state it changed', () => {
    for (const call of [
      'getViewport',
      'getScissor',
      'getScissorTest',
      'getRenderTarget',
      'setViewport',
      'setScissor',
      'setScissorTest',
      'setRenderTarget',
    ]) {
      assert(preview.includes(`${call}(`), `preview never calls ${call}()`);
    }
    const body = preview.slice(preview.indexOf('render(rect)'));
    assert(body.indexOf('r.render(this.scene') < body.indexOf('r.setViewport(this._vp'),
      'viewport is restored before the draw, not after');
    assert(!/\br\.clear\(/.test(body), 'preview clears colour — it would wipe the frame');
    assert(body.includes('clearDepth'), 'preview does not clear depth');
    return 'viewport, scissor and target all restored';
  });

  check('the preview allocates nothing per frame', () => {
    const update = preview.slice(preview.indexOf('update(rawDt)'), preview.indexOf('render(rect)'));
    assert(!/new [A-Z]/.test(update), 'update() allocates');
    const render = preview.slice(preview.indexOf('render(rect)'), preview.indexOf('dispose()'));
    assert(!/new [A-Z]/.test(render), 'render() allocates');
    assert(preview.includes('this._vp = new THREE.Vector4'), 'no preallocated viewport scratch');
    return 'scratch preallocated in the constructor';
  });

  check('the board measures layout at most a few times a second', () => {
    const calls = (screen.match(/\.getBoundingClientRect\(/g) ?? []).length;
    assert(calls === 1, `getBoundingClientRect called from ${calls} places`);
    assert(/_rectAge\s*>\s*0?\.\d+/.test(screen), 'rect measurement is not throttled');
    return 'throttled and cached';
  });

  check('the gun on the board is the real weapon, not a stand-in', () => {
    assert(preview.includes('buildArsenalModel'), 'preview does not build the arsenal model');
    assert(preview.includes('HardwareRig'), 'preview does not use the hardware rig');
    assert(/#frame\(/.test(preview), 'preview never reframes after a mount');
    return 'same model and rig as the match';
  });

  /* ------------------------------------------------------- assembly bridge --- */
  group('gunsmith: assembly bridge');

  check('Assembly.build() is never treated as a scene node', () => {
    // build() returns Map<materialKey, geometry>. Handing that to .add() or
    // setting .visible on it fails only at runtime, on the first mount.
    const geometry = readFileSync(join(SRC, 'weapons', 'geometry.js'), 'utf8');
    assert(/build\(\)\s*\{/.test(geometry), 'Assembly.build() no longer takes zero arguments');
    for (const [name, src] of [
      ['rig.js', rig],
      ['preview.js', preview],
    ]) {
      assert(!/\.build\(this\.materialFor\)/.test(src), `${name} passes a material bank to build()`);
      assert(!/assembly\.build\(\w/.test(src), `${name} passes arguments to Assembly.build()`);
    }
    return 'both consumers go through meshifyAssembly';
  });

  check('the mesh bridge keeps one mesh per material', () => {
    assert(mesh.includes('for (const [matKey, geo] of asm.build())'), 'mesh.js does not iterate the build map');
    assert((mesh.match(/new THREE\.Mesh/g) ?? []).length === 1, 'more than one mesh construction site');
    return 'one draw call per material';
  });

  check('the mesh bridge does not dispose shared materials', () => {
    assert(!/material\.dispose\(\)/.test(mesh), 'disposeNode disposes materials from the shared bank');
    assert(mesh.includes('geometry.dispose()'), 'disposeNode does not release geometry');
    return 'geometry released, bank left alone';
  });

  /* ------------------------------------------------------------- teardown --- */
  group('gunsmith: teardown and pause');

  check('the preview releases every gun it built', () => {
    const d = preview.slice(preview.indexOf('dispose() {'));
    assert(d.includes('rig.dispose()'), 'rigs are not disposed');
    assert(d.includes('disposeNode'), 'preview nodes are not disposed');
    assert(d.includes('this.built.clear()'), 'the model cache is not cleared');
    return 'rigs, nodes and cache';
  });

  check('the bench owns and releases its own geometry and materials', () => {
    const d = bench.slice(bench.indexOf('dispose() {'));
    assert(d.includes('g.dispose()'), 'bench geometry is not released');
    assert(d.includes('m.dispose()'), 'bench materials are not released');
    assert(!/new THREE\.(Point|Spot|Directional)Light/.test(bench), 'the bench adds its own light');
    return 'no leak, no extra light';
  });

  check('the shell puts the render call back', () => {
    assert(shell.includes('this._originalRender = render.render.bind(render)'), 'render is not saved');
    const d = shell.slice(shell.indexOf('dispose() {'));
    assert(d.includes('this.render.render = this._originalRender'), 'render hook is never restored');
    assert(
      d.indexOf('this.render.render = this._originalRender') < d.indexOf('this.screen?.dispose()'),
      'the screen is disposed while still reachable from the render phase'
    );
    return 'hook restored before teardown';
  });

  check('opening the board stops the match and frees the mouse', () => {
    const open = shell.slice(
      shell.indexOf('openGunsmith(weaponId = null) {'),
      shell.indexOf('closeGunsmith() {')
    );
    assert(open.includes('ctx.time.scale = 0'), 'the match keeps running behind the board');
    assert(open.includes('exitPointerLock'), 'the mouse stays captured');
    assert(open.includes('setControlEnabled?.(false)'), 'the player can still move');
    const resume = shell.slice(shell.indexOf('#resumeMatch()'));
    assert(resume.includes('this._prevTimeScale'), 'time scale is not restored');
    assert(resume.includes('requestPointerLock'), 'the mouse is not recaptured');
    return 'pause and resume are symmetric';
  });

  check('the board animates on unscaled time', () => {
    assert(shell.includes('performance.now()'), 'shell uses the scaled frame dt');
    assert(/rawDt/.test(shell) && /screen\.update\(rawDt\)/.test(shell), 'screen is not driven by raw dt');
    return 'fades still run with the clock at zero';
  });

  /* --------------------------------------------------------------- design --- */
  group('gunsmith: design layer');

  check('the board is not a frosted-glass web dialog', () => {
    assert(!/backdrop-filter/.test(style), 'style.js uses a backdrop blur');
    assert(!/border-radius:\s*(1[2-9]|[2-9]\d)px/.test(style), 'oversized pill radii');
    assert(style.includes('prefers-reduced-motion'), 'no reduced-motion path');
    return 'opaque panels, hairlines, grain';
  });

  check('the board scales with the viewport like the HUD', () => {
    assert(style.includes('--k'), 'style.js has no scale token');
    assert((style.match(/calc\(/g) ?? []).length > 40, 'dimensions are hard-coded pixels');
    assert(screen.includes("setStyle(this.root, '--k'"), 'screen.js never writes the scale token');
    return 'one --k drives every dimension';
  });

  check('slot keys line up with the slots they select', () => {
    const keys = screen.match(/const SLOT_KEYS = \[(.*?)\]/s);
    assert(keys, 'SLOT_KEYS not found');
    const n = (keys[1].match(/'/g) ?? []).length / 2;
    assert(n === SLOT_ORDER.length, `${n} keys for ${SLOT_ORDER.length} slots`);
    return `${n} slots, ${n} keys`;
  });
}

await gunsmith();

console.log('\n' + '='.repeat(WIDTH));
if (failed) {
  console.log(`FAILED — ${failed} of ${passed + failed} gunsmith checks`);
  process.exit(1);
}
console.log(`all green — ${passed} gunsmith checks passed`);
