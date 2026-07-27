import * as THREE from 'three';

/**
 * SHELL / the armoury bench — the physical thing you walk up to.
 *
 * FPS Arena had weapon boards you touched to swap kit; Claude-of-Duty had no
 * such prop. This builds one: a steel workbench with a pegboard of silhouettes
 * behind it, so the gunsmith screen is entered from somewhere in the world
 * instead of appearing out of a menu the player never located.
 *
 * Budget: one merged mesh per material (four draw calls), no textures, no
 * lights of its own — it is lit by whatever the world's sun and IBL already
 * are, which is what keeps it from reading as a prop pasted into the level.
 */

const NEAR = 2.6;

/** Cheap merge-free build: a handful of boxes sharing three materials. */
function plate(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

export class WeaponBench {
  /**
   * @param {object} o
   * @param {THREE.Object3D} o.scene world scene (or any parent node)
   * @param {[number,number,number]} [o.position]
   * @param {number} [o.rotationY]
   */
  constructor(o) {
    this.parent = o.scene;
    this.node = new THREE.Group();
    this.node.name = 'weapon-bench';
    const p = o.position ?? [0, 0, 0];
    this.node.position.set(p[0], p[1], p[2]);
    this.node.rotation.y = o.rotationY ?? 0;

    // Materials: owned here, disposed here. Three is enough — painted steel for
    // the frame, scuffed ply for the top, dark board for the pegboard.
    this.mats = {
      steel: new THREE.MeshStandardMaterial({ color: 0x3d4650, roughness: 0.52, metalness: 0.82 }),
      ply: new THREE.MeshStandardMaterial({ color: 0x6b5133, roughness: 0.86, metalness: 0.04 }),
      board: new THREE.MeshStandardMaterial({ color: 0x1b2027, roughness: 0.74, metalness: 0.12 }),
      hook: new THREE.MeshStandardMaterial({ color: 0x9aa4b0, roughness: 0.38, metalness: 0.9 }),
    };
    this.geometries = [];

    this.#buildTable();
    this.#buildPegboard();

    this.parent.add(this.node);
    this.near = false;
    this.disposed = false;
  }

  #add(geo, mat, x, y, z, ry = 0) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.node.add(mesh);
    this.geometries.push(geo);
    return mesh;
  }

  #buildTable() {
    const W = 2.4;
    const D = 0.82;
    const H = 0.94;
    // Top: ply over a steel apron, 60 mm proud of the frame so it casts a line.
    this.#add(plate(W, 0.055, D), this.mats.ply, 0, H, 0);
    this.#add(plate(W - 0.09, 0.09, D - 0.08), this.mats.steel, 0, H - 0.07, 0);
    // Legs, inset so the bench does not read as a solid block.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.#add(plate(0.07, H - 0.06, 0.07), this.mats.steel, sx * (W / 2 - 0.13), (H - 0.06) / 2, sz * (D / 2 - 0.12));
      }
    }
    // Lower shelf with two ammo crates, so the silhouette is not a bare table.
    this.#add(plate(W - 0.3, 0.04, D - 0.22), this.mats.steel, 0, 0.26, 0);
    this.#add(plate(0.46, 0.28, 0.3), this.mats.ply, -0.6, 0.44, 0);
    this.#add(plate(0.38, 0.24, 0.28), this.mats.ply, 0.55, 0.42, 0.02);
    // Vice at the working end — the detail that says "parts get changed here".
    this.#add(plate(0.16, 0.12, 0.2), this.mats.steel, W / 2 - 0.28, H + 0.09, -0.06);
    this.#add(plate(0.05, 0.05, 0.26), this.mats.hook, W / 2 - 0.28, H + 0.1, 0.1);
  }

  #buildPegboard() {
    const W = 2.4;
    // The board itself, standing behind the bench.
    this.#add(plate(W, 1.35, 0.035), this.mats.board, 0, 1.72, -0.4);
    // Frame edging.
    this.#add(plate(W + 0.06, 0.05, 0.06), this.mats.steel, 0, 2.4, -0.4);
    this.#add(plate(W + 0.06, 0.05, 0.06), this.mats.steel, 0, 1.04, -0.4);

    // Nine peg pairs, one per weapon in the arsenal, laid out three to a row.
    // Deliberately regular: a pegboard IS a grid, and faking randomness here
    // would look like a mistake rather than a workshop.
    let i = 0;
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1, i += 1) {
        const x = -0.72 + col * 0.72;
        const y = 2.16 - row * 0.42;
        this.#add(plate(0.03, 0.03, 0.1), this.mats.hook, x - 0.16, y, -0.34);
        this.#add(plate(0.03, 0.03, 0.1), this.mats.hook, x + 0.16, y, -0.34);
        // A dark plate behind each pair reads as the worn outline of the gun
        // that hangs there when the rack is full.
        this.#add(plate(0.56, 0.13, 0.008), this.mats.board, x, y - 0.03, -0.38);
      }
    }
  }

  /** World position of the interaction point (front edge, working height). */
  interactPoint(out = new THREE.Vector3()) {
    return out.set(0, 1.0, 0.5).applyMatrix4(this.node.matrixWorld);
  }

  /**
   * @param {THREE.Vector3|{x:number,y:number,z:number}} playerPos
   * @returns {{ near: boolean, distance: number, entered: boolean, left: boolean }}
   */
  proximity(playerPos) {
    if (!playerPos) return { near: false, distance: Infinity, entered: false, left: false };
    const p = this.interactPoint(_scratch);
    const dx = p.x - playerPos.x;
    const dz = p.z - playerPos.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const near = distance < NEAR;
    const entered = near && !this.near;
    const left = !near && this.near;
    this.near = near;
    return { near, distance, entered, left };
  }

  dispose() {
    if (this.disposed) return;
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    for (const m of Object.values(this.mats)) m.dispose();
    this.node.parent?.remove(this.node);
    this.disposed = true;
  }
}

const _scratch = new THREE.Vector3();
