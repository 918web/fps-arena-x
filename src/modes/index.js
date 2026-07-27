/**
 * MODES \u2014 the subsystem.
 *
 * Turns the rules tables and the match state machine into an actual match: it
 * garrisons the map, tunes every bot to the chosen difficulty, runs the flag,
 * respawns the player, feeds the HUD and calls the end.
 *
 * PUBLIC API \u2014 `const modes = ctx.get('modes')`
 *   modes.match              the live Match (scores, standings, mvp)
 *   modes.snapshot()         plain object for the HUD and the results screen
 *   modes.configure(o)       set mode/submode/difficulty BEFORE init
 *   modes.aliveBots()        how much of the garrison is left
 *
 * IT TALKS TO OTHER SUBSYSTEMS THROUGH ctx ONLY \u2014 `ctx.get('ai')`,
 * `ctx.peek('world')`, `ctx.peek('player')`, `ctx.peek('ui')`. No cross-imports:
 * that is what keeps this file testable and the engine contract intact.
 *
 * EVENTS consumed: actor:death
 * EVENTS emitted: modes:start, modes:capture, modes:over
 */

import * as THREE from 'three';
import {
  MODES, CTF, BOT_VARIANTS,
  modeFor, submodeFor, difficultyFor, botForce, roleFor, validateRules,
} from './rules.js';
import { Match } from './match.js';

/** Player id inside the match. The relay uses real ids; solo play needs one. */
const YOU = 'you';

const FLAG_HOME_TAG = 'gate';
const HUD_PERIOD = 0.2;

export class ModesSystem {
  static id = 'modes';
  static deps = ['ai', 'world', 'ui'];

  constructor() {
    this.match = null;
    this.bots = [];
    this.reserve = [];
    this._config = null;
  }

  /** Called by the menu before the engine starts the system. */
  configure(o = {}) {
    this._config = { ...(this._config ?? {}), ...o };
    return this;
  }

  async init(ctx) {
    this.ctx = ctx;
    validateRules();
    this.rng = ctx.rng.fork();

    const q = this.#params();
    const cfg = this._config ?? {};
    const wanted = cfg.mode ?? q.get('mode') ?? 'bots';
    this.modeId = MODES[wanted] ? wanted : 'bots';
    this.mode = modeFor(this.modeId);
    this.submode = submodeFor(this.modeId, cfg.submode ?? q.get('submode'));
    this.difficulty = difficultyFor(cfg.difficulty ?? q.get('diff')).key;

    this.match = new Match({
      mode: this.modeId,
      submode: this.submode,
      difficulty: this.difficulty,
      rng: () => this.rng.float(),
    });
    this.match.addPlayer({ id: YOU, name: '\u0412\u042b', team: 0 });

    this.root = new THREE.Group();
    this.root.name = 'modes';
    ctx.scene.add(this.root);

    this._owned = [];
    this._unsubs = [];
    this._byAgent = new Map();
    this._hudTimer = 0;
    this._wasDead = false;
    this._reserveReleased = false;
    this._ended = false;
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this.flag = null;

    const on = (type, fn) => this._unsubs.push(ctx.events.on(type, fn));
    on('actor:death', (e) => this.#onActorDeath(e));

    if (this.modeId === 'bots') {
      this.#garrison();
      if (this.submode === 'ctf') this.#buildFlag();
    }

    this.match.start();
    ctx.events.emit('modes:start', this.snapshot());
  }

  #params() {
    try {
      return new URLSearchParams(globalThis.location?.search ?? '');
    } catch {
      return new URLSearchParams('');
    }
  }

  /* =================================================================== */
  /* garrison                                                            */
  /* =================================================================== */

  /**
   * Spawn rings, derived from the world's own spawn points rather than
   * hard-coded coordinates: the map can move and this still works.
   *
   * The player holds the nearest point; the garrison gets the far half, ranked
   * by distance, so the front line starts away from the spawn pad.
   */
  #rings() {
    const world = this.ctx.peek('world');
    const pts = world?.spawnPoints ?? [];
    if (!pts.length) return null;
    const home = pts[0];
    const ranked = pts
      .map((p) => ({ p, d: p.position.distanceTo(home.position) }))
      .sort((a, b) => a.d - b.d)
      .map((e) => e.p);
    const far = ranked[ranked.length - 1];
    const gate = pts.find((p) => p.tag === FLAG_HOME_TAG) ?? far;
    return {
      home,
      field: ranked[Math.max(1, Math.floor(ranked.length / 2))] ?? far,
      gate,
      reserve: far,
      defend: ranked[Math.max(1, ranked.length - 2)] ?? far,
    };
  }

  #garrison() {
    const rings = this.#rings();
    const ai = this.ctx.get('ai');
    if (!rings || !ai) {
      console.warn('[modes] no spawn points or no ai system: the field stays empty');
      return;
    }
    const force = botForce(this.difficulty);
    this.releaseAt = force.releaseAt;
    let n = 0;
    for (const wave of force.waves) {
      const anchor = rings[wave.spawn] ?? rings.field;
      for (let i = 0; i < wave.count; i++) {
        const spot = this.#scatter(anchor, wave.spawn === 'field' ? 14 : 6);
        const role = wave.role === 'mixed' ? roleFor(n) : wave.role;
        const descriptor = {
          variant: BOT_VARIANTS[n % BOT_VARIANTS.length],
          position: spot,
          yaw: anchor.yaw + this.rng.signed() * 0.7,
          wave: wave.n,
          role,
          delay: wave.stagger[0] + this.rng.float() * (wave.stagger[1] - wave.stagger[0]),
          id: `bot${n}`,
        };
        // Wave 3 is held back rather than parked on the map: an idle body still
        // costs a skinned draw, a shadow and a nav query every frame.
        if (wave.role === 'reserve') this.reserve.push(descriptor);
        else this.#deploy(descriptor);
        n += 1;
      }
    }
    console.info(`[modes] garrison: ${this.bots.length} on the field, ${this.reserve.length} in reserve (${this.difficulty})`);
  }

  #scatter(anchor, radius) {
    const ai = this.ctx.get('ai');
    const a = this.rng.range(0, Math.PI * 2);
    const r = this.rng.range(1.2, radius);
    const x = anchor.position.x + Math.cos(a) * r;
    const z = anchor.position.z + Math.sin(a) * r;
    const y = ai?.groundAt ? ai.groundAt(x, z, anchor.position.y + 6) : anchor.position.y;
    return new THREE.Vector3(x, Number.isFinite(y) ? y : anchor.position.y, z);
  }

  #deploy(d) {
    const ai = this.ctx.get('ai');
    const agent = ai.spawn(d.variant, d.position, d.yaw, { team: 1, patrol: null });
    if (!agent) return null;
    this.#tune(agent);
    const rec = { id: d.id, agent, wave: d.wave, role: d.role };
    this.bots.push(rec);
    this._byAgent.set(agent, rec);
    this.match.addPlayer({ id: d.id, name: `\u0411\u041e\u0422 ${d.id.slice(3)}`, team: 1, bot: true });
    return rec;
  }

  /**
   * Apply the difficulty to one live agent.
   *
   * UNIT TRAP, and the reason this is not a one-liner: FPS Arena's `fireRate`
   * was a DELAY between shots, so easy multiplied it by 1.40 to make bots
   * slower. The base engine's `fireRate` is shots per SECOND. Multiplying here
   * would have made the easy bots fire 40% faster than normal, so fireMul
   * divides. `spread` is aim error, which is what accMul was always scaling.
   */
  #tune(agent) {
    const d = difficultyFor(this.difficulty);
    agent.spread *= d.accMul;
    agent.fireRate /= d.fireMul;
    agent.burstCooldown *= d.fireMul;
    agent.team = 1;
    const hp = Math.round(100 * d.hpMul);
    agent.health = hp;
    agent.maxHealth = hp;
  }

  aliveBots() {
    let n = 0;
    for (const b of this.bots) if (b.agent.alive) n += 1;
    return n + this.reserve.length;
  }

  #maybeReleaseReserve() {
    if (this._reserveReleased || !this.reserve.length) return;
    if (this.aliveBots() > (this.releaseAt ?? 22)) return;
    this._reserveReleased = true;
    const pending = this.reserve;
    this.reserve = [];
    for (const d of pending) this.#deploy({ ...d, role: roleFor(d.wave + this.bots.length) });
    this.ctx.peek('ui')?.banner?.show('\u041f\u041e\u0414\u041a\u0420\u0415\u041f\u041b\u0415\u041d\u0418\u0415', `+${pending.length} \u043f\u0440\u043e\u0442\u0438\u0432\u043d\u0438\u043a\u043e\u0432`, 2.6);
  }

  /* =================================================================== */
  /* flag                                                                */
  /* =================================================================== */

  #buildFlag() {
    const rings = this.#rings();
    if (!rings) return;
    const group = new THREE.Group();
    group.name = 'ctf-flag';

    const poleGeo = new THREE.CylinderGeometry(0.035, 0.045, 2.3, 8);
    const clothGeo = new THREE.PlaneGeometry(0.9, 0.55);
    const auraGeo = new THREE.SphereGeometry(0.75, 16, 10);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.42, metalness: 0.85 });
    const clothMat = new THREE.MeshStandardMaterial({
      color: 0xb01c18, roughness: 0.78, metalness: 0,
      emissive: 0x40060a, emissiveIntensity: 0.7, side: THREE.DoubleSide,
    });
    const auraMat = new THREE.MeshBasicMaterial({ color: 0xff6a4a, transparent: true, opacity: 0.16, depthWrite: false });
    this._owned.push(poleGeo, clothGeo, auraGeo, poleMat, clothMat, auraMat);

    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = 1.15;
    pole.castShadow = true;
    const cloth = new THREE.Mesh(clothGeo, clothMat);
    cloth.position.set(0.47, 1.92, 0);
    const aura = new THREE.Mesh(auraGeo, auraMat);
    aura.position.y = 1.6;
    group.add(pole, cloth, aura);

    const homeTo = rings.gate.position.clone();
    group.position.copy(homeTo);
    this.root.add(group);

    this.flag = {
      group, cloth, aura,
      enemyBase: homeTo,
      ourBase: rings.home.position.clone(),
      state: 'base',
      droppedFor: 0,
    };
  }

  #updateFlag(dt) {
    const f = this.flag;
    if (!f || this.match.state !== 'live') return;
    const player = this.ctx.peek('player');
    const pos = player?.position ?? null;

    f.cloth.rotation.y = Math.sin(this.match.clock * 2.0) * 0.16;
    f.aura.material.opacity = 0.12 + 0.08 * (0.5 + 0.5 * Math.sin(this.match.clock * 3.0));

    if (!pos) return;

    if (f.state === 'carried') {
      f.group.position.set(pos.x, pos.y + 1.05, pos.z);
      const d = this._v.set(pos.x, 0, pos.z).distanceTo(this._v2.copy(f.ourBase).setY(0));
      if (d < CTF.deliverRadius) {
        f.state = 'base';
        f.group.position.copy(f.enemyBase);
        this.match.capture(YOU);
        this.ctx.events.emit('modes:capture', { by: YOU });
        this.ctx.peek('ui')?.banner?.show('\u0424\u041b\u0410\u0413 \u0417\u0410\u0425\u0412\u0410\u0427\u0415\u041d', `+${500} \u043e\u0447\u043a\u043e\u0432`, 3.2);
      }
      return;
    }

    if (f.state === 'dropped') {
      f.droppedFor += dt;
      if (f.droppedFor >= CTF.dropResetTime) {
        f.state = 'base';
        f.droppedFor = 0;
        f.group.position.copy(f.enemyBase);
        this.ctx.peek('ui')?.banner?.show('\u0424\u041b\u0410\u0413 \u0412\u0415\u0420\u041d\u0423\u041b\u0421\u042f', '\u041d\u0430 \u0431\u0430\u0437\u0435 \u0432\u0440\u0430\u0433\u0430', 2.4);
      }
    }

    const dist = this._v.set(pos.x, 0, pos.z).distanceTo(this._v2.copy(f.group.position).setY(0));
    if (dist < CTF.pickupRadius) {
      f.state = 'carried';
      f.droppedFor = 0;
      this.match.award(YOU, 'flagPickup');
      this.ctx.peek('ui')?.banner?.show('\u0424\u041b\u0410\u0413 \u0412\u0417\u042f\u0422', '\u041d\u0435\u0441\u0438 \u043d\u0430 \u0441\u0432\u043e\u044e \u0431\u0430\u0437\u0443', 2.8);
    }
  }

  #dropFlag() {
    const f = this.flag;
    if (!f || f.state !== 'carried') return;
    f.state = 'dropped';
    f.droppedFor = 0;
    f.group.position.y = Math.max(0, f.group.position.y - 0.9);
  }

  /* =================================================================== */
  /* deaths                                                              */
  /* =================================================================== */

  #onActorDeath(e) {
    const rec = e?.actor ? this._byAgent.get(e.actor) : null;
    if (!rec) return;
    // The HUD already draws its own killfeed row off actor:death; scoring is
    // ours. Registering it twice is how you end up with double kill counts.
    this.match.registerKill({ killer: YOU, victim: rec.id, headshot: !!e.headshot, weapon: e.weapon ?? null });
    const me = this.match.players.get(YOU);
    if (me && me.streak > 0 && me.streak % 3 === 0) {
      this.ctx.peek('ui')?.banner?.show(`\u0421\u0415\u0420\u0418\u042f \u00d7${me.streak}`, '\u0411\u0435\u0437 \u0441\u043c\u0435\u0440\u0442\u0435\u0439', 2.2);
    }
    if (this.modeId === 'bots' && this.submode === 'dm' && this.aliveBots() === 0) {
      this.match.fieldCleared();
    }
  }

  #playerDied() {
    this.#dropFlag();
    this.match.registerKill({ killer: null, victim: YOU });
  }

  #respawnPlayer() {
    const player = this.ctx.peek('player');
    if (!player) return;
    player.health?.reset?.(true);
    player.respawn?.(0);
    this._wasDead = false;
  }

  /* =================================================================== */
  /* frame                                                               */
  /* =================================================================== */

  update(dt, ctx) {
    const m = this.match;
    if (!m) return;

    const player = ctx.peek('player');
    const dead = !!player?.health?.dead;
    if (dead && !this._wasDead) {
      this._wasDead = true;
      this.#playerDied();
    }

    const due = m.tick(dt);
    for (const id of due) if (id === YOU) this.#respawnPlayer();

    if (this.modeId === 'bots') this.#maybeReleaseReserve();
    if (this.mode.autobalance) m.applyBalance();
    this.#updateFlag(dt);

    this._hudTimer -= dt;
    if (this._hudTimer <= 0) {
      this._hudTimer = HUD_PERIOD;
      this.#hud();
    }

    if (m.state === 'over' && !this._ended) {
      this._ended = true;
      this.#announceEnd();
    }
  }

  #hud() {
    const ui = this.ctx.peek('ui');
    if (!ui?.setMatch) return;
    const m = this.match;
    if (this.modeId === 'bots') {
      ui.setMatch({
        scoreUs: m.teams.get(0).kills,
        scoreThem: this.aliveBots(),
        timeLeft: m.timeLeft(),
        mode: this.submode === 'ctf' ? '\u0417\u0410\u0425\u0412\u0410\u0422 \u0424\u041b\u0410\u0413\u0410' : 'DEATHMATCH',
      });
      return;
    }
    ui.setMatch({
      scoreUs: this.modeId === 'duel' ? m.teams.get(0).rounds : m.teams.get(0).kills,
      scoreThem: this.modeId === 'duel' ? m.teams.get(1).rounds : m.teams.get(1).kills,
      timeLeft: m.timeLeft(),
      mode: this.mode.label,
    });
  }

  #announceEnd() {
    const m = this.match;
    const snap = this.snapshot();
    const won = m.winner === 0;
    const title = m.winner === null ? '\u041d\u0418\u0427\u042c\u042f' : won ? '\u041f\u041e\u0411\u0415\u0414\u0410' : '\u041f\u041e\u0420\u0410\u0416\u0415\u041d\u0418\u0415';
    const mvp = snap.mvp;
    this.ctx.peek('ui')?.banner?.show(title, mvp ? `\u041b\u0423\u0427\u0428\u0418\u0419: ${mvp.name} \u00b7 ${mvp.score}` : '', 6);
    this.ctx.events.emit('modes:over', snap);
  }

  snapshot() {
    const snap = this.match ? this.match.snapshot() : null;
    if (snap) snap.botsAlive = this.aliveBots();
    return snap;
  }

  dispose() {
    for (const off of this._unsubs ?? []) off();
    this._unsubs = [];
    if (this.flag) {
      this.root.remove(this.flag.group);
      this.flag = null;
    }
    for (const res of this._owned ?? []) res.dispose?.();
    this._owned = [];
    if (this.root) {
      this.ctx.scene.remove(this.root);
      this.root = null;
    }
    this._byAgent?.clear();
    this.bots = [];
    this.reserve = [];
  }
}
