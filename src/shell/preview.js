import * as THREE from 'three';
import { buildArsenalModel } from '../arsenal/models/build.js';
import { meshifyAssembly, disposeNode } from '../arsenal/mesh.js';
import { HardwareRig } from '../arsenal/hardware/rig.js';
import { defaultLoadout } from '../arsenal/attachments.js';
import { clamp, damp } from '../ui/util.js';

/**
 * SHELL / gunsmith preview.
 *
 * The gun on the board is the REAL weapon: the same `buildArsenalModel` output
 * and the same `HardwareRig` the player carries into the match. Nothing here is
 * a render of a render — mount a suppressor on the board and you are looking at
 * the geometry that will be on the muzzle in game, which is the whole point of
 * a gunsmith screen and the reason a pre-baked sprite sheet was not an option.
 *
 * It draws into a scissored rectangle of the main canvas rather than a second
 * WebGLRenderer, because a second context means a second copy of every material,
 * every shader program and every texture — tens of megabytes and a fresh round
 * of compile stalls, for the same pixels.
 *
 * Light budget: exactly three directional lights, created in the constructor and
 * never added or removed. Directional, not point — so this scene contributes
 * nothing to the point-light count the world materials are compiled against.
 */

const IDLE_SPIN = 0.17;
const DRAG_YAW = 0.0085;
const DRAG_PITCH = 0.006;
const PITCH_LIMIT = 0.6;

/** Tolerant node seating: `nodesOf` yields {pos,rot}, older specs yield [x,y,z]. */
function applyNode(obj, n) {
  if (!n) return;
  const pos = Array.isArray(n) ? n : n.pos;
  const rot = Array.isArray(n) ? null : n.rot;
  if (pos) obj.position.set(pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0);
  if (rot) obj.rotation.set(rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0);
}

export class BenchPreview {
  /**
   * @param {object} o
   * @param {THREE.WebGLRenderer} o.renderer
   * @param {(key: string) => THREE.Material} o.material weapon material bank
   */
  constructor(o) {
    this.renderer = o.renderer;
    this.materialFor = o.material;

    this.scene = new THREE.Scene();
    this.scene.name = 'gunsmith-preview';

    this.camera = new THREE.PerspectiveCamera(26, 1, 0.02, 12);
    this.camera.position.set(0, 0.03, 0.92);
    this.camera.lookAt(0, 0, 0);

    /** Turntable: yaw/pitch live here, the gun itself is never re-parented. */
    this.spin = new THREE.Group();
    this.spin.name = 'preview-turntable';
    this.scene.add(this.spin);

    /** Recentring node — each weapon is a different length, see #frame(). */
    this.mount = new THREE.Group();
    this.mount.name = 'preview-mount';
    this.spin.add(this.mount);

    // Three-quarter key, cool fill from the opposite side, warm rim from behind.
    // A single overhead light is the default "3D viewer" look and it flattens
    // every chamfer on the receiver, which is exactly what the player is here to
    // look at.
    this.key = new THREE.DirectionalLight(0xfff2e0, 2.7);
    this.key.position.set(0.62, 0.78, 0.72);
    this.fill = new THREE.DirectionalLight(0x9dbfe8, 0.8);
    this.fill.position.set(-0.85, 0.12, 0.46);
    this.rim = new THREE.DirectionalLight(0xffd7a8, 1.5);
    this.rim.position.set(-0.34, 0.42, -0.95);
    for (const l of [this.key, this.fill, this.rim]) {
      l.castShadow = false;
      this.scene.add(l);
    }

    /** weaponId -> { model, node, rig } */
    this.built = new Map();
    this.current = null;

    this.yaw = -0.72;
    this.pitch = 0.1;
    this.targetYaw = -0.72;
    this.targetPitch = 0.1;
    this.dragging = false;

    // Preallocated scratch for render(): no per-frame allocation.
    this._vp = new THREE.Vector4();
    this._sc = new THREE.Vector4();
    this._box = new THREE.Box3();
    this._size = new THREE.Vector3();
    this._centre = new THREE.Vector3();
    this._aim = { hitDistance: 3.4, hitPoint: null };
    this.disposed = false;
  }

  /* ---------------------------------------------------------------- weapon */

  /**
   * Show `def`'s weapon, building it on first request and caching afterwards.
   * Switching back to a weapon the player already looked at is instant.
   */
  setWeapon(def) {
    const id = def.id;
    if (this.current && this.current.id === id) return this.current;

    if (this.current) this.current.node.visible = false;

    let entry = this.built.get(id);
    if (!entry) {
      const model = buildArsenalModel(id);
      const node = new THREE.Group();
      node.name = `preview-${id}`;

      const body = meshifyAssembly(model.body, this.materialFor, { receiveShadow: false });
      node.add(body);

      const parts = {};
      for (const [name, asm] of Object.entries(model.moving)) {
        const sub = meshifyAssembly(asm, this.materialFor, { receiveShadow: false });
        sub.name = `preview-${id}-${name}`;
        node.add(sub);
        parts[name] = sub;
      }
      const n = model.nodes;
      applyNode(parts.magazine, n.magSeat);
      applyNode(parts.charging, n.chargeRest);
      applyNode(parts.bolt, n.boltRest);

      this.mount.add(node);
      const rig = new HardwareRig({ weaponId: id, root: node, material: this.materialFor });
      rig.bind(def);
      rig.setLoadout(defaultLoadout(def));

      entry = { id, def, model, node, parts, rig };
      this.built.set(id, entry);
    }

    entry.node.visible = true;
    this.current = entry;
    this.#frame(entry);
    return entry;
  }

  /** Apply a loadout to the shown weapon. @returns {string[]} rejected ids */
  setLoadout(loadout) {
    if (!this.current) return [];
    const rejected = this.current.rig.setLoadout(loadout);
    this.#frame(this.current);
    return rejected;
  }

  /** Mount one part, for a single click on the board. */
  swap(slot, attId) {
    if (!this.current) return { ok: false, reason: 'no weapon' };
    const r = this.current.rig.swap(slot, attId);
    this.#frame(this.current);
    return r;
  }

  loadout() {
    return this.current ? this.current.rig.loadout() : {};
  }

  stats() {
    return this.current ? this.current.rig.stats() : null;
  }

  issues() {
    return this.current ? this.current.rig.issues() : [];
  }

  /**
   * Fit the weapon in the frame.
   *
   * Recomputed after every mount, because a 168 mm suppressor genuinely changes
   * the silhouette: without this the can hangs out of the panel, which looks
   * like a bug even though the geometry is right.
   */
  #frame(entry) {
    entry.node.position.set(0, 0, 0);
    entry.node.scale.setScalar(1);
    entry.node.updateMatrixWorld(true);

    this._box.setFromObject(entry.node);
    if (this._box.isEmpty()) return;
    this._box.getSize(this._size);
    this._box.getCenter(this._centre);

    // Longest axis decides the fit; 0.62 leaves margin for the rotation sweep
    // so the muzzle never clips the panel edge mid-spin.
    const span = Math.max(this._size.x, this._size.y, this._size.z) || 1;
    const scale = 0.62 / span;
    entry.node.scale.setScalar(scale);
    entry.node.position.set(
      -this._centre.x * scale,
      -this._centre.y * scale,
      -this._centre.z * scale
    );
  }

  /* ------------------------------------------------------------------ input */

  beginDrag() {
    this.dragging = true;
  }

  drag(dx, dy) {
    if (!this.dragging) return;
    this.targetYaw -= dx * DRAG_YAW;
    this.targetPitch = clamp(this.targetPitch + dy * DRAG_PITCH, -PITCH_LIMIT, PITCH_LIMIT);
  }

  endDrag() {
    this.dragging = false;
  }

  /* ----------------------------------------------------------------- frame */

  /** Unscaled dt: the board freezes the game clock but the turntable still turns. */
  update(rawDt) {
    if (this.disposed) return;
    if (!this.dragging) this.targetYaw += IDLE_SPIN * rawDt;
    this.yaw = damp(this.yaw, this.targetYaw, 9, rawDt);
    this.pitch = damp(this.pitch, this.targetPitch, 9, rawDt);
    this.spin.rotation.set(this.pitch, this.yaw, 0);
    this.current?.rig.update(rawDt, this._aim);
  }

  /**
   * Draw into a CSS-pixel rectangle of the main canvas.
   *
   * Renderer state is saved and restored around the call: the render system
   * hands out its WebGLRenderer with autoClear disabled and warns against
   * changing state mid-frame, so this runs after the composite, clears only
   * depth, and puts the viewport and scissor back exactly as they were.
   */
  render(rect) {
    if (this.disposed || !this.current || !rect || rect.width < 4 || rect.height < 4) return;
    const r = this.renderer;
    const dpr = r.getPixelRatio();
    const h = r.domElement.height;

    const x = Math.round(rect.left * dpr);
    const w = Math.round(rect.width * dpr);
    const hh = Math.round(rect.height * dpr);
    // WebGL's origin is bottom-left, the DOM rect's is top-left.
    const y = Math.round(h - rect.top * dpr - hh);

    const aspect = w / hh;
    if (Math.abs(this.camera.aspect - aspect) > 1e-4) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }

    r.getViewport(this._vp);
    r.getScissor(this._sc);
    const hadScissor = r.getScissorTest();
    const prevTarget = r.getRenderTarget();

    r.setRenderTarget(null);
    r.setViewport(x, y, w, hh);
    r.setScissor(x, y, w, hh);
    r.setScissorTest(true);
    r.clearDepth();
    r.render(this.scene, this.camera);

    r.setScissorTest(hadScissor);
    r.setScissor(this._sc.x, this._sc.y, this._sc.z, this._sc.w);
    r.setViewport(this._vp.x, this._vp.y, this._vp.z, this._vp.w);
    r.setRenderTarget(prevTarget);
  }

  /* --------------------------------------------------------------- teardown */

  dispose() {
    if (this.disposed) return;
    for (const entry of this.built.values()) {
      entry.rig.dispose();
      disposeNode(entry.node);
    }
    this.built.clear();
    this.current = null;
    for (const l of [this.key, this.fill, this.rim]) l.parent?.remove(l);
    this.scene.remove(this.spin);
    this.disposed = true;
  }
}
