// ═══════════════════════════════════════════════════════════
//  WARFRONT — GLB / GLTF map props (drop files in assets/map-models/)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { splitGltfRoot, cloneModelInstance } from '../collision/gltf-colliders.js';

export const MAP_MODELS_ROOT = 'assets/map-models/';

/**
 * @typedef {object} MapModelEntry
 * @property {string} id          — unique id used in map JSON (modelId)
 * @property {string} file        — filename inside assets/map-models/ (.glb recommended)
 * @property {string} [label]     — editor palette label
 * @property {number} [scale]     — uniform scale (default 1)
 * @property {number} [yOffset]   — vertical offset after load
 * @property {boolean} [blocks]   — blocks movement (default true)
 * @property {'wall'|'cover'|'pillar'} [gridKind]
 * @property {[number, number]} [footprint] — editor placement cells [w, d] (not used for mesh COL)
 * @property {boolean} [useMeshCollider] — use Blender COL mesh when present (default true)
 */

/** @type {MapModelEntry[]} */
let _catalog = [];

/**
 * @typedef {object} ModelTemplate
 * @property {THREE.Object3D} visual
 * @property {THREE.Mesh[]} colliders
 * @property {boolean} hasMeshCollider
 * @property {MapModelEntry} entry
 */

/** @type {Map<string, ModelTemplate>} */
const _templates = new Map();
let _initPromise = null;

const _loader = new GLTFLoader();

/** @param {Partial<MapModelEntry> & { file: string }} raw */
function normalizeModelEntry(raw) {
  if (!raw?.file) return null;
  const base = raw.file.replace(/\.(glb|gltf)$/i, '');
  const id = raw.id ?? base;
  const label = raw.label ?? base.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return {
    id,
    file: raw.file,
    label,
    scale: raw.scale ?? 1,
    yOffset: raw.yOffset ?? 0,
    blocks: raw.blocks ?? true,
    gridKind: raw.gridKind ?? 'cover',
    footprint: raw.footprint ?? [1, 1],
    useMeshCollider: raw.useMeshCollider !== false,
  };
}

/**
 * Load manifest.json and preload all listed models.
 * @returns {Promise<MapModelEntry[]>}
 */
export function initMapModels() {
  if (!_initPromise) {
    _initPromise = _loadCatalog();
  }
  return _initPromise;
}

/** Force reload (e.g. after adding GLB files to manifest). */
export function reloadMapModels() {
  _initPromise = null;
  _catalog = [];
  _templates.clear();
  return initMapModels();
}

async function _loadCatalog() {
  _catalog = [];
  _templates.clear();

  try {
    const res = await fetch(`${MAP_MODELS_ROOT}manifest.json`);
    if (!res.ok) return _catalog;
    const data = await res.json();
    const rawModels = Array.isArray(data?.models) ? data.models : [];
    const models = rawModels.map(normalizeModelEntry).filter(Boolean);
    await Promise.all(models.map(entry => _preload(entry)));
    _catalog = models.filter(m => _templates.has(m.id));
  } catch (err) {
    console.warn('[MapModels] Could not load model catalog:', err);
  }
  return _catalog;
}

/** @param {MapModelEntry} entry */
async function _preload(entry) {
  if (!entry?.id || !entry?.file) return;
  const url = `${MAP_MODELS_ROOT}${entry.file}`;
  try {
    const gltf = await _loader.loadAsync(url);
    const scale = entry.scale ?? 1;
    if (scale !== 1) gltf.scene.scale.setScalar(scale);

    const { visual, colliders } = splitGltfRoot(gltf.scene);
    visual.traverse(c => {
      if (c.isMesh) {
        c.castShadow = true;
        c.receiveShadow = true;
      }
    });
    visual.updateMatrixWorld(true);

    const hasMeshCollider = colliders.length > 0;
    if (hasMeshCollider) {
      console.info(`[MapModels] ${entry.id}: ${colliders.length} COL mesh(es)`);
    } else if (entry.useMeshCollider) {
      console.warn(`[MapModels] ${entry.id}: no COL mesh — using footprint fallback`);
    }

    _templates.set(entry.id, {
      visual,
      colliders,
      hasMeshCollider,
      entry,
    });
  } catch (err) {
    console.warn(`[MapModels] Failed to load ${url}:`, err);
  }
}

/** @returns {MapModelEntry[]} */
export function getModelCatalog() {
  return _catalog;
}

/** @param {string} modelId */
export function hasMapModel(modelId) {
  return _templates.has(modelId);
}

/** @param {string} modelId */
export function modelHasMeshCollider(modelId) {
  return _templates.get(modelId)?.hasMeshCollider ?? false;
}

/** @param {string} modelId */
export function modelUsesMeshCollider(modelId) {
  const t = _templates.get(modelId);
  if (!t) return false;
  return t.entry.useMeshCollider !== false && t.hasMeshCollider;
}

/** Visual-only clone (legacy). @param {string} modelId */
export function cloneMapModel(modelId) {
  const template = _templates.get(modelId);
  if (!template) return null;
  return template.visual.clone(true);
}

/** Visual + collider group for placement. @param {string} modelId */
export function cloneMapModelWithColliders(modelId) {
  const template = _templates.get(modelId);
  if (!template) return null;
  return cloneModelInstance(template);
}
