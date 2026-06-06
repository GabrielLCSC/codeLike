// ═══════════════════════════════════════════════════════════
//  WARFRONT — GLB weapon viewmodels / world pickups
//
//  Pipeline (same for every weapon):
//  1. Load GLB → strip COL meshes
//  2. Anchor: center X/Z, bottom Y at 0  (Blender scene offset ignored)
//  3. Fit: scale so longest axis = UNIFORM_FIT_LENGTH (measured AFTER view rotation)
//  4. Pose: WEAPON_POSES.view rotation + position (global, one place)
//  5. Camera: WeaponSystem REST_POS (bottom-right of screen, same for all)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { splitGltfRoot } from '../collision/gltf-colliders.js';
import { WEAPONS } from '../config.js';

export const WEAPON_MODELS_ROOT = 'assets/weapon-models/';

/**
 * Global poses — tune here only, not per weapon in manifest.
 * Rotation order: YXZ, radians.
 */
export const WEAPON_POSES = {
  /** First-person. Position nudges all guns together after normalize. */
  view: {
    position: [0, 0, 0],
    rotation: [0, -Math.PI / 2, 0],
    scale: 1,
  },
  world: {
    position: [0, 0, 0],
    rotation: [Math.PI / 2, Math.PI / 2, 0],
    scale: 1,
  },
  held: {
    position: [0.06, -0.04, 0.14],
    rotation: [-0.55, 0.05, 0],
    scale: 1,
  },
};

/** Only used when manifest `"autoFit": true`. Otherwise Blender scale is kept as-is. */
export const UNIFORM_FIT_LENGTH = 0.50;

/** @type {Map<string, { visual: THREE.Object3D, entry: WeaponModelEntry, muzzle: THREE.Vector3 }>} */
const _templates = new Map();
/** @type {WeaponModelEntry[]} */
let _catalog = [];
let _initPromise = null;

const _loader = new GLTFLoader();

/**
 * @typedef {object} WeaponModelEntry
 * @property {string} id
 * @property {string} file
 * @property {string} [label]
 * @property {number} [scale] — extra multiplier (default 1)
 * @property {boolean} [autoFit] — force scale to fitLength (default false — keep Blender size)
 * @property {number} [fitLength] — override UNIFORM_FIT_LENGTH for one entry
 * @property {[number, number, number]} [muzzle]
 * @property {{ position?: number[], rotation?: number[], scale?: number }} [view]
 * @property {{ position?: number[], rotation?: number[], scale?: number }} [world]
 * @property {{ position?: number[], rotation?: number[], scale?: number }} [held]
 */

/** @param {Partial<WeaponModelEntry> & { id: string, file: string }} raw */
function normalizeEntry(raw) {
  if (!raw?.id || !raw?.file) return null;
  return {
    id: raw.id,
    file: raw.file,
    label: raw.label ?? WEAPONS[raw.id]?.name ?? raw.id,
    scale: raw.scale ?? 1,
    autoFit: raw.autoFit === true,
    fitLength: raw.fitLength,
    muzzle: raw.muzzle,
    view: raw.view,
    world: raw.world,
    held: raw.held,
  };
}

function _countMeshes(root) {
  let n = 0;
  root.traverse(c => { if (c.isMesh) n++; });
  return n;
}

function _updateSkeletons(root) {
  root.traverse(c => {
    if (c.isSkinnedMesh) {
      c.skeleton?.update();
      c.computeBoundingBox();
      c.computeBoundingSphere();
    }
  });
}

function _prepareMeshes(root) {
  root.traverse(c => {
    if (!c.isMesh) return;
    c.frustumCulled = false;
    c.castShadow = true;
    c.receiveShadow = true;
    const mats = Array.isArray(c.material) ? c.material : [c.material];
    for (const m of mats) {
      if (!m) continue;
      m.side = THREE.DoubleSide;
      if (m.transparent && m.opacity < 0.05) {
        m.opacity = 1;
        m.transparent = false;
      }
    }
  });
}

/**
 * Uniform position anchor — same rule for every weapon.
 * Blender object location in the scene is discarded.
 * Origin ends up: centered on X/Z, bottom of mesh at Y=0.
 * @param {THREE.Object3D} obj
 */
function _applyUniformAnchor(obj) {
  _updateSkeletons(obj);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  obj.position.x -= center.x;
  obj.position.z -= center.z;
  obj.position.y -= box.min.y;
}

/** @param {THREE.Object3D} root @param {WeaponModelEntry} entry */
function _measureMaxDimAfterViewPose(root, entry) {
  const probe = root.clone(true);
  applyPose(probe, { ...entry, scale: 1 }, 'view');
  _updateSkeletons(probe);
  probe.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(probe);
  if (box.isEmpty()) return 0;
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z);
}

/**
 * Center + uniform size (same target for all weapons).
 * @param {THREE.Object3D} visual
 * @param {WeaponModelEntry} entry
 */
function _normalizeWeaponVisual(visual, entry) {
  _prepareMeshes(visual);
  visual.updateMatrixWorld(true);

  if (_countMeshes(visual) === 0) {
    console.warn(`[WeaponModels] ${entry.id}: GLB has no mesh geometry`);
    return null;
  }

  const wrapper = new THREE.Group();
  wrapper.name = 'weapon-normalized';
  _applyUniformAnchor(visual);
  wrapper.add(visual);

  if (entry.autoFit) {
    const maxDim = _measureMaxDimAfterViewPose(wrapper, entry);
    if (maxDim > 0.001) {
      const target = entry.fitLength ?? UNIFORM_FIT_LENGTH;
      const autoScale = target / maxDim;
      visual.scale.setScalar(autoScale);
      console.info(
        `[WeaponModels] ${entry.id}: auto-fit ${maxDim.toFixed(3)}m → ${target}m (×${autoScale.toFixed(4)})`,
      );
    }
  } else {
    const maxDim = _measureMaxDimAfterViewPose(wrapper, entry);
    console.info(
      `[WeaponModels] ${entry.id}: using Blender scale (longest axis ${maxDim.toFixed(3)}m after view pose)`,
    );
  }

  wrapper.updateMatrixWorld(true);
  return wrapper;
}

function _resolvePose(entry, mode) {
  const base = WEAPON_POSES[mode];
  const override = mode === 'view' ? entry.view
    : mode === 'world' ? entry.world
      : entry.held;
  if (!override) return { ...base };
  return {
    position: override.position ?? base.position,
    rotation: override.rotation ?? base.rotation,
    scale: override.scale ?? base.scale,
  };
}

/** @param {THREE.Object3D} obj @param {WeaponModelEntry} entry @param {'view'|'world'|'held'} mode */
export function applyPose(obj, entry, mode) {
  const pose = _resolvePose(entry, mode);
  const s = (entry.scale ?? 1) * (pose.scale ?? 1);
  if (s !== 1) obj.scale.setScalar(s);

  const pos = pose.position ?? [0, 0, 0];
  obj.position.set(pos[0], pos[1], pos[2]);

  const rot = pose.rotation ?? [0, 0, 0];
  obj.rotation.order = 'YXZ';
  obj.rotation.set(rot[0], rot[1], rot[2]);
}

function _resolveMuzzleOffset(root, entry) {
  if (entry.muzzle?.length === 3) {
    return new THREE.Vector3(entry.muzzle[0], entry.muzzle[1], entry.muzzle[2]);
  }

  let muzzleNode = null;
  root.traverse(c => {
    if (/^muzzle/i.test(c.name ?? '')) muzzleNode = c;
  });

  if (muzzleNode) {
    root.updateMatrixWorld(true);
    const pos = new THREE.Vector3();
    muzzleNode.getWorldPosition(pos);
    return root.worldToLocal(pos.clone());
  }

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (!box.isEmpty()) {
    return new THREE.Vector3(
      (box.min.x + box.max.x) * 0.5,
      (box.min.y + box.max.y) * 0.5,
      box.min.z,
    );
  }

  return new THREE.Vector3(0, 0.05, -0.4);
}

async function _preload(entry) {
  const url = `${WEAPON_MODELS_ROOT}${entry.file}`;
  try {
    const gltf = await _loader.loadAsync(url);
    const { visual } = splitGltfRoot(gltf.scene);
    const normalized = _normalizeWeaponVisual(visual, entry);
    if (!normalized) return;

    const poseProbe = normalized.clone(true);
    applyPose(poseProbe, entry, 'view');
    poseProbe.updateMatrixWorld(true);
    const muzzle = _resolveMuzzleOffset(poseProbe, entry);

    _templates.set(entry.id, { visual: normalized, entry, muzzle });
    console.info(`[WeaponModels] Loaded ${entry.id} from ${entry.file}`);
  } catch (err) {
    console.warn(`[WeaponModels] Failed to load ${url} — using procedural mesh:`, err);
  }
}

async function _loadCatalog() {
  _templates.clear();
  _catalog = [];

  try {
    const res = await fetch(`${WEAPON_MODELS_ROOT}manifest.json`);
    if (!res.ok) return _catalog;
    const data = await res.json();
    const raw = Array.isArray(data?.weapons) ? data.weapons : [];
    const entries = raw.map(normalizeEntry).filter(Boolean);
    await Promise.all(entries.map(_preload));
    _catalog = entries.filter(e => _templates.has(e.id));
  } catch (err) {
    console.warn('[WeaponModels] Could not load weapon manifest:', err);
  }
  return _catalog;
}

export function initWeaponModels() {
  if (!_initPromise) _initPromise = _loadCatalog();
  return _initPromise;
}

export function reloadWeaponModels() {
  _initPromise = null;
  _catalog = [];
  _templates.clear();
  return initWeaponModels();
}

export function getWeaponModelCatalog() {
  return _catalog;
}

export function hasWeaponModel(key) {
  return _templates.has(key);
}

export function getWeaponMuzzleOffset(key) {
  const t = _templates.get(key);
  if (t) return t.muzzle.clone();
  return new THREE.Vector3(0, 0.05, -0.4);
}

export function cloneWeaponViewModel(key) {
  const t = _templates.get(key);
  if (!t) return null;
  const group = new THREE.Group();
  const model = t.visual.clone(true);
  applyPose(model, t.entry, 'view');
  group.add(model);
  return group;
}

export function cloneWeaponWorldModel(key) {
  const t = _templates.get(key);
  if (!t) return null;
  const root = new THREE.Group();
  const model = t.visual.clone(true);
  applyPose(model, t.entry, 'world');
  root.add(model);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  model.position.y -= box.min.y;
  model.position.y += 0.04;
  return root;
}

export function cloneWeaponHeldModel(key) {
  const t = _templates.get(key);
  if (!t) return null;
  const group = new THREE.Group();
  applyPose(group, t.entry, 'held');
  const model = t.visual.clone(true);
  applyPose(model, t.entry, 'view');
  group.add(model);
  return group;
}
