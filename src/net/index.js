import * as THREE from 'three';
import {
  C2S,
  S2C,
  NICK_MAX,
  SEND_PERIOD,
  teamIndex,
  teamLetter,
  stateFrame,
  shotFrame,
  hitFrame,
  deathFrame,
  grenadeFrame,
  encode,
  decode,
  validateProtocol,
} from './protocol.js';

// FPS Arena X — networking.
//
// Owns the socket, the remote-player puppets and the bridge into `modes`.
// Bots mode never opens a connection at all: it configures itself offline and
// every send becomes a no-op, so the single-player path costs nothing.
//
// Remote players are real AI soldiers with their brains switched off. The
// engine's `staged` flag already skips pathfinding and decision-making, but it
// also forces the agent to aim at the local player, so the authoritative pose
// is written back in lateUpdate() — after ai.update() has run for the frame.
//
// API: configure, connect, disconnect, send, sendShot, sendHit, sendDeath,
//      sendGrenade, requestRematch, remotes, status, snapshot

const BUFFER_DELAY = 0.1 // s of interpolation lag; one 20 Hz frame plus slack;
const BUFFER_MAX = 12;
const BACKOFF = [0.5, 1, 2, 4, 8];
const STALE_AFTER = 10 // s without a state frame before a puppet is dropped;
const CLOSE_GOING_AWAY = 1000;

export class NetSystem {
  static id = 'net';
  static deps = ['ui', 'player', 'ai', 'modes'];

  constructor() {
    this.mode = 'bots';
    this.nickname = '';
    this.url = '';
    this.room = '';
    this.offline = true;
    this.state = 'idle' // idle | connecting | lobby | playing | closed;
    this.team = 0;
    this.spawn = 0;
    this.opponent = '';
    this.remotes = new Map();
    this._ctx = null;
    this._ws = null;
    this._send = 0;
    this._attempt = 0;
    this._retryAt = 0;
    this._closing = false;
    this._handlers = null;
    this._unsubs = [];
    this._dir = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._clock = 0
  }

  // Called by the shell before the engine starts. `mode` is one of the
  // modes/rules.js ids; anything but duel/squad stays offline.
  configure(o = {}) {
    if (o.mode) this.mode = o.mode;
    if (o.nickname) this.nickname = String(o.nickname).trim().slice(0, NICK_MAX);
    if (o.url) this.url = o.url;
    if (o.room) this.room = o.room;
    return this
  }

  get team_() {
    return this.mode === 'squad'
  }

  init(ctx) {
    this._ctx = ctx;
    validateProtocol();
    this._handlers = this.#routes();

    const p = new URLSearchParams(globalThis.location?.search ?? '');
    if (p.get('mode')) this.mode = p.get('mode');
    if (p.get('nick')) this.nickname = p.get('nick').slice(0, NICK_MAX);
    if (p.get('room')) this.room = p.get('room');

    this.offline = this.mode !== 'duel' && this.mode !== 'squad';
    if (this.offline) {
      this.state = 'idle';
      return
    }

    if (!this.url) this.url = defaultSocketUrl();
    this.connect()
  }

  // ------------------------------------------------------------ transport

  connect() {
    if (this.offline || this._ws) return;
    const WS = globalThis.WebSocket;
    if (!WS) return;
    this.state = 'connecting';
    this._closing = false;
    let ws = null;
    try {
      ws = new WS(this.url)
    } catch {
      this.#scheduleRetry();
      return
    }
    this._ws = ws;
    ws.onopen = () => {
      this._attempt = 0;
      this.state = 'lobby';
      if (this.team_) this.send({ type: C2S.teamJoin, nickname: this.nickname });
      else this.send({ type: C2S.register, nickname: this.nickname })
    }
    ws.onmessage = (ev) => this.#onMessage(ev.data);
    ws.onerror = () => {};
    ws.onclose = () => {
      this._ws = null;
      if (this._closing) {
        this.state = 'closed';
        return
      }
      this.#banner('\u0421\u0412\u042f\u0417\u042c \u041f\u041e\u0422\u0415\u0420\u042f\u041d\u0410', '\u041f\u0435\u0440\u0435\u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435...');
      this.#scheduleRetry()
    }
  }

  disconnect() {
    this._closing = true;
    if (this._ws) {
      try {
        this._ws.close(CLOSE_GOING_AWAY)
      } catch {};
      this._ws = null
    }
    this.state = 'closed'
  }

  // The relay is stateless about reconnects for duels but restores squad
  // players in place for RECONNECT_TTL seconds, so retrying is worth it.
  #scheduleRetry() {
    const wait = BACKOFF[Math.min(this._attempt, BACKOFF.length - 1)];
    this._attempt++
    this._retryAt = this._clock + wait
  }

  send(frame) {
    if (this.offline) return false;
    const ws = this._ws;
    if (!ws || ws.readyState !== 1) return false;
    try {
      ws.send(encode(frame))
    } catch {
      return false
    }
    return true
  }

  // ------------------------------------------------------------- outbound

  sendShot(origin, dir) {
    return this.send(shotFrame(origin, dir, this.team_))
  }

  // Client-authoritative damage, as in the original protocol: we tell the
  // victim how hard we hit them. The relay only blocks friendly fire.
  sendHit(damage, targetNick = null) {
    if (this.team_ && !targetNick) return false;
    return this.send(hitFrame(damage, this.team_ ? targetNick : null))
  }

  sendDeath(killer = '') {
    if (!this.team_) return this.send(deathFrame());
    const k = this.remotes.get(killer);
    return this.send(
      deathFrame({
        team: true,
        killer,
        killerPos: k ? k.agent?.position ?? null : null,
        victimPos: this.#playerPos(),
      })
    )
  }

  sendGrenade(origin, dir) {
    return this.send(grenadeFrame(origin, dir, this.team_))
  }

  requestRematch() {
    return this.send({ type: C2S.rematch })
  }

  #playerPos() {
    const pl = this._ctx?.get('player');
    const p = pl?.position;
    return p ? this._pos.copy(p) : this._pos.set(0, 0, 0)
  }

  #pushState() {
    const pl = this._ctx?.get('player');
    if (!pl) return;
    const cam = pl.camera?.camera ?? pl.camera;
    if (cam?.getWorldDirection) cam.getWorldDirection(this._dir);
    const p = pl.position;
    const hud = pl.getHudState?.() ?? {};
    this.send(
      stateFrame(
        {
          x: p?.x ?? 0,
          y: p?.y ?? 0,
          z: p?.z ?? 0,
          rx: this._dir.x,
          ry: this._dir.y,
          rz: this._dir.z,
          w: hud.weapon ?? '',
          aim: hud.aiming ? 1 : 0,
          hp: hud.health ?? 100,
        },
        this.team_
      )
    )
  }

  // -------------------------------------------------------------- inbound

  #onMessage(raw) {
    const msg = decode(raw);
    if (!msg) return;
    const fn = this._handlers.get(msg.type);
    if (fn) fn(msg)
  }

  #routes() {
    const m = new Map();
    const modes = () => this._ctx?.get('modes');

    m.set(S2C.error, (d) => this.#banner('\u041e\u0428\u0418\u0411\u041a\u0410', d.msg || ''));
    m.set(S2C.registered, () => {
      if (this.room) this.send({ type: C2S.joinRoom, room: this.room, nickname: this.nickname })
    });
    m.set(S2C.notFound, (d) => this.#banner('\u041d\u0415 \u041d\u0410\u0419\u0414\u0415\u041d', d.target || ''));
    m.set(S2C.matched, (d) => {
      this.room = d.room;
      this.spawn = d.spawn ?? 0;
      this.opponent = d.opponent || '';
      this.send({ type: C2S.joinRoom, room: this.room, nickname: this.nickname })
    });
    m.set(S2C.waiting, () => this.#banner('\u041e\u0416\u0418\u0414\u0410\u041d\u0418\u0415', '\u0421\u043e\u043f\u0435\u0440\u043d\u0438\u043a \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0430\u0435\u0442\u0441\u044f'));

    // The relay is the authority on the duel format: PVP_MATCH_TARGET is an
    // env var on the server, so whatever rules.js defaults to loses here.
    m.set(S2C.gameStart, (d) => {
      this.state = 'playing';
      this.spawn = d.spawn ?? 0;
      this.opponent = d.opponent || this.opponent;
      modes()?.adoptRemoteFormat?.({ roundsToWin: d.match_target });
      modes()?.addRemotePlayer?.({ id: this.opponent, name: this.opponent, team: 1 });
      this.#spawnPlayer(d.spawn);
      if (d.rematch) this.#banner('\u0420\u0415\u0412\u0410\u041d\u0428', this.opponent)
    });
    m.set(S2C.opponentState, (d) => this.#feed(this.opponent || 'opponent', 1, d));
    m.set(S2C.opponentShot, (d) => this.#remoteShot(this.opponent, d));
    m.set(S2C.opponentGrenade, (d) => this.#remoteGrenade(this.opponent, d));
    m.set(S2C.tookDamage, (d) => this.#takeDamage(d.damage, this.opponent));
    m.set(S2C.roundOver, (d) => {
      modes()?.remoteRoundOver?.({
        killer: d.killer,
        victim: d.killed,
        scores: d.scores,
        roundsToWin: d.match_target,
      })
    });
    m.set(S2C.matchOver, (d) => modes()?.remoteMatchOver?.({ winner: d.winner, scores: d.scores }));
    m.set(S2C.respawn, (d) => {
      this.spawn = d.spawn ?? this.spawn;
      this.#spawnPlayer(this.spawn)
    });
    m.set(S2C.rematchWanted, (d) => this.#banner('\u0420\u0415\u0412\u0410\u041d\u0428?', d.who || ''));
    m.set(S2C.opponentLeft, () => {
      this.#dropRemote(this.opponent);
      this.#banner('\u0421\u041e\u041f\u0415\u0420\u041d\u0418\u041a \u0412\u042b\u0428\u0415\u041b', '')
    });

    // ----- squad
    m.set(S2C.teamMatchStart, (d) => {
      this.room = d.room;
      this.team = teamIndex(d.team);
      this.send({ type: C2S.teamJoinRoom, room: this.room, nickname: this.nickname })
    });
    m.set(S2C.teamGameStart, (d) => {
      this.state = 'playing';
      this.team = teamIndex(d.team);
      this.spawn = d.spawn ?? 0;
      modes()?.adoptRemoteFormat?.({ team: this.team });
      for (const r of d.roster || []) {
        if (r.nick === this.nickname) continue;
        modes()?.addRemotePlayer?.({ id: r.nick, name: r.nick, team: teamIndex(r.team) })
      }
      this.#spawnPlayer(this.spawn)
    });
    m.set(S2C.teamPlayerState, (d) => this.#feed(d.from, teamIndex(d.team), d));
    m.set(S2C.teamPlayerShot, (d) => this.#remoteShot(d.from, d));
    m.set(S2C.teamPlayerGrenade, (d) => this.#remoteGrenade(d.from, d));
    m.set(S2C.teamTookDamage, (d) => this.#takeDamage(d.damage, d.from));
    m.set(S2C.teamRoundOver, (d) => {
      if (d.killed && d.killed !== this.nickname) this.#dropRemote(d.killed, true);
      modes()?.remoteKill?.({ killer: d.killer, victim: d.killed, teamScores: d.team_scores })
    });
    m.set(S2C.teamMatchEnd, (d) =>
      modes()?.remoteMatchOver?.({ winner: d.winner, scores: d.scores, teamScores: d.team_scores })
    );
    m.set(S2C.teamRespawn, (d) => {
      this.spawn = d.spawn ?? this.spawn;
      this.#spawnPlayer(this.spawn)
    });
    m.set(S2C.teamPlayerDisconnected, (d) => this.#dropRemote(d.nick || d.from));
    m.set(S2C.teamPlayerLeft, (d) => this.#dropRemote(d.nick || d.from));
    return m
  }

  // -------------------------------------------------------------- puppets

  #feed(nick, team, d) {
    if (!nick || nick === this.nickname) return;
    let r = this.remotes.get(nick);
    if (!r) r = this.#makeRemote(nick, team);
    if (!r) return;
    r.team = team;
    r.hp = d.hp ?? r.hp;
    r.weapon = d.w || r.weapon;
    r.last = this._clock;
    // Yaw from the reported view vector. atan2(x, z) matches the engine's
    // yaw convention (agent forward is sin(yaw), cos(yaw)).
    const yaw = Math.atan2(d.rx ?? 0, d.rz ?? 0);
    r.buf.push({ t: this._clock, x: d.x ?? 0, y: d.y ?? 0, z: d.z ?? 0, yaw });
    while (r.buf.length > BUFFER_MAX) r.buf.shift()
  }

  #makeRemote(nick, team) {
    const ai = this._ctx?.get('ai');
    if (!ai?.spawn) return null;
    const agent = ai.spawn('vanguard', new THREE.Vector3(0, -50, 0), 0, { team, patrol: null });
    if (!agent) return null;
    agent.name = nick;
    agent.team = team;
    // Brain off: `staged` skips pathfinding and decisions in ai.update().
    // noDamage stops the engine from firing this puppet's rifle at us —
    // remote damage arrives over the wire, not from local simulation.
    agent.staged = { noDamage: true, fire: false, speed: 0, crouch: false, heading: new THREE.Vector3(0, 0, 1) };
    const r = { nick, team, agent, hp: 100, weapon: '', buf: [], last: this._clock };
    this.remotes.set(nick, r);
    return r
  }

  #dropRemote(nick, deathAnim = false) {
    const r = this.remotes.get(nick);
    if (!r) return;
    if (deathAnim && r.agent?.die) {
      r.agent.staged = null;
      r.agent.die(r.agent.position, this._dir.set(0, 1, 0), 30)
    } else if (r.agent) {
      r.agent.alive = false;
      if (r.agent.group) r.agent.group.visible = false
    }
    this.remotes.delete(nick)
  }

  // Two-sample interpolation BUFFER_DELAY behind the newest frame. Straight
  // snapping at 20 Hz reads as a slideshow; extrapolating past the newest
  // sample makes people rubber-band through walls, so we deliberately run
  // one frame in the past instead.
  #interpolate(r, target) {
    const buf = r.buf;
    if (!buf.length) return false;
    const at = this._clock - BUFFER_DELAY;
    if (buf.length === 1 || at <= buf[0].t) {
      target.copy(this._a.set(buf[0].x, buf[0].y, buf[0].z));
      r.yaw = buf[0].yaw;
      return true
    }
    for (let i = buf.length - 1; i > 0; i--) {
      const b = buf[i];
      const a = buf[i - 1];
      if (at >= a.t && at <= b.t) {
        const span = b.t - a.t;
        const k = span > 1e-6 ? (at - a.t) / span : 1;
        this._a.set(a.x, a.y, a.z);
        this._b.set(b.x, b.y, b.z);
        target.copy(this._a).lerp(this._b, k);
        let d = b.yaw - a.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        r.yaw = a.yaw + d * k;
        return true
      }
    }
    const last = buf[buf.length - 1];
    target.set(last.x, last.y, last.z);
    r.yaw = last.yaw;
    return true
  }

  #remoteShot(nick, d) {
    const fx = this._ctx?.peek('fx');
    if (!fx?.muzzleFlash) return;
    this._a.set(d.ox ?? 0, d.oy ?? 0, d.oz ?? 0);
    this._b.set(d.dx ?? 0, d.dy ?? 0, d.dz ?? 1);
    fx.muzzleFlash(this._a, this._b);
    fx.tracer?.(this._a, this._b)
  }

  #remoteGrenade(nick, d) {
    this._ctx?.events?.emit('net:grenade', {
      from: nick,
      origin: { x: d.ox ?? 0, y: d.oy ?? 0, z: d.oz ?? 0 },
      dir: { x: d.dx ?? 0, y: d.dy ?? 0, z: d.dz ?? 1 },
    })
  }

  #takeDamage(damage, from) {
    const pl = this._ctx?.get('player');
    pl?.applyDamage?.(Math.max(0, Math.round(damage ?? 0)), { source: from })
  }

  #spawnPlayer(index) {
    const pl = this._ctx?.get('player');
    pl?.health?.reset?.(true);
    pl?.respawn?.(index ?? 0)
  }

  #banner(title, sub) {
    this._ctx?.get('ui')?.banner?.show?.(title, sub, 2.2);
  }

  // ---------------------------------------------------------------- frame

  update(dt) {
    this._clock += dt;
    if (this.offline) return;
    if (!this._ws && !this._closing && this._clock >= this._retryAt) this.connect();
    if (this.state !== 'playing') return;
    this._send += dt;
    if (this._send >= SEND_PERIOD) {
      this._send = 0;
      this.#pushState()
    }
    for (const [nick, r] of this.remotes) {
      if (this._clock - r.last > STALE_AFTER) this.#dropRemote(nick)
    }
  }

  // Runs after ai.update(), so this pose wins over anything the staged
  // agent path wrote this frame.
  lateUpdate() {
    if (this.offline) return;
    for (const r of this.remotes.values()) {
      const a = r.agent;
      if (!a?.alive) continue;
      if (!this.#interpolate(r, a.position)) continue;
      a.yaw = r.yaw;
      a.targetYaw = r.yaw;
      if (a.group) {
        a.group.position.copy(a.position);
        a.group.rotation.y = r.yaw;
        a.group.visible = true
      }
    }
  }

  status() {
    return this.offline ? 'offline' : this.state
  }

  snapshot() {
    return {
      mode: this.mode,
      state: this.status(),
      nickname: this.nickname,
      room: this.room,
      team: teamLetter(this.team),
      remotes: this.remotes.size,
      attempt: this._attempt,
    }
  }

  dispose() {
    this.disconnect();
    for (const nick of [...this.remotes.keys()]) this.#dropRemote(nick);
    this.remotes.clear();
    for (const off of this._unsubs) off();
    this._unsubs.length = 0;
    this._handlers = null;
    this._ctx = null
  }
}

// Same origin as the page, ws:// or wss:// to match http/https. Hard-coding
// the Render hostname would break every local `vite dev` session.
export function defaultSocketUrl() {
  const loc = globalThis.location;
  if (!loc) return 'ws://localhost:8000/ws';
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/ws`
}
