// ═══════════════════════════════════════════════════════════
//  WARFRONT — Extract Blender collision meshes from glTF
//  Name meshes/objects: COL, COL_*, COLLIDER, UCX_* (case-insensitive)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';

/** Matches COL, COL_box, COLLIDER, UCX_smth */
export const COLLIDER_NAME_RE = /^(COL(?:_|$)|COLLIDER|UCX_)/i;

/** @param {THREE.Object3D} obj */
export function isColliderNode(obj) {
  return !!(obj?.name && COLLIDER_NAME_RE.test(obj.name));
}

/** True if this mesh or any ancestor (up to root) is a collider node. */
export function meshInColliderBranch(mesh, stopAt) {
  let node = mesh;
  while (node && node !== stopAt) {
    if (node.isMesh && isColliderNode(node)) return true;
    if (!node.isMesh && isColliderNode(node)) return true;
    node = node.parent;
  }
  return false;
}

/**
 * Bake mesh world transform into geometry; returns mesh at origin for instancing.
 * @param {THREE.Mesh} mesh
 */
export function extractColliderMesh(mesh) {
  mesh.updateWorldMatrix(true, false);
  const geo = mesh.geometry.clone();
  geo.applyMatrix4(mesh.matrixWorld);
  const col = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
  );
  if (!geo.boundingBox) geo.computeBoundingBox();
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  col.name = mesh.name || 'COL';
  col.userData.isMeshCollider = true;
  return col;
}

/**
 * Split loaded glTF root into visual tree + local-space collider meshes.
 * @param {THREE.Object3D} root
 */
export function splitGltfRoot(root) {
  root.updateMatrixWorld(true);

  /** @type {THREE.Mesh[]} */
  const colliders = [];
  /** @type {THREE.Mesh[]} */
  const toStrip = [];

  root.traverse(c => {
    if (c.isMesh && meshInColliderBranch(c, root)) {
      colliders.push(extractColliderMesh(c));
      toStrip.push(c);
    }
  });

  for (const m of toStrip) {
    m.parent?.remove(m);
    m.geometry?.dispose();
    if (m.material) {
      if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose());
      else m.material.dispose();
    }
  }

  // Remove empty COL parent nodes left behind
  /** @type {THREE.Object3D[]} */
  const colNodes = [];
  root.traverse(c => {
    if (c !== root && isColliderNode(c)) colNodes.push(c);
  });
  colNodes.sort((a, b) => {
    const depth = n => {
      let d = 0;
      let p = n.parent;
      while (p) { d++; p = p.parent; }
      return d;
    };
    return depth(b) - depth(a);
  });
  for (const node of colNodes) node.parent?.remove(node);

  return { visual: root, colliders };
}

/**
 * Clone a placed model instance with colliders grouped for transform.
 * @param {{ visual: THREE.Object3D, colliders: THREE.Mesh[] }} template
 */
export function cloneModelInstance(template) {
  if (!template) return { visual: null, colliderGroup: null };
  const visual = template.visual.clone(true);
  const colliderGroup = new THREE.Group();
  colliderGroup.name = 'colliders';
  for (const col of template.colliders) {
    const c = col.clone(true);
    c.userData.isMeshCollider = true;
    colliderGroup.add(c);
  }
  return { visual, colliderGroup };
}
