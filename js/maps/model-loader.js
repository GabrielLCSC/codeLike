// ═══════════════════════════════════════════════════════════
//  WARFRONT — GLB / GLTF map props (drop files in assets/map-models/)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
 * @property {[number, number]} [footprint] — collision cells [w, d]
 */

/** @type {MapModelEntry[]} */
let _catalog = [];
/** @type {Map<string, THREE.Object3D>} */
const _templates = new Map();
let _initPromise = null;

const _loader = new GLTFLoader();

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

async function _loadCatalog() {
  _catalog = [];
  _templates.clear();

  try {
    const res = await fetch(`${MAP_MODELS_ROOT}manifest.json`);
    if (!res.ok) return _catalog;
    const data = await res.json();
    const models = Array.isArray(data?.models) ? data.models : [];
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
    const root = gltf.scene;
    const scale = entry.scale ?? 1;
    if (scale !== 1) root.scale.setScalar(scale);
    root.traverse(c => {
      if (c.isMesh) {
        c.castShadow = true;
        c.receiveShadow = true;
      }
    });
    root.updateMatrixWorld(true);
    _templates.set(entry.id, root);
  } catch (err) {
    console.warn(`[MapModels] Failed to load ${url}:`, err);
  }
}

/** @returns {MapModelEntry[]} */
export function getModelCatalog() {
  return _catalog;
}

/** @param {string} modelId */
export function cloneMapModel(modelId) {
  const template = _templates.get(modelId);
  if (!template) return null;
  return template.clone(true);
}

/** @param {string} modelId */
export function hasMapModel(modelId) {
  return _templates.has(modelId);
}
