#!/usr/bin/env node
/* Gate for step 6 - src/net/ and server/main.py.
 *
 * The protocol module is pure, so it is imported and exercised for real.
 * The subsystem and the relay cannot run here (three.js / FastAPI are not
 * installed in this sandbox), so those are read as text and checked for the
 * specific mistakes that would silently break a live match. */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIDTH = 60;
let passed = 0;
const failures = [];

function group(name) {
  console.log(`\n  ${name}`);
}

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`    ${'ok'.padEnd(4)}${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`    ${'x'.padEnd(4)}${name}\n         ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const P = await load('src/net/protocol.js');
const NET = read('src/net/index.js');
const MODES = read('src/modes/index.js');
const SRV = read('server/main.py');

console.log('\n' + '-'.repeat(WIDTH) + '\n  verify-net\n' + '-'.repeat(WIDTH));

/* ------------------------------------------------------------------ */
group('protocol: the vocabulary matches the relay');

check('every message name is unique and snake_case', () => {
  assert(P.validateProtocol() === P.ALL_C2S.length + P.ALL_S2C.length, 'name count drifted');
});

check('the relay accepts every type we can send', () => {
  /* Each C2S name must appear as a dispatch literal in main.py, otherwise we
   * would be shouting a word the server does not know. */
  for (const name of P.ALL_C2S) {
    assert(SRV.includes(`"${name}"`), `server never handles ${name}`);
  }
});

check('we understand every type the relay can send', () => {
  const emitted = [...SRV.matchAll(/"type":\s*"([a-z_]+)"/g)].map((m) => m[1]);
  const known = new Set(P.ALL_S2C);
  for (const name of new Set(emitted)) {
    assert(known.has(name), `server emits ${name} and the client drops it`);
  }
});

check('duel and squad frames never share a name', () => {
  const solo = [P.C2S.state, P.C2S.shot, P.C2S.hit, P.C2S.died, P.C2S.grenade];
  const squad = [P.C2S.teamState, P.C2S.teamShot, P.C2S.teamHit, P.C2S.teamDied, P.C2S.teamGrenade];
  for (let i = 0; i < solo.length; i++) assert(solo[i] !== squad[i], `collision at ${i}`);
});

check('nicknames are truncated exactly like the server does', () => {
  assert(P.NICK_MAX === 24, 'server slices [:24]');
  const long = 'x'.repeat(50);
  assert(P.hitFrame(10, long).target.length === 24, 'team hit target not truncated');
});

/* ------------------------------------------------------------------ */
group('protocol: frames carry what the far side needs');

check('a state frame keeps the original field names', () => {
  const f = P.stateFrame({ x: 1, y: 2, z: 3, rx: 0, ry: 0, rz: 1, w: 'akm', aim: 1, hp: 80 });
  for (const k of ['type', 'x', 'y', 'z', 'rx', 'ry', 'rz', 'w', 'aim', 'hp', 'gh']) {
    assert(k in f, `state frame lost ${k}`);
  }
});

check('a squad state frame drops the ghillie flag', () => {
  /* gh only exists in duels - the original team handler never read it. */
  assert(!('gh' in P.stateFrame({ x: 0, y: 0, z: 0, gh: 1 }, true)), 'gh leaked into team_state');
});

check('positions are quantised to millimetres', () => {
  const f = P.stateFrame({ x: -13.116999626159668, y: 0, z: 0 });
  assert(String(f.x).length <= 8, `x still full float64: ${f.x}`);
  assert(Math.abs(f.x + 13.117) < 1e-9, `x moved too far: ${f.x}`);
});

check('quantising never emits NaN', () => {
  const f = P.stateFrame({ x: NaN, y: undefined, z: Infinity, hp: NaN });
  for (const k of ['x', 'y', 'z', 'hp']) assert(Number.isFinite(f[k]), `${k} is ${f[k]}`);
});

check('hp is an integer and never negative', () => {
  assert(P.stateFrame({ hp: -12.7 }).hp === 0, 'negative hp survived');
  assert(P.stateFrame({ hp: 87.6 }).hp === 88, 'hp not rounded');
});

check('a duel death frame carries no killer', () => {
  const f = P.deathFrame();
  assert(f.type === P.C2S.died, 'wrong type');
  assert(!('killer' in f), 'the relay infers the killer in a duel');
});

check('a squad death frame carries both positions for the killcam', () => {
  const f = P.deathFrame({ team: true, killer: 'foe', killerPos: { x: 1, y: 2, z: 3 }, victimPos: { x: 4, y: 5, z: 6 } });
  assert(f.killer_x === 1 && f.killer_z === 3, 'killer position missing');
  assert(f.x === 4 && f.z === 6, 'victim position missing');
});

check('an unknown killer sends nulls, not undefined', () => {
  const f = P.deathFrame({ team: true, killer: '' });
  assert(f.killer_x === null, 'undefined would vanish from JSON and read as 0');
  assert(JSON.parse(P.encode(f)).killer_x === null, 'null did not survive encoding');
});

check('a hit frame is duel-shaped without a target', () => {
  assert(P.hitFrame(15).type === P.C2S.hit, 'wrong duel type');
  assert(P.hitFrame(15, 'foe').type === P.C2S.teamHit, 'wrong squad type');
});

/* ------------------------------------------------------------------ */
group('protocol: decoding hostile input');

check('malformed JSON returns null instead of throwing', () => {
  for (const bad of ['', '{', 'null', '[]', '42', '"hi"', undefined, 7]) {
    assert(P.decode(bad) === null, `decode(${JSON.stringify(bad)}) did not return null`);
  }
});

check('a frame with no type is rejected', () => {
  assert(P.decode('{"x":1}') === null, 'typeless frame accepted');
  assert(P.decode('{"type":5}') === null, 'numeric type accepted');
});

check('a good frame round-trips', () => {
  const f = P.shotFrame({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 1 });
  assert(P.decode(P.encode(f)).type === P.C2S.shot, 'round trip lost the type');
});

check('team letters and team indices round-trip', () => {
  assert(P.teamIndex('A') === 0 && P.teamIndex('B') === 1, 'letter to index');
  assert(P.teamLetter(0) === 'A' && P.teamLetter(1) === 'B', 'index to letter');
  assert(P.teamIndex('nonsense') === 0, 'unknown letter must not produce NaN');
});

/* ------------------------------------------------------------------ */
group('protocol: send rate');

check('state is throttled to 20 Hz', () => {
  assert(P.STATE_HZ === 20, `expected 20 Hz, got ${P.STATE_HZ}`);
  assert(Math.abs(P.SEND_PERIOD - 0.05) < 1e-9, 'send period does not match the rate');
});

check('the subsystem actually uses that period', () => {
  assert(/_send \+= dt/.test(NET), 'no send accumulator');
  assert(/this\._send >= SEND_PERIOD/.test(NET), 'state is not throttled - one send per frame is 144 Hz');
});

/* ------------------------------------------------------------------ */
group('net subsystem: wiring');

check('it declares an id and its dependencies', () => {
  assert(/static id = 'net'/.test(NET), 'missing static id');
  const m = NET.match(/static deps = \[([^\]]*)\]/);
  assert(m, 'missing static deps');
  for (const dep of ['ui', 'player', 'ai', 'modes']) {
    assert(m[1].includes(`'${dep}'`), `undeclared dependency: ${dep}`);
  }
});

check('it imports no other subsystem', () => {
  const imports = [...NET.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  for (const spec of imports) {
    assert(spec === 'three' || spec.startsWith('./'), `cross-subsystem import: ${spec}`);
  }
});

check('optional systems are reached with peek, not get', () => {
  /* ctx.get() throws for an unregistered id; fx is not in deps, so a build
   * without it would take the whole frame loop down. */
  assert(/peek\('fx'\)/.test(NET), 'fx must be peeked');
  const gets = [...NET.matchAll(/_ctx\?\.get\('([a-z]+)'\)/g)].map((m) => m[1]);
  for (const id of gets) {
    assert(['ui', 'player', 'ai', 'modes'].includes(id), `get('${id}') is not a declared dep`);
  }
});

check('bots mode never opens a socket', () => {
  assert(/this\.offline = this\.mode !== 'duel' && this\.mode !== 'squad'/.test(NET), 'offline rule missing');
  assert(/if \(this\.offline\) return/.test(NET), 'send path is not short-circuited offline');
});

check('no Math.random anywhere in the subsystem', () => {
  assert(!/Math\.random/.test(NET), 'gameplay randomness must come from ctx.rng');
});

check('sends are guarded on socket readiness', () => {
  assert(/readyState !== 1/.test(NET), 'sending on a CONNECTING socket throws');
});

check('reconnect uses capped backoff, not a tight loop', () => {
  const m = NET.match(/const BACKOFF = \[([^\]]+)\]/);
  assert(m, 'no backoff table');
  const steps = m[1].split(',').map((s) => Number(s.trim()));
  assert(steps.length >= 3, 'backoff too short');
  for (let i = 1; i < steps.length; i++) assert(steps[i] > steps[i - 1], 'backoff must grow');
  assert(/Math\.min\(this\._attempt, BACKOFF\.length - 1\)/.test(NET), 'backoff index is unclamped');
});

check('a deliberate close does not trigger a reconnect', () => {
  assert(/if \(this\._closing\)/.test(NET), 'closing flag never checked in onclose');
});

/* ------------------------------------------------------------------ */
group('net subsystem: remote players');

check('remote pose is written after the AI has run', () => {
  assert(/lateUpdate\(\)/.test(NET), 'no lateUpdate');
  const late = NET.slice(NET.indexOf('lateUpdate()'));
  assert(/a\.yaw = r\.yaw/.test(late), 'yaw is not authoritative');
  assert(/#interpolate\(r, a\.position\)/.test(late), 'position is not written in lateUpdate');
});

check('remote puppets do not think or shoot locally', () => {
  const make = NET.slice(NET.indexOf('  #makeRemote('), NET.indexOf('  #dropRemote('));
  assert(/staged = \{/.test(make), 'staged flag not set - the puppet would run full AI');
  assert(/noDamage: true/.test(make), 'a puppet that damages us would double-count hits');
  assert(/fire: false/.test(make), 'a puppet that fires locally desyncs every shot');
});

check('interpolation runs behind the newest sample', () => {
  assert(/const BUFFER_DELAY = 0\.1/.test(NET), 'no interpolation delay');
  const interp = NET.slice(NET.indexOf('  #interpolate('), NET.indexOf('  #remoteShot('));
  assert(/this\._clock - BUFFER_DELAY/.test(interp), 'not running in the past - this extrapolates');
});

check('the state buffer is bounded', () => {
  assert(/while \(r\.buf\.length > BUFFER_MAX\) r\.buf\.shift\(\)/.test(NET), 'unbounded buffer leaks for a whole match');
});

check('yaw interpolation takes the short way round', () => {
  const interp = NET.slice(NET.indexOf('  #interpolate('), NET.indexOf('  #remoteShot('));
  assert(/while \(d > Math\.PI\)/.test(interp) && /while \(d < -Math\.PI\)/.test(interp),
    'without wrapping, a player crossing north spins 350 degrees');
});

check('per-frame work allocates nothing', () => {
  const hot = NET.slice(NET.indexOf('  #interpolate('));
  assert(!/new THREE\./.test(hot), 'allocation in the interpolation or frame path');
});

check('stale puppets are dropped', () => {
  assert(/STALE_AFTER/.test(NET), 'no staleness timeout');
  assert(/this\._clock - r\.last > STALE_AFTER/.test(NET), 'staleness never evaluated');
});

check('teardown closes the socket and clears the puppets', () => {
  const d = NET.slice(NET.indexOf('dispose()'));
  assert(/this\.disconnect\(\)/.test(d), 'socket left open');
  assert(/this\.remotes\.clear\(\)/.test(d), 'puppets leaked');
});

/* ------------------------------------------------------------------ */
group('the bridge into modes');

check('every method net calls actually exists on modes', () => {
  const called = [...NET.matchAll(/modes\(\)\?\.([a-zA-Z]+)\?\./g)].map((m) => m[1]);
  assert(called.length >= 4, 'the bridge looks unwired');
  for (const name of new Set(called)) {
    assert(new RegExp(`\\n  ${name}\\(`).test(MODES), `modes has no ${name}() - the call would silently no-op`);
  }
});

check('the relay can override the duel format', () => {
  assert(/adoptRemoteFormat/.test(MODES), 'no format override');
  assert(/match_target/.test(NET), 'match_target is never read off the wire');
});

check('remote round scores are assigned, not incremented', () => {
  const fn = MODES.slice(MODES.indexOf('remoteRoundOver('), MODES.indexOf('remoteMatchOver('));
  assert(/t\.rounds = wins/.test(fn), 'incrementing desyncs if one message is dropped');
  assert(!/rounds \+=/.test(fn), 'found an increment');
});

check('a remote kill is scored once', () => {
  const fn = MODES.slice(MODES.indexOf('remoteKill('), MODES.indexOf('remoteRoundOver('));
  assert((fn.match(/registerKill/g) || []).length === 1, 'more than one scoring path');
});

check('an unknown victim is ignored rather than throwing', () => {
  const fn = MODES.slice(MODES.indexOf('remoteKill('), MODES.indexOf('remoteRoundOver('));
  assert(/if \(!o\.victim \|\| !this\.match\.players\.has\(o\.victim\)\) return null/.test(fn),
    'match.registerKill throws on an unknown victim');
});

/* ------------------------------------------------------------------ */
group('relay: the rules that stop cheating and desync');

check('a death is counted once per round', () => {
  assert(/self\.dying/.test(SRV), 'no dying set');
  assert(/if nick in duel\.dying or not duel\.live or duel\.over/.test(SRV),
    'duel deaths are not de-duplicated - splash damage would score twice');
  assert(/if self\.ended or victim in self\.dying/.test(SRV), 'squad deaths are not de-duplicated');
});

check('friendly fire cannot score', () => {
  assert(/self\.team_of\[killer\] != self\.team_of\[victim\]/.test(SRV), 'team kills feed the score');
  assert(/squad\.team_of\.get\(target\) != squad\.team_of\.get\(nick\)/.test(SRV), 'teammates can be damaged');
});

check('a suicide never awards a point', () => {
  assert(/killer != victim/.test(SRV), 'killing yourself would score');
});

check('the match ends on the kill limit or the timer', () => {
  assert(/score >= MATCH_KILL_LIMIT/.test(SRV), 'no kill limit');
  assert(/>= MATCH_TIME_LIMIT/.test(SRV), 'no time limit');
});

check('a drawn timer produces no winner', () => {
  assert(/None if a == b/.test(SRV), 'a tie must not pick a side');
});

check('duel spawns swap between rounds', () => {
  assert(/duel\.spawn_a, duel\.spawn_b = duel\.spawn_b, duel\.spawn_a/.test(SRV),
    'the loser would respawn into the same opening every round');
});

check('a rematch needs both players', () => {
  assert(/duel\.a in duel\.rematch and duel\.b in duel\.rematch/.test(SRV), 'one player could force a reset');
});

check('a dropped squad player keeps their slot for a while', () => {
  assert(/RECONNECT_TTL/.test(SRV), 'no reconnect window');
  assert(/room\.members\.get\(who\) is not None/.test(SRV), 'a reconnected player would still be evicted');
});

check('a dead socket cannot break a broadcast', () => {
  const fn = SRV.slice(SRV.indexOf('async def send('), SRV.indexOf('async def broadcast('));
  assert(/except Exception/.test(fn), 'one closed socket would abort the loop');
});

check('bad JSON does not kill the connection', () => {
  assert(/except \(json\.JSONDecodeError, TypeError\)/.test(SRV), 'malformed input must be skipped');
});

check('the state map is swept so rooms cannot leak', () => {
  assert(/def sweep\(\)/.test(SRV) && /ROOM_TTL/.test(SRV), 'no room expiry');
});

check('the static mount cannot shadow the websocket route', () => {
  const mountAt = SRV.indexOf('app.mount("/"');
  const wsAt = SRV.indexOf('@app.websocket("/ws")');
  assert(mountAt > wsAt, 'mounting / before /ws would swallow the socket route');
});

check('the duel format is configurable and defaults to five', () => {
  assert(/PVP_MATCH_TARGET = int\(os\.environ\.get\("PVP_MATCH_TARGET", "5"\)\)/.test(SRV),
    'the shell advertises "up to five wins"');
});

check('the relay serves the built client', () => {
  assert(/DIST_DIR/.test(SRV) && /StaticFiles/.test(SRV), 'no static host');
  assert(/npm run build/.test(SRV), 'a missing build should say so, not 404');
});

/* ------------------------------------------------------------------ */
console.log('\n' + '-'.repeat(WIDTH));
if (failures.length) {
  console.log(`  FAILED - ${failures.length} of ${passed + failures.length} checks`);
  console.log('-'.repeat(WIDTH) + '\n');
  process.exit(1);
}
console.log(`  all green - ${passed} net checks passed`);
console.log('-'.repeat(WIDTH) + '\n');
