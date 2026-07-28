/**
 * The whole-project gate.
 *
 * The other six gates each look at one slice of the game: the arsenal, the
 * hardware, the workbench, the modes, the relay, the shell. Every one of them
 * can pass while the project as a whole is broken, because the interesting
 * failures live between the slices — a subsystem that exists but is never
 * registered, a gate that exists but is never run, a plan that says "done"
 * about work that is not, a server that cannot find the files vite built.
 *
 * This gate only asks cross-cutting questions. It deliberately re-checks
 * nothing that a narrower gate already owns.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const has = (p) => existsSync(join(ROOT, p));

let passed = 0;
const failures = [];
let group = '';

function section(name) {
  group = name;
  console.log(`\n${name}`);
}

function check(name, fn) {
  let problem = null;
  try {
    problem = fn();
  } catch (err) {
    problem = `threw: ${err.message}`;
  }
  if (problem) {
    failures.push(`${group} / ${name}: ${problem}`);
    console.log(`  x  ${name}`);
    console.log(`     ${problem}`);
  } else {
    passed++;
    console.log(`  ok ${name}`);
  }
}

/** Every .js file under src/, as paths relative to the project root. */
function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (entry.endsWith('.js')) out.push(rel);
  }
  return out;
}

const SRC = walk('src');
const MAIN = read('src/main.js');
const PKG = JSON.parse(read('package.json'));
const TEST = PKG.scripts?.test ?? '';

/** id -> file, for everything that declares itself a subsystem. */
const SYSTEMS = new Map();
for (const file of SRC) {
  const m = read(file).match(/static id = '([a-z]+)'/);
  if (m) SYSTEMS.set(m[1], file);
}

/** Gates this project added. Base-engine tools are not our business. */
const OUR_GATES = [
  'verify-arena.mjs',
  'verify-hardware.mjs',
  'verify-gunsmith.mjs',
  'verify-modes.mjs',
  'verify-net.mjs',
  'verify-shell.mjs',
  'verify-all.mjs',
];

// ---------------------------------------------------------------------------
section('wiring: every part is plugged into something');

check('no two subsystems answer to the same id', () => {
  const seen = new Map();
  for (const file of SRC) {
    const m = read(file).match(/static id = '([a-z]+)'/);
    if (!m) continue;
    if (seen.has(m[1])) return `${m[1]} is claimed by both ${seen.get(m[1])} and ${file}`;
    seen.set(m[1], file);
  }
  return seen.size >= 14 ? null : `only ${seen.size} subsystems found, expected at least 14`;
});

check('every subsystem is imported by the entry point', () => {
  const missing = [];
  for (const [id, file] of SYSTEMS) {
    const spec = file.replace(/^src/, '.');
    if (!MAIN.includes(`from '${spec}'`)) missing.push(`${id} (${file})`);
  }
  return missing.length ? `not imported: ${missing.join(', ')}` : null;
});

check('every imported subsystem is actually added to the engine', () => {
  const imported = [...MAIN.matchAll(/import \{ ([A-Za-z, ]+) \} from '\.\/[a-z]+\/index\.js'/g)]
    .flatMap((m) => m[1].split(',').map((s) => s.trim()))
    .filter((n) => n.endsWith('System'));
  const missing = imported.filter((n) => !MAIN.includes(`.add(${n}`));
  return missing.length ? `imported but never added: ${missing.join(', ')}` : null;
});

check('every declared dependency names a subsystem that exists', () => {
  const bad = [];
  for (const [id, file] of SYSTEMS) {
    const m = read(file).match(/static deps = \[([^\]]*)\]/);
    if (!m) continue;
    for (const dep of [...m[1].matchAll(/'([a-z]+)'/g)].map((d) => d[1])) {
      if (!SYSTEMS.has(dep)) bad.push(`${id} depends on '${dep}', which nothing provides`);
    }
  }
  return bad.length ? bad.join('; ') : null;
});

check('the dependency graph can be ordered - no cycles', () => {
  const deps = new Map();
  for (const [id, file] of SYSTEMS) {
    const m = read(file).match(/static deps = \[([^\]]*)\]/);
    deps.set(id, m ? [...m[1].matchAll(/'([a-z]+)'/g)].map((d) => d[1]) : []);
  }
  const done = new Set();
  const stack = new Set();
  let cycle = null;
  const visit = (id, trail) => {
    if (done.has(id)) return;
    if (stack.has(id)) {
      cycle = [...trail, id].join(' -> ');
      return;
    }
    stack.add(id);
    for (const d of deps.get(id) ?? []) visit(d, [...trail, id]);
    stack.delete(id);
    done.add(id);
  };
  for (const id of deps.keys()) visit(id, []);
  return cycle ? `cycle: ${cycle}` : null;
});

check('the arsenal stays a kit, not a subsystem', () => {
  const claimed = [...SYSTEMS.values()].filter((f) => f.startsWith('src/arsenal/'));
  if (claimed.length) return `${claimed.join(', ')} declares a subsystem id; arsenal is imported directly`;
  return has('src/arsenal/defs.js') ? null : 'src/arsenal is missing entirely';
});

check('nothing under src reaches for a package other than three', () => {
  const bad = [];
  for (const file of SRC) {
    for (const m of read(file).matchAll(/from '([^']+)'/g)) {
      const spec = m[1];
      if (spec.startsWith('.') || spec.startsWith('/')) continue;
      if (spec === 'three' || spec.startsWith('three/')) continue;
      bad.push(`${file} imports ${spec}`);
    }
  }
  return bad.length ? bad.join('; ') : null;
});

check('no source file loads anything over the network', () => {
  const bad = [];
  for (const file of SRC) {
    const body = read(file);
    if (/from 'https?:\/\//.test(body)) bad.push(`${file} imports from a URL`);
    if (/cdn\.(jsdelivr|skypack)|unpkg\.com/.test(body)) bad.push(`${file} points at a CDN`);
  }
  return bad.length ? bad.join('; ') : null;
});

/**
 * Six files under src/ are deliberately unreachable from main.js: standalone
 * dev harnesses that node or a probe script opens directly (`node
 * src/physics/selftest.js`, `await import('/src/audio/selftest.js')` from
 * src/audio/probe.mjs). They are not dead code, but they must stay dead ends -
 * the moment shipped code imports one, a dev studio rig gets bundled into the
 * game. So the list is fixed here, and both directions are checked: nothing
 * new may become an orphan, and nothing on the list may become reachable.
 */
const DEV_ENTRIES = [
  'src/ai/preview.js',
  'src/audio/selftest.js',
  'src/fx/preview.js',
  'src/materials/preview.js',
  'src/physics/selftest.js',
  'src/weapons/preview.js',
];

function reachableFromMain() {
  const seen = new Set();
  const queue = ['src/main.js'];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const dir = dirname(file);
    for (const m of read(file).matchAll(/from '(\.[^']+)'/g)) {
      const target = relative(ROOT, resolve(ROOT, dir, m[1])).split('\\').join('/');
      if (has(target)) queue.push(target);
    }
  }
  return seen;
}

const REACHED = reachableFromMain();

check('every shipped file under src is reachable from the entry point', () => {
  const orphans = SRC.filter((f) => !REACHED.has(f) && !DEV_ENTRIES.includes(f));
  return orphans.length ? `never imported: ${orphans.join(', ')}` : null;
});

check('the dev-only harnesses stay out of the shipped bundle', () => {
  const leaked = DEV_ENTRIES.filter((f) => REACHED.has(f));
  if (leaked.length) return `game code now imports a dev harness: ${leaked.join(', ')}`;
  const gone = DEV_ENTRIES.filter((f) => !has(f));
  return gone.length ? `listed as a dev harness but missing: ${gone.join(', ')}` : null;
});

// ---------------------------------------------------------------------------
section('gates: the suite runs everything we wrote');

check('every gate this project added is part of npm test', () => {
  const missing = OUR_GATES.filter((g) => !TEST.includes(g));
  return missing.length ? `not in the test script: ${missing.join(', ')}` : null;
});

check('npm test stops at the first failing gate', () => {
  if (TEST.includes(';')) return 'gates are chained with ; so a failure would be swallowed';
  const links = TEST.split('&&').length;
  return links >= OUR_GATES.length ? null : `only ${links} commands chained, expected ${OUR_GATES.length}`;
});

check('every gate file we ship really exists', () => {
  const missing = OUR_GATES.filter((g) => !has(`tools/${g}`));
  return missing.length ? `referenced but absent: ${missing.join(', ')}` : null;
});

check('a failing gate fails the process', () => {
  const bad = OUR_GATES.filter((g) => !read(`tools/${g}`).includes('process.exit(1)'));
  return bad.length ? `these gates never exit non-zero: ${bad.join(', ')}` : null;
});

check('every gate says out loud when it is green', () => {
  const bad = OUR_GATES.filter((g) => !/all green/i.test(read(`tools/${g}`)));
  return bad.length ? `no green line: ${bad.join(', ')}` : null;
});

check('each new directory is covered by at least one gate', () => {
  const bodies = OUR_GATES.filter((g) => g !== 'verify-all.mjs').map((g) => read(`tools/${g}`));
  // A gate may name a directory either as a full path or joined onto its own
  // SRC constant (`join(SRC, 'arsenal/defs.js')`), so accept both spellings.
  const uncovered = ['arsenal', 'modes', 'net', 'shell'].filter(
    (dir) => !bodies.some((b) => b.includes(`src/${dir}/`) || b.includes(`'${dir}/`)),
  );
  return uncovered.length ? `no gate reads src/${uncovered.join(', src/')}` : null;
});

check('the server is covered too', () => {
  const bodies = OUR_GATES.map((g) => read(`tools/${g}`));
  return bodies.some((b) => b.includes('server/main.py')) ? null : 'no gate reads server/main.py';
});

// ---------------------------------------------------------------------------
section('the repo tells the truth about itself');

check('the plan marks every step it claims to have finished', () => {
  const plan = read('PLAN.md');
  const open = [...plan.matchAll(/^- \[ \] \*\*(\d)\./gm)].map((m) => m[1]);
  const done = [...plan.matchAll(/^- \[x\] \*\*(\d)\./gm)].map((m) => m[1]);
  if (done.length < 9) return `only ${done.length} steps marked done, expected 9 (0 through 8)`;
  return open.length ? `still open: step ${open.join(', ')}` : null;
});

check('the readme status table has a row per step', () => {
  const rows = [...read('README.md').matchAll(/^\| (\d) \|/gm)].map((m) => m[1]);
  return rows.length >= 8 ? null : `only ${rows.length} status rows, expected 8`;
});

check('the readme does not still promise finished work', () => {
  const stale = [...read('README.md').matchAll(/^\| \d \|.*\|\s*(в плане|в работе)\s*\|/gm)];
  return stale.length ? `${stale.length} row(s) still unfinished while the plan says done` : null;
});

check('the licence names the owner first', () => {
  const lic = read('LICENSE');
  const first = lic.match(/Copyright \(c\) \d{4} (.+)/)?.[1]?.trim();
  return first === '918web' ? null : `the first copyright line says "${first}"`;
});

check('the readme credits the owner', () => {
  const readme = read('README.md');
  if (!readme.includes('918web')) return 'the readme never names 918web';
  return /^# FPS ARENA/m.test(readme) ? null : 'the readme is not titled FPS ARENA';
});

check('no shipped surface presents the game under the base engine name', () => {
  const bad = [];
  for (const file of ['index.html', 'README.md', 'package.json']) {
    if (/claude.of.duty|OVERWATCH/i.test(read(file))) bad.push(file);
  }
  return bad.length ? `${bad.join(', ')} still shows the base engine name to the player` : null;
});

check('the package is named after the game', () => {
  if (PKG.name !== 'fps-arena') return `package name is "${PKG.name}"`;
  return PKG.author === '918web' ? null : `package author is "${PKG.author}"`;
});

// ---------------------------------------------------------------------------
section('a stranger can build it and serve it');

check('the four scripts a newcomer needs are all there', () => {
  const missing = ['dev', 'build', 'preview', 'test'].filter((s) => !PKG.scripts?.[s]);
  return missing.length ? `package.json has no ${missing.join(', ')} script` : null;
});

check('three is still the only runtime dependency', () => {
  const deps = Object.keys(PKG.dependencies ?? {});
  return deps.length === 1 && deps[0] === 'three' ? null : `dependencies: ${deps.join(', ') || 'none'}`;
});

check('the build output is what the server looks for', () => {
  const server = read('server/main.py');
  if (!server.includes('DIST_DIR')) return 'server/main.py does not resolve a dist directory';
  const vite = read('vite.config.js');
  const outDir = vite.match(/outDir: '([^']+)'/)?.[1];
  if (outDir && outDir !== 'dist') return `vite builds into ${outDir} but the server serves dist`;
  return server.includes('npm run build') ? null : 'the server does not tell you to build first when dist is missing';
});

check('the server answers a health probe and a socket', () => {
  const server = read('server/main.py');
  const missing = ['/healthz', '/ws'].filter((route) => !server.includes(`"${route}"`));
  return missing.length ? `no route for ${missing.join(', ')}` : null;
});

check('the python side declares what it needs', () => {
  if (!has('server/requirements.txt')) return 'server/requirements.txt is missing';
  const req = read('server/requirements.txt').toLowerCase();
  const missing = ['fastapi', 'uvicorn'].filter((p) => !req.includes(p));
  return missing.length ? `requirements.txt does not pin ${missing.join(', ')}` : null;
});

check('continuous integration installs, tests and builds', () => {
  const path = '.github/workflows/ci.yml';
  if (!has(path)) return 'there is no CI workflow';
  const ci = read(path);
  const missing = ['npm ci', 'npm test', 'npm run build'].filter((c) => !ci.includes(c));
  return missing.length ? `CI never runs: ${missing.join(', ')}` : null;
});

check('CI checks the server too', () => {
  const ci = read('.github/workflows/ci.yml');
  return /compileall|python/.test(ci) ? null : 'CI never touches the python relay';
});

check('build artefacts stay out of the repository', () => {
  const ignore = read('.gitignore');
  const missing = ['node_modules/', 'dist/', '__pycache__/'].filter((p) => !ignore.includes(p));
  return missing.length ? `.gitignore does not exclude ${missing.join(', ')}` : null;
});

// ---------------------------------------------------------------------------
console.log(`\n${'-'.repeat(60)}`);
if (failures.length) {
  console.log(`FAILED - ${failures.length} of ${passed + failures.length} whole-project checks\n`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`all green - ${passed} whole-project checks passed`);
