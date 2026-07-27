/**
 * ARSENAL / HARDWARE — the runtime rig.
 *
 * Owns the lifetime of every mounted part on one weapon:
 *   mount / unmount / swap  — geometry is built once and cached, then shown
 *   toggle                  — laser and torch flip an intensity, never a count
 *   update                  — zero allocations; only writes into existing objects
 *   dispose                 — every geometry and every material handed back
 *
 * The cache is per weapon, because an optic built for an AK sits on a side
 * dovetail and the same optic on an M416 sits on the top deck: the same id is
 * genuinely different geometry.
 */

import * as THREE from 'three';
import { specFor } from '../models/specs.js';
import { ATTACHMENTS, SLOT_ORDER, canMount, defaultLoadout, resolveStats } from '../attachments.js';
import { LIGHT_POOL, clearanceIssues, placementsFor } from './specs.js';
import { buildAttachmentUnit, addMountingRails } from './build.js';
import { meshifyAssembly } from '../mesh.js';

const _dir = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _target = new THREE.Vector3();
const _mat = new THREE.Matrix4();

/** Rated values, so a toggle is a lerp between two known numbers. */
const OFF = 0;

export class HardwareRig {
  /**
   * @param {object} o
   * @param {string} o.weaponId
   * @param {THREE.Object3D} o.root the viewmodel node the weapon hangs from
   * @param {(name:string)=>THREE.Material} o.material the weapons material bank
   */
  constructor(o) {
    this.weaponId = o.weaponId;
    this.spec = specFor(o.weaponId);
    this.root = o.root;
    this.materialFor = o.material;

    /** slot -> mounted unit (or null). */
    this.mounted = { optic: null, muzzle: null, tactical: null, underbarrel: null, magazine: null };
    /** `${slot}:${id}` -> built unit, kept for instant re-mount. */
    this.cache = new Map();

    this.group = new THREE.Group();
    this.group.name = `hardware_${o.weaponId}`;
    this.root.add(this.group);

    /**
     * THE LIGHT POOL.
     *
     * Created here, once, whether or not the player ever mounts a torch. A light
     * that appears later forces the renderer to recompile every material it
     * touches, which is a stall measured in tenths of a second — and it always
     * happens at the worst moment, because the player mounts a torch when it has
     * just got dark and something is shooting at them.
     */
    this.lights = [];
    for (let i = 0; i < LIGHT_POOL.spot; i += 1) {
      const spot = new THREE.SpotLight(0xffffff, OFF, 40, 0.34, 0.45, 1.4);
      spot.name = `hardware_spot_${i}`;
      spot.castShadow = false;
      spot.target.name = `hardware_spot_target_${i}`;
      this.group.add(spot);
      this.group.add(spot.target);
      this.lights.push(spot);
    }

    /** Laser beam + dot, also built up front and simply hidden. */
    this.beam = null;
    this.dot = null;

    this.state = { laserOn: false, lightOn: false, bipodDeployed: false, swapT: 1 };
    this.disposed = false;
  }

  /* ---------------------------------------------------------------- rails */

  /** Called once by the weapon builder so empty rails still read as mounts. */
  static rails(asm, spec) {
    addMountingRails(asm, spec);
  }

  /* --------------------------------------------------------------- mount */

  /** Build (or fetch) a unit and hang it on the weapon. */
  mount(attId) {
    const att = ATTACHMENTS[attId];
    if (!att) throw new Error(`unknown attachment ${attId}`);
    const check = canMount(this.defs ?? this.def(), attId);
    if (!check.ok) return { ok: false, reason: check.reason };

    const key = `${att.slot}:${attId}`;
    let unit = this.cache.get(key);
    if (!unit) {
      unit = buildAttachmentUnit(this.spec, attId);
      unit.object = meshifyAssembly(unit.assembly, this.materialFor);
      if (unit.legs) {
        for (const leg of unit.legs) {
          leg.object = meshifyAssembly(leg.assembly, this.materialFor);
          leg.object.position.set(leg.pivot[0], leg.pivot[1], leg.pivot[2]);
          leg.object.rotation.z = leg.stowedAngle;
          unit.object.add(leg.object);
        }
      }
      this.cache.set(key, unit);
      this.group.add(unit.object);
    }

    const previous = this.mounted[att.slot];
    if (previous && previous.id !== attId) previous.object.visible = false;
    unit.object.visible = true;
    this.mounted[att.slot] = unit;

    if (att.slot === 'tactical') this.#wireTactical(unit);
    // A fresh optic starts un-zeroed for the swap animation, then settles.
    if (att.slot === 'optic') this.state.swapT = 0;
    return { ok: true, unit };
  }

  /** Take a part off. Geometry stays cached; only visibility changes. */
  unmount(slot) {
    const unit = this.mounted[slot];
    if (!unit) return false;
    unit.object.visible = false;
    this.mounted[slot] = null;
    if (slot === 'tactical') {
      this.#lightsOff();
      if (this.beam) this.beam.visible = false;
      if (this.dot) this.dot.visible = false;
    }
    return true;
  }

  /** Quick-swap: unmount whatever is in the slot and mount `attId` instead. */
  swap(slot, attId) {
    if (attId === null) return this.unmount(slot);
    this.unmount(slot);
    return this.mount(attId);
  }

  /** Apply a whole loadout at once (used on spawn and by the gunsmith board). */
  setLoadout(loadout) {
    const rejected = [];
    for (const slot of SLOT_ORDER) {
      const id = loadout[slot] ?? null;
      if (!id) {
        this.unmount(slot);
        continue;
      }
      const r = this.swap(slot, id);
      if (r && r.ok === false) rejected.push({ id, reason: r.reason });
    }
    return rejected;
  }

  /* ------------------------------------------------------------- toggles */

  /** Laser: FPS Arena's L key. */
  toggleLaser() {
    const tac = this.mounted.tactical;
    if (!tac || !tac.hasLaser) return false;
    this.state.laserOn = !this.state.laserOn;
    if (this.beam) this.beam.visible = this.state.laserOn;
    if (this.dot) this.dot.visible = this.state.laserOn;
    return this.state.laserOn;
  }

  /** Torch: FPS Arena's F key. Intensity only — the light itself never moves. */
  toggleLight() {
    const tac = this.mounted.tactical;
    if (!tac || !tac.hasLight) return false;
    this.state.lightOn = !this.state.lightOn;
    const spot = this.lights[0];
    spot.intensity = this.state.lightOn ? tac.light.intensity : OFF;
    return this.state.lightOn;
  }

  /** Bipod: only meaningful prone or against a ledge; the caller decides that. */
  setBipod(deployed) {
    const under = this.mounted.underbarrel;
    if (!under || !under.deployable) return false;
    this.state.bipodDeployed = !!deployed;
    for (const leg of under.legs) {
      leg.object.rotation.z = deployed ? leg.deployedAngle : leg.stowedAngle;
    }
    return this.state.bipodDeployed;
  }

  /* -------------------------------------------------------------- update */

  /**
   * Per-frame. Allocates nothing: the spot light is aimed by writing into a
   * scratch vector that has existed since module load, and the beam is scaled
   * rather than rebuilt.
   *
   * @param {number} dt
   * @param {{ hitDistance:number }} aim distance to whatever the bore is pointing at
   */
  update(dt, aim) {
    if (this.disposed) return;
    if (this.state.swapT < 1) this.state.swapT = Math.min(1, this.state.swapT + dt * 6);

    const tac = this.mounted.tactical;
    if (!tac) return;

    if (tac.hasLight && this.state.lightOn) {
      const spot = this.lights[0];
      const p = tac.placement;
      _pos.set(p.pos[0], p.pos[1], p.emitZ);
      spot.position.copy(_pos);
      _target.set(p.pos[0], p.pos[1], p.emitZ - 1);
      spot.target.position.copy(_target);
      spot.angle = tac.light.angle;
      spot.distance = tac.light.distance;
      spot.penumbra = tac.light.penumbra;
    }

    if (tac.hasLaser && this.state.laserOn && this.beam) {
      // The beam is one unit long and scaled to the hit distance, so the dot lands
      // on the surface instead of hanging in the air in front of it.
      const d = Math.min(tac.laser.range, aim?.hitDistance ?? tac.laser.range);
      this.beam.scale.z = d;
      if (this.dot) this.dot.position.z = tac.laser.origin[2] - d;
    }
  }

  /* ------------------------------------------------------------- queries */

  def() {
    // Imported lazily to keep this module free of a cycle with defs.js.
    return this._def;
  }

  /** Attach the weapon definition so mounting rules can be checked. */
  bind(def) {
    this._def = def;
    return this;
  }

  /** Current loadout as slot -> id, for saving and for the board. */
  loadout() {
    const out = {};
    for (const slot of SLOT_ORDER) {
      const unit = this.mounted[slot];
      if (unit) out[slot] = unit.id;
    }
    return out;
  }

  /** Resolved stats for the current build, including runtime toggles. */
  stats() {
    return resolveStats(this._def, this.loadout(), {
      laserOn: this.state.laserOn,
      bipodDeployed: this.state.bipodDeployed,
    });
  }

  /** The sight line the camera should use: the mounted optic, or the irons. */
  sightAxis() {
    const optic = this.mounted.optic;
    if (optic && optic.axis) return optic.axis;
    return null;
  }

  /** Geometry sanity for the current build; empty array means clean. */
  issues() {
    return clearanceIssues(this.spec, placementsFor(this.spec, this.loadout()));
  }

  /* ------------------------------------------------------------- disposal */

  #wireTactical(unit) {
    const spot = this.lights[0];
    if (unit.hasLight) {
      spot.color.setHex(unit.light.colour);
      spot.intensity = this.state.lightOn ? unit.light.intensity : OFF;
    } else {
      spot.intensity = OFF;
    }
    if (unit.hasLaser && !this.beam) this.#buildLaser(unit);
    if (this.beam) {
      this.beam.visible = unit.hasLaser && this.state.laserOn;
      this.dot.visible = unit.hasLaser && this.state.laserOn;
    }
  }

  #buildLaser(unit) {
    const L = unit.laser;
    const beamGeo = new THREE.CylinderGeometry(L.beamR, L.beamR, 1, 6, 1, true);
    // Built along +Y, rotated to lie down the bore, translated so it starts at
    // the emitter: doing this in the geometry means the update path only scales.
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, -0.5);
    const beamMat = new THREE.MeshBasicMaterial({
      color: L.colour,
      transparent: true,
      opacity: L.beamOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.beam = new THREE.Mesh(beamGeo, beamMat);
    this.beam.position.set(L.origin[0], L.origin[1], L.origin[2]);
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    this.group.add(this.beam);

    const dotGeo = new THREE.SphereGeometry(L.dotR * 0.5, 8, 6);
    const dotMat = new THREE.MeshBasicMaterial({
      color: L.colour,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dot = new THREE.Mesh(dotGeo, dotMat);
    this.dot.position.set(L.origin[0], L.origin[1], L.origin[2]);
    this.dot.visible = false;
    this.group.add(this.dot);
  }

  #lightsOff() {
    for (const spot of this.lights) spot.intensity = OFF;
    this.state.lightOn = false;
    this.state.laserOn = false;
  }

  /** Hand back every resource. Called on weapon change and on teardown. */
  dispose() {
    if (this.disposed) return;
    for (const unit of this.cache.values()) {
      if (unit.legs) {
        for (const leg of unit.legs) leg.assembly.dispose?.();
      }
      unit.assembly.dispose?.();
      unit.object?.traverse?.((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
        }
      });
    }
    this.cache.clear();
    if (this.beam) {
      this.beam.geometry.dispose();
      this.beam.material.dispose();
      this.beam = null;
    }
    if (this.dot) {
      this.dot.geometry.dispose();
      this.dot.material.dispose();
      this.dot = null;
    }
    for (const spot of this.lights) {
      spot.intensity = OFF;
      spot.parent?.remove(spot.target);
      spot.parent?.remove(spot);
    }
    this.lights.length = 0;
    this.group.parent?.remove(this.group);
    this.mounted = { optic: null, muzzle: null, tactical: null, underbarrel: null, magazine: null };
    this.disposed = true;
  }
}

/** Convenience: a rig already wearing the weapon's factory loadout. */
export function rigFor(def, o) {
  const rig = new HardwareRig({ ...o, weaponId: def.id }).bind(def);
  rig.setLoadout(defaultLoadout(def));
  return rig;
}
