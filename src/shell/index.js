import * as THREE from 'three';
import { BenchPreview } from './preview.js';
import { GunsmithScreen } from './screen.js';
import { WeaponBench } from './bench.js';
import { ARSENAL_DEFS, ARSENAL_ORDER } from '../arsenal/defs.js';
import { defaultLoadout } from '../arsenal/attachments.js';

/**
 * ===========================================================================
 * SHELL subsystem — menus, the gunsmith board, match screens
 * ===========================================================================
 *
 * Step 4 scope: the armoury bench in the world plus the gunsmith board it
 * opens. Later steps hang the mode-select screen and the scoreboard off the
 * same subsystem.
 *
 * PUBLIC API — `const shell = ctx.get('shell')`
 *   shell.openGunsmith(weaponId?)   open the board (pauses the match)
 *   shell.closeGunsmith()
 *   shell.loadoutFor(weaponId)      the player's current build for one weapon
 *   shell.loadouts()                every build, for the net layer to send
 *
 * Events emitted: `shell:gunsmith` {open}, `shell:loadout` {weaponId, loadout}.
 */

/** Where the bench stands. Overridable from config once maps are data-driven. */
const BENCH_POSITION = [6.2, 0, -4.4];
const BENCH_ROTATION = -0.42;

/**
 * Fallback materials for the standalone harness.
 *
 * In game the preview borrows the weapon material bank, so the gun on the board
 * is shaded by exactly the same materials as the gun in the player's hands. With
 * no `weapons` subsystem present (unit harness, model preview tool) we still
 * need *something*, and a plain grey would hide every modelling error the board
 * exists to show.
 */
const FALLBACK = {
  alu: [0x8d949c, 0.42, 0.9],
  alu_fine: [0x9aa1a9, 0.34, 0.92],
  steel: [0x6e757d, 0.36, 0.95],
  steel_bright: [0xb9c0c8, 0.22, 0.98],
  steel_soot: [0x30343a, 0.62, 0.78],
  cavity: [0x0a0c0f, 0.95, 0.0],
  polymer: [0x2b2f33, 0.72, 0.06],
  polymer_tan: [0x8a7a5c, 0.74, 0.05],
  rubber: [0x1d1f22, 0.9, 0.02],
  brass: [0xb08d3f, 0.34, 0.95],
  glass: [0x223044, 0.08, 0.4],
  optic_tube: [0x3a3f45, 0.4, 0.88],
};

export class ShellSystem {
  static id = 'shell';
  static deps = ['render', 'ui'];

  async init(ctx) {
    this.ctx = ctx;
    this._fallbacks = new Map();
    this._ownedMaterials = [];

    const render = ctx.get('render');
    this.render = render;
    const weapons = ctx.peek('weapons');
    this.materialFor = (key) => weapons?.mats?.get(key) ?? this.#fallbackMaterial(key);

    this.preview = new BenchPreview({ renderer: render.renderer, material: this.materialFor });

    const host = document.getElementById('ui') ?? document.body;
    this.screen = new GunsmithScreen(host, {
      preview: this.preview,
      onApply: (weaponId, loadout) => this.#equip(weaponId, loadout),
      onClose: () => this.#resumeMatch(),
    });

    this.bench = new WeaponBench({
      scene: ctx.scene,
      position: BENCH_POSITION,
      rotationY: BENCH_ROTATION,
    });

    /** weaponId -> loadout the player has committed to. */
    this._loadouts = new Map();
    for (const id of ARSENAL_ORDER) this._loadouts.set(id, defaultLoadout(ARSENAL_DEFS[id]));

    /**
     * THE RENDER HOOK.
     *
     * The engine calls `render()` on the render system only — no other subsystem
     * gets a render phase — and the preview must land AFTER the world composite
     * or the tonemap pass overwrites it. A post pass is the wrong tool: those are
     * required to write a full-screen result into a target, and this draws a real
     * perspective camera into one scissored rectangle.
     *
     * So the call is chained explicitly, and put back in dispose(). Reversible
     * and visible beats a hidden global.
     */
    this._originalRender = render.render.bind(render);
    render.render = (c) => {
      this._originalRender(c);
      this.screen.render();
    };

    this.screen.resize(window.innerHeight || 1080);
    this._paused = false;
    this._prevTimeScale = 1;
    this._last = performance.now();
  }

  #fallbackMaterial(key) {
    let m = this._fallbacks.get(key);
    if (m) return m;
    const [color, roughness, metalness] = FALLBACK[key] ?? [0x808890, 0.5, 0.5];
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    if (key === 'glass') {
      m.transparent = true;
      m.opacity = 0.34;
    }
    this._fallbacks.set(key, m);
    this._ownedMaterials.push(m);
    return m;
  }

  /* ------------------------------------------------------------------ public */

  loadoutFor(weaponId) {
    return { ...(this._loadouts.get(weaponId) ?? {}) };
  }

  loadouts() {
    return Object.fromEntries([...this._loadouts].map(([k, v]) => [k, { ...v }]));
  }

  openGunsmith(weaponId = null) {
    if (this.screen.open) return;
    const ctx = this.ctx;
    const held = weaponId ?? this.#heldWeaponId();

    // Freeze the match, hand the mouse back, get the HUD out of the way.
    if (ctx.time) {
      this._prevTimeScale = ctx.time.scale ?? 1;
      ctx.time.scale = 0;
    }
    this._paused = true;
    document.exitPointerLock?.();
    ctx.peek('player')?.setControlEnabled?.(false);
    const ui = ctx.peek('ui');
    ui?.clearPrompt?.();
    ui?.setHudVisible?.(false);

    this.screen.show(held);
    ctx.events?.emit?.('shell:gunsmith', { open: true });
  }

  closeGunsmith() {
    this.screen.close();
  }

  #resumeMatch() {
    const ctx = this.ctx;
    if (!this._paused) return;
    this._paused = false;
    if (ctx.time) ctx.time.scale = this._prevTimeScale ?? 1;
    ctx.peek('player')?.setControlEnabled?.(true);
    ctx.peek('ui')?.setHudVisible?.(true);
    ctx.input?.requestPointerLock?.();
    ctx.events?.emit?.('shell:gunsmith', { open: false });
  }

  #heldWeaponId() {
    const held = this.ctx.peek('weapons')?.getHudState?.()?.id;
    return held && ARSENAL_DEFS[held] ? held : ARSENAL_ORDER[0];
  }

  /**
   * Commit a build. The weapon subsystem is told through the event bus rather
   * than reached into, so the shell keeps working when the arsenal is rebuilt.
   */
  #equip(weaponId, loadout) {
    this._loadouts.set(weaponId, { ...loadout });
    this.ctx.events?.emit?.('shell:loadout', { weaponId, loadout: { ...loadout } });
    const weapons = this.ctx.peek('weapons');
    weapons?.applyLoadout?.(weaponId, { ...loadout });
    weapons?.setWeapon?.(weaponId);
  }

  /* ------------------------------------------------------------------- frame */

  resize(w, h) {
    this.screen.resize(h || window.innerHeight || 1080);
  }

  update(dt, ctx) {
    // The board must keep animating with the game clock at zero, so its own
    // clock is unscaled wall time rather than the frame's dt.
    const now = performance.now();
    const rawDt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;

    if (!this.screen.open) {
      const player = ctx.peek('player');
      const pos = player?.getHudState?.()?.position ?? player?.position ?? null;
      const prox = this.bench.proximity(pos);
      const ui = ctx.peek('ui');
      if (prox.near) {
        ui?.setPrompt?.({
          key: 'F',
          text: 'ДОСКА ОРУЖИЯ',
          sub: 'Настроить обвес',
        });
        if (ctx.input?.pressed?.('KeyF')) this.openGunsmith();
      } else if (prox.left) {
        ui?.clearPrompt?.();
      }
    }

    this.screen.update(rawDt);
  }

  dispose() {
    // Put the render call back before anything else: a half-disposed screen must
    // never be reachable from the render phase.
    if (this._originalRender && this.render) {
      this.render.render = this._originalRender;
      this._originalRender = null;
    }
    this.screen?.dispose();
    this.preview?.dispose();
    this.bench?.dispose();
    for (const m of this._ownedMaterials) m.dispose();
    this._ownedMaterials.length = 0;
    this._fallbacks.clear();
    this._loadouts.clear();
  }
}
