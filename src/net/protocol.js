// FPS Arena X — wire protocol.
//
// The relay in server/main.py is a dumb forwarder: for most messages it just
// rewrites `type` and passes the object straight through. That means the
// FIELD NAMES ARE PART OF THE CONTRACT even though the server never reads
// them. Everything here is transcribed from the original FPS Arena client so
// an old build and this one can share a room.
//
// No imports, no three.js, no DOM: the gate loads this file in plain node and
// replays a whole match through it.
//
// API: C2S, S2C, ALL_C2S, ALL_S2C, NICK_MAX, STATE_HZ, SEND_PERIOD, QUANT,
//      TEAM_A, TEAM_B, teamIndex, teamLetter, quant, stateFrame, shotFrame,
//      hitFrame, deathFrame, grenadeFrame, encode, decode, validateProtocol

// ---------------------------------------------------------------- vocabulary

// Client to server. Duel and squad have parallel but SEPARATE vocabularies;
// the server dispatches on the bare string, so `state` in a team room is
// silently dropped. Always pick the pair that matches the room kind.
export const C2S = Object.freeze({
  register: 'register',
  find: 'find',
  joinRoom: 'join_room',
  state: 'state',
  shot: 'shot',
  hit: 'hit',
  died: 'died',
  rematch: 'rematch',
  grenade: 'grenade_throw',
  teamJoin: 'team_join',
  teamStart: 'team_start',
  teamLeaveLobby: 'team_leave_lobby',
  teamJoinRoom: 'team_join_room',
  teamState: 'team_state',
  teamShot: 'team_shot',
  teamHit: 'team_hit',
  teamDied: 'team_died',
  teamGrenade: 'team_grenade',
});

// Server to client.
export const S2C = Object.freeze({
  error: 'error',
  registered: 'registered',
  notFound: 'not_found',
  matched: 'matched',
  waiting: 'waiting_opponent',
  gameStart: 'game_start',
  opponentState: 'opponent_state',
  opponentShot: 'opponent_shot',
  opponentGrenade: 'opponent_grenade',
  tookDamage: 'took_damage',
  roundOver: 'round_over',
  matchOver: 'pvp_match_over',
  respawn: 'respawn',
  rematchWanted: 'rematch_wanted',
  opponentLeft: 'opponent_left',
  teamLobbyState: 'team_lobby_state',
  teamJoined: 'team_joined',
  teamMatchStart: 'team_match_start',
  teamRoomState: 'team_room_state',
  teamGameStart: 'team_game_start',
  teamPlayerState: 'team_player_state',
  teamPlayerShot: 'team_player_shot',
  teamPlayerGrenade: 'team_player_grenade',
  teamTookDamage: 'team_took_damage',
  teamRoundOver: 'team_round_over',
  teamMatchEnd: 'team_match_end',
  teamRespawn: 'team_respawn',
  teamPlayerDisconnected: 'team_player_disconnected',
  teamPlayerLeft: 'team_player_left',
});

export const ALL_C2S = Object.freeze(Object.values(C2S));
export const ALL_S2C = Object.freeze(Object.values(S2C));

// The server does `data.get('nickname', '').strip()[:24]`. Truncating on our
// side too means the name we show locally is the name everyone else sees.
export const NICK_MAX = 24;

// ------------------------------------------------------------------ cadence

// 20 Hz. The original client sent one state frame per rendered frame, which
// on a 144 Hz monitor is 144 sends/sec of a ~150 byte JSON object per player;
// in a 20-player room that is 3 MB/s through a single-threaded relay. The
// interpolator on the receiving end makes anything above 20 Hz invisible.
export const STATE_HZ = 20;
export const SEND_PERIOD = 1 / STATE_HZ;

// Rounding before send. JSON prints float64 in full (`-13.116999626159668`),
// so trimming to millimetres and milliradians roughly halves every frame.
export const QUANT = Object.freeze({ pos: 1e-3, dir: 1e-4 });

export function quant(v, step) {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v / step) * step
}

// -------------------------------------------------------------------- teams

// The relay speaks 'A'/'B'; modes/rules.js speaks 0/1. One conversion point.
export const TEAM_A = 'A';
export const TEAM_B = 'B';

export function teamIndex(letter) {
  return letter === TEAM_B ? 1 : 0
}

export function teamLetter(index) {
  return index === 1 ? TEAM_B : TEAM_A
}

// ------------------------------------------------------------------- frames

// `team` picks the duel or squad spelling of the same frame.
function pick(team, solo, squad) {
  return team ? squad : solo
}

// position + view direction + weapon + aim + hp (+ ghillie in duels).
// rx/ry/rz is a DIRECTION VECTOR, not euler angles: the original client sent
// `camera.getWorldDirection()` straight out. ry is therefore vertical.
export function stateFrame(s, team = false) {
  const f = {
    type: pick(team, C2S.state, C2S.teamState),
    x: quant(s.x, QUANT.pos),
    y: quant(s.y, QUANT.pos),
    z: quant(s.z, QUANT.pos),
    rx: quant(s.rx, QUANT.dir),
    ry: quant(s.ry, QUANT.dir),
    rz: quant(s.rz, QUANT.dir),
    w: s.w || '',
    aim: s.aim ? 1 : 0,
    hp: Math.max(0, Math.round(Number.isFinite(s.hp) ? s.hp : 0)),
  }
  if (!team) f.gh = s.gh ? 1 : 0;
  return f
}

// Muzzle origin + direction, so the far side can draw the tracer and pan the
// gunshot. Never quantised as hard as state: a tracer that starts 1 cm off
// the barrel is visible, a body that does is not.
export function shotFrame(o, d, team = false) {
  return {
    type: pick(team, C2S.shot, C2S.teamShot),
    ox: quant(o.x, QUANT.pos), oy: quant(o.y, QUANT.pos), oz: quant(o.z, QUANT.pos),
    dx: quant(d.x, QUANT.dir), dy: quant(d.y, QUANT.dir), dz: quant(d.z, QUANT.dir),
  }
}

// Damage is CLIENT-AUTHORITATIVE in this protocol: the shooter tells the
// victim how hard it hurt. The relay only enforces that teammates cannot do
// it. Kept as-is for compatibility, flagged so nobody mistakes it for safe.
export function hitFrame(damage, target = null) {
  const dmg = Math.max(0, Math.round(damage));
  if (target === null) return { type: C2S.hit, damage: dmg };
  return { type: C2S.teamHit, target: String(target).slice(0, NICK_MAX), damage: dmg }
}

// A duel death carries nothing — the relay knows there are only two players.
// A squad death carries the killer and both positions, for the killcam.
export function deathFrame(o = {}) {
  if (!o.team) return { type: C2S.died };
  const k = o.killerPos || null;
  const v = o.victimPos || null;
  return {
    type: C2S.teamDied,
    killer: o.killer ? String(o.killer).slice(0, NICK_MAX) : '',
    killer_x: k ? quant(k.x, QUANT.pos) : null,
    killer_y: k ? quant(k.y, QUANT.pos) : null,
    killer_z: k ? quant(k.z, QUANT.pos) : null,
    x: v ? quant(v.x, QUANT.pos) : 0,
    y: v ? quant(v.y, QUANT.pos) : 0,
    z: v ? quant(v.z, QUANT.pos) : 0,
  }
}

export function grenadeFrame(o, d, team = false) {
  return {
    type: pick(team, C2S.grenade, C2S.teamGrenade),
    ox: quant(o.x, QUANT.pos), oy: quant(o.y, QUANT.pos), oz: quant(o.z, QUANT.pos),
    dx: quant(d.x, QUANT.dir), dy: quant(d.y, QUANT.dir), dz: quant(d.z, QUANT.dir),
  }
}

// ------------------------------------------------------------- (de)encoding

export function encode(frame) {
  return JSON.stringify(frame)
}

// Never throws. A malformed frame from the network must not be able to kill
// the render loop, so the caller gets null and logs one line.
export function decode(raw) {
  if (typeof raw !== 'string') return null;
  let msg = null;
  try {
    msg = JSON.parse(raw)
  } catch {
    return null
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  if (typeof msg.type !== 'string') return null;
  return msg
}

// ------------------------------------------------------------- self-checks

// Runs on subsystem init. A typo in a message name is otherwise invisible
// until two people are in a room and one of them will not die.
export function validateProtocol() {
  const seen = new Set();
  for (const name of [...ALL_C2S, ...ALL_S2C]) {
    if (typeof name !== 'string' || !name) throw new Error('empty message name');
    if (name !== name.toLowerCase()) throw new Error(`wire names are snake_case: ${name}`);
    if (seen.has(name)) throw new Error(`duplicate message name: ${name}`);
    seen.add(name)
  }
  if (teamIndex(teamLetter(0)) !== 0 || teamIndex(teamLetter(1)) !== 1) {
    throw new Error('team mapping is not a round trip')
  }
  return seen.size
}
