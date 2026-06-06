// ═══════════════════════════════════════════════════════════
//  WARFRONT — Mesh collider queries (movement + LOS)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { PLAYER_HEIGHT, PLAYER_RADIUS } from '../config.js';

const _box = new THREE.Box3();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _target = new THREE.Vector3();

/** Body heights sampled for horizontal mesh blocking. */
const BLOCK_HEIGHTS = [0.4, 0.85, 1.25];
const BLOCK_RAY_DIRS = 12;

/** Precomputed horizontal ray directions (XZ plane). */
const _horizDirs = Array.from({ length: BLOCK_RAY_DIRS }, (_, i) => {
  const a = (i / BLOCK_RAY_DIRS) * Math.PI * 2;
  return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
});

/**
 * World-space mesh colliders (from Blender COL_* objects or generated boxes).
 */
export class CollisionWorld {
  constructor() {
    /** @type {THREE.Object3D[]} */
    this.roots = [];
    /** @type {THREE.Mesh[]} */
    this.meshes = [];
    this._raycaster = new THREE.Raycaster();
    this.active = false;
  }

  clear() {
    this.roots = [];
    this.meshes = [];
    this.active = false;
  }

  /** @param {THREE.Object3D} root — group or mesh; updates mesh list */
  addRoot(root) {
    if (!root) return;
    this.roots.push(root);
    root.updateMatrixWorld(true);
    root.traverse(c => {
      if (c.isMesh && (c.userData.isMeshCollider || c.userData.mapColliderBox)) {
        c.userData.isMeshCollider = true;
        c.visible = false;
        if (!this.meshes.includes(c)) this.meshes.push(c);
      }
    });
    this.active = this.meshes.length > 0;
  }

  /** @param {THREE.Object3D[]} roots */
  setRoots(roots) {
    this.clear();
    for (const r of roots) this.addRoot(r);
  }

  _refreshMeshList() {
    this.meshes = [];
    for (const root of this.roots) {
      root.updateMatrixWorld(true);
      root.traverse(c => {
        if (c.isMesh && c.userData.isMeshCollider) this.meshes.push(c);
      });
    }
    this.active = this.meshes.length > 0;
  }

  /**
   * Player cylinder vs collider mesh (triangle-accurate via raycasts).
   * Box colliders (perimeter) use exact AABB.
   * @param {number} x
   * @param {number} z
   * @param {number} [radius]
   */
  isBlocked(x, z, radius = PLAYER_RADIUS) {
    if (!this.active) return false;
    const yMin = 0;
    const yMax = PLAYER_HEIGHT;

    for (const mesh of this.meshes) {
      mesh.updateMatrixWorld(true);
      _box.setFromObject(mesh);
      if (_box.max.y <= yMin || _box.min.y >= yMax) continue;
      if (x + radius <= _box.min.x || x - radius >= _box.max.x
          || z + radius <= _box.min.z || z - radius >= _box.max.z) continue;

      if (mesh.userData.mapColliderBox) {
        return true;
      }

      if (this._meshBlocksCylinder(mesh, x, z, radius, yMin, yMax)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Narrow-phase: sample player cylinder against actual mesh triangles.
   * @param {THREE.Mesh} mesh
   */
  _meshBlocksCylinder(mesh, x, z, radius, yMin, yMax) {
    const rc = this._raycaster;
    const reach = radius * 1.05;
    rc.near = 0;
    rc.far = reach;

    for (const h of BLOCK_HEIGHTS) {
      if (h <= yMin + 0.05 || h >= yMax - 0.05) continue;

      const sampleXZ = [
        [x, z],
        ..._horizDirs.map(d => [x + d.x * radius, z + d.z * radius]),
      ];

      for (const [px, pz] of sampleXZ) {
        _origin.set(px, h, pz);

        // Inside a closed collider shell
        if (this._pointInsideMesh(mesh, px, h, pz)) return true;

        // Near surface within player radius
        for (const d of _horizDirs) {
          _dir.copy(d);
          rc.set(_origin, _dir);
          const hits = rc.intersectObject(mesh, false);
          if (hits.length > 0 && hits[0].distance <= reach) return true;
        }
      }
    }
    return false;
  }

  /** Even-odd ray test along +X (closed/watertight COL meshes). */
  _pointInsideMesh(mesh, x, y, z) {
    _origin.set(x, y, z);
    _dir.set(1, 0, 0);
    this._raycaster.set(_origin, _dir);
    this._raycaster.near = 0;
    this._raycaster.far = Infinity;
    const hits = this._raycaster.intersectObject(mesh, false);
    if (hits.length > 0 && hits[0].distance < 0.02) return true;
    return hits.length % 2 === 1;
  }

  /**
   * Horizontal line-of-sight at chest height.
   */
  hasLOS(x1, z1, x2, z2, y = PLAYER_HEIGHT * 0.85) {
    if (!this.active) return true;
    _origin.set(x1, y, z1);
    _target.set(x2, y, z2);
    _dir.copy(_target).sub(_origin);
    const dist = _dir.length();
    if (dist < 0.05) return true;
    _dir.multiplyScalar(1 / dist);
    this._raycaster.set(_origin, _dir);
    this._raycaster.far = Math.max(0, dist - 0.08);
    this._raycaster.near = 0.05;
    return this._raycaster.intersectObjects(this.meshes, false).length === 0;
  }
}

/** Create invisible box colliders for custom-map perimeter walls. */
export function createPerimeterColliders(width, height, cellSize, borderCells) {
  const group = new THREE.Group();
  group.name = 'perimeter-colliders';
  const mapW = width * cellSize;
  const mapD = height * cellSize;
  const bt = borderCells * cellSize;
  const wallH = PLAYER_HEIGHT + 1.5;

  const addBox = (bw, bh, bd, px, py, pz) => {
    const geo = new THREE.BoxGeometry(bw, bh, bd);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
    mesh.position.set(px, py + bh * 0.5, pz);
    mesh.userData.isMeshCollider = true;
    mesh.userData.mapColliderBox = true;
    group.add(mesh);
  };

  addBox(bt, wallH, mapD, bt * 0.5, 0, mapD * 0.5);
  addBox(bt, wallH, mapD, mapW - bt * 0.5, 0, mapD * 0.5);
  addBox(mapW, wallH, bt, mapW * 0.5, 0, bt * 0.5);
  addBox(mapW, wallH, bt, mapW * 0.5, 0, mapD - bt * 0.5);

  return group;
}
