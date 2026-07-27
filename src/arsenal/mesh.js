import * as THREE from 'three';
import { triCount } from '../weapons/geometry.js';

/**
 * Assembly -> scene node.
 *
 * `Assembly.build()` takes NO arguments and returns `Map<materialKey, geometry>`;
 * it is a geometry merger, not a scene-graph builder. Treating its result as an
 * Object3D is silent nonsense until the first `.add()` or `.visible` write blows
 * up at runtime, so the conversion lives here once and every arsenal consumer
 * (the hardware rig, the gunsmith preview) goes through it.
 *
 * One mesh per material per assembly, which is what keeps a whole rifle inside
 * 7-9 draw calls — the same budget `viewmodel.addWeapon` holds itself to.
 *
 * @param {import('../weapons/geometry.js').Assembly} asm
 * @param {(key: string) => THREE.Material} materialFor
 * @param {{ receiveShadow?: boolean, castShadow?: boolean, frustumCulled?: boolean }} [o]
 * @returns {THREE.Group} with `.tris` set for the budget log
 */
export function meshifyAssembly(asm, materialFor, o = {}) {
  const group = new THREE.Group();
  group.name = asm.name ?? 'assembly';
  let tris = 0;
  for (const [matKey, geo] of asm.build()) {
    const mesh = new THREE.Mesh(geo, materialFor(matKey));
    mesh.name = `${group.name}-${matKey}`;
    // Held hardware never casts into the world cascades, but it must RECEIVE
    // shadow or it reads as a sticker pasted over a shaded street.
    mesh.castShadow = o.castShadow ?? false;
    mesh.receiveShadow = o.receiveShadow ?? true;
    mesh.frustumCulled = o.frustumCulled ?? false;
    group.add(mesh);
    tris += triCount(geo);
  }
  group.tris = tris;
  return group;
}

/**
 * Release every geometry under a node built by `meshifyAssembly`.
 *
 * Materials are deliberately NOT disposed: they come from the shared weapon
 * material bank, which hands the same instance to several weapons at once, so
 * disposing one here would blank the gun still in the player's hands.
 */
export function disposeNode(node) {
  if (!node) return 0;
  let n = 0;
  node.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
      n += 1;
    }
  });
  node.parent?.remove(node);
  return n;
}
