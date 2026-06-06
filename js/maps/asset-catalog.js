// ═══════════════════════════════════════════════════════════
//  WARFRONT — Map editor asset definitions (procedural + models)
// ═══════════════════════════════════════════════════════════

import { getModelCatalog } from './model-loader.js';

/**
 * @typedef {object} AssetToolDef
 * @property {string} id
 * @property {string} label
 * @property {boolean} blocks
 * @property {'wall'|'cover'|'pillar'|null} gridKind
 * @property {[number, number]} [footprint] — cells [width, depth] from anchor gx/gz
 * @property {'basic'|'props'|'spawns'|'models'} category
 * @property {string} [modelId] — set when id is a loaded GLB model
 * @property {number} [yOffset] — GLB vertical offset
 */

/** @type {AssetToolDef[]} */
export const PROCEDURAL_ASSETS = [
  { id: 'wall',         label: 'Wall',        blocks: true,  gridKind: 'wall',   footprint: [1, 1], category: 'basic' },
  { id: 'cover',        label: 'Cover',       blocks: true,  gridKind: 'cover',  footprint: [1, 1], category: 'basic' },
  { id: 'crate',        label: 'Crate',       blocks: true,  gridKind: 'cover',  footprint: [1, 1], category: 'basic' },
  { id: 'pillar',       label: 'Pillar',      blocks: true,  gridKind: 'pillar', footprint: [1, 1], category: 'basic' },
  { id: 'barrier',      label: 'Barrier',     blocks: true,  gridKind: 'cover',  footprint: [1, 1], category: 'props' },
  { id: 'sandbags',     label: 'Sandbags',    blocks: true,  gridKind: 'cover',  footprint: [1, 1], category: 'props' },
  { id: 'dumpster',     label: 'Dumpster',    blocks: true,  gridKind: 'cover',  footprint: [2, 1], category: 'props' },
  { id: 'container',    label: 'Container',   blocks: true,  gridKind: 'cover',  footprint: [3, 2], category: 'props' },
  { id: 'lamp',         label: 'Street Lamp', blocks: false, gridKind: null,     footprint: [1, 1], category: 'props' },
  { id: 'spawn_pvp',    label: 'PvP Spawn',   blocks: false, gridKind: null,     footprint: [1, 1], category: 'spawns' },
  { id: 'spawn_pve',    label: 'Bot Spawn',   blocks: false, gridKind: null,     footprint: [1, 1], category: 'spawns' },
  { id: 'spawn_alpha',  label: 'Alpha Spawn', blocks: false, gridKind: null,     footprint: [1, 1], category: 'spawns' },
  { id: 'spawn_omega',  label: 'Omega Spawn', blocks: false, gridKind: null,     footprint: [1, 1], category: 'spawns' },
  { id: 'ammo_chest',   label: 'Ammo Chest',  blocks: false, gridKind: null,     footprint: [1, 1], category: 'spawns' },
];

const PROCEDURAL_BY_ID = new Map(PROCEDURAL_ASSETS.map(a => [a.id, a]));

/** @param {import('./model-loader.js').MapModelEntry} entry */
function toolDefFromCatalogEntry(entry) {
  return {
    id:        `model:${entry.id}`,
    label:     entry.label ?? entry.id,
    blocks:    entry.blocks ?? true,
    gridKind:  entry.gridKind ?? 'cover',
    footprint: entry.footprint ?? [1, 1],
    category:  'models',
    modelId:   entry.id,
    yOffset:   entry.yOffset ?? 0,
  };
}

/** @param {import('./map-schema.js').MapAsset} asset */
function toolDefFromStoredModelAsset(asset) {
  return {
    id:        `model:${asset.modelId}`,
    label:     asset.modelId,
    blocks:    asset.blocks ?? true,
    gridKind:  asset.gridKind ?? 'cover',
    footprint: asset.footprint ?? [1, 1],
    category:  'models',
    modelId:   asset.modelId,
    yOffset:   asset.yOffset ?? 0,
  };
}

/** @type {AssetToolDef[]} */
let _modelTools = [];

/** @param {import('./model-loader.js').MapModelEntry[]} entries */
export function setModelTools(entries) {
  _modelTools = entries.map(m => ({
    id:        `model:${m.id}`,
    label:     m.label ?? m.id,
    blocks:    m.blocks ?? true,
    gridKind:  m.gridKind ?? 'cover',
    footprint: m.footprint ?? [1, 1],
    category:  'models',
    modelId:   m.id,
    yOffset:   m.yOffset ?? 0,
  }));
}

/** @returns {AssetToolDef[]} */
export function getEditorAssetTools() {
  return [...PROCEDURAL_ASSETS, ..._modelTools];
}

/**
 * @param {import('./map-schema.js').MapAsset} asset
 * @returns {AssetToolDef|null}
 */
export function getAssetDef(asset) {
  if (asset.type === 'model' && asset.modelId) {
    const fromTools = _modelTools.find(t => t.modelId === asset.modelId);
    if (fromTools) return fromTools;
    const fromCatalog = getModelCatalog().find(m => m.id === asset.modelId);
    if (fromCatalog) return toolDefFromCatalogEntry(fromCatalog);
    if (asset.blocks !== undefined || asset.footprint || asset.gridKind) {
      return toolDefFromStoredModelAsset(asset);
    }
    return null;
  }
  return PROCEDURAL_BY_ID.get(asset.type) ?? null;
}

/**
 * @param {import('./map-schema.js').MapAsset} asset
 * @returns {AssetToolDef|null}
 */
export function getToolDefForType(type, modelId) {
  if (type === 'model' && modelId) {
    return getAssetDef({ type: 'model', modelId, id: '_', gx: 0, gz: 0, x: 0, y: 0, z: 0 });
  }
  if (type.startsWith('model:')) {
    const id = type.slice(6);
    return getAssetDef({ type: 'model', modelId: id, id: '_', gx: 0, gz: 0, x: 0, y: 0, z: 0 });
  }
  return PROCEDURAL_BY_ID.get(type) ?? null;
}

/** @param {import('./map-schema.js').MapAsset} asset */
export function assetTypeBlocks(asset) {
  const def = getAssetDef(asset);
  return def?.blocks ?? false;
}

/** Oriented footprint size in cells. */
export function orientedFootprint(footprint, rotY = 0) {
  const [fw, fh] = footprint ?? [1, 1];
  const quarterTurns = Math.round((rotY % (Math.PI * 2)) / (Math.PI / 2)) & 3;
  return quarterTurns % 2 === 1 ? [fh, fw] : [fw, fh];
}

/**
 * Grid cells occupied by an asset (anchor = gx, gz).
 * @param {import('./map-schema.js').MapAsset} asset
 */
export function assetFootprintCells(asset) {
  const def = getAssetDef(asset);
  const [w, h] = orientedFootprint(def?.footprint ?? asset.footprint, asset.rotY ?? 0);
  const cells = [];
  for (let dx = 0; dx < w; dx++) {
    for (let dz = 0; dz < h; dz++) {
      cells.push([asset.gx + dx, asset.gz + dz]);
    }
  }
  return cells;
}

/**
 * World center for a multi-cell footprint anchored at gx/gz.
 * @param {number} gx
 * @param {number} gz
 * @param {[number, number]} footprint
 * @param {number} rotY
 * @param {number} cellSize
 */
export function footprintWorldCenter(gx, gz, footprint, rotY, cellSize) {
  const [w, h] = orientedFootprint(footprint, rotY);
  return {
    x: gx * cellSize + cellSize * 0.5 + (w - 1) * cellSize * 0.5,
    z: gz * cellSize + cellSize * 0.5 + (h - 1) * cellSize * 0.5,
  };
}

/** @param {string} toolId */
export function parseToolSelection(toolId) {
  if (toolId.startsWith('model:')) {
    return { type: 'model', modelId: toolId.slice(6) };
  }
  return { type: toolId, modelId: undefined };
}
