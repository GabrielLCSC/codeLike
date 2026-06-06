// ═══════════════════════════════════════════════════════════
//  WARFRONT — Custom map JSON schema (v1)
// ═══════════════════════════════════════════════════════════

import { MAP_W, MAP_H, CELL_SIZE } from '../config.js';
import {
  standardSpawnPoints,
  standardLodibidon,
  standardLanes,
} from './lane-layout.js';
import {
  assetFootprintCells,
  getAssetDef,
  getToolDefForType,
} from './asset-catalog.js';
import { resolveMapTheme } from './map-theme.js';

export const MAP_SCHEMA_VERSION = 1;
export const MIN_MAP_CELLS = 16;
export const MAX_MAP_CELLS = 80;

/** Perimeter wall thickness in grid cells (matches visual wall depth in custom-map-scene). */
export const CUSTOM_MAP_BORDER_CELLS = 2;

/** Full walkable floor for blank custom maps (perimeter blocked separately). */
export function defaultCustomOpenRects(width = MAP_W, height = MAP_H) {
  return [{ x: 0, z: 0, w: width, h: height, kind: 'floor' }];
}

/** @typedef {'wall'|'cover'|'crate'|'pillar'|'barrier'|'sandbags'|'dumpster'|'container'|'lamp'|'model'|'spawn_pvp'|'spawn_pve'|'spawn_alpha'|'spawn_omega'|'ammo_chest'} MapAssetType */

/**
 * @typedef {object} MapAsset
 * @property {string} id
 * @property {MapAssetType} type
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} [rotY]
 * @property {number} gx
 * @property {number} gz
 * @property {string} [modelId] — required when type === 'model'
 * @property {boolean} [blocks] — collision (saved with placed models)
 * @property {'wall'|'cover'|'pillar'} [gridKind]
 * @property {[number, number]} [footprint] — grid cells [width, depth]
 * @property {number} [yOffset]
 */

/**
 * @typedef {object} CustomMapData
 * @property {number} version
 * @property {{ id: string, name: string, description?: string, width: number, height: number, scene?: string }} meta
 * @property {MapAsset[]} assets
 * @property {{ x: number, z: number, w: number, h: number, kind?: string }[]} [openRects]
 * @property {{ timeOfDay?: 'day'|'night' }} [theme]
 */

/** @param {string} name */
export function slugifyMapId(name) {
  const base = name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return base ? `custom-${base}` : `custom-${Date.now()}`;
}

/** Snap world XZ to cell center. */
export function snapWorldToCell(x, z, cellSize = CELL_SIZE) {
  const gx = Math.floor(x / cellSize);
  const gz = Math.floor(z / cellSize);
  return {
    gx,
    gz,
    x: gx * cellSize + cellSize * 0.5,
    z: gz * cellSize + cellSize * 0.5,
  };
}

/** @param {number} n @param {number} [fallback] */
export function clampMapSize(n, fallback = MAP_W) {
  const v = Number.parseInt(n, 10);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(MIN_MAP_CELLS, Math.min(MAX_MAP_CELLS, v));
}

/** @returns {{ width: number, height: number }|null} */
export function promptMapDimensions(defaultW = MAP_W, defaultH = MAP_H) {
  const ans = window.prompt(
    `Map size — width x height (${MIN_MAP_CELLS}–${MAX_MAP_CELLS} cells):`,
    `${defaultW}x${defaultH}`,
  );
  if (ans === null) return null;
  return parseMapDimensionsInput(ans, defaultW, defaultH);
}

/** @param {string} str @param {number} defaultW @param {number} defaultH */
export function parseMapDimensionsInput(str, defaultW = MAP_W, defaultH = MAP_H) {
  const trimmed = str.trim();
  const pair = trimmed.match(/^(\d+)\s*[x×,]\s*(\d+)$/i);
  if (pair) {
    return {
      width:  clampMapSize(pair[1], defaultW),
      height: clampMapSize(pair[2], defaultH),
    };
  }
  const single = Number.parseInt(trimmed, 10);
  if (Number.isFinite(single)) {
    const n = clampMapSize(single);
    return { width: n, height: n };
  }
  return { width: defaultW, height: defaultH };
}

/** @returns {CustomMapData} */
export function createEmptyMapData(overrides = {}) {
  const meta = {
    id:          'custom-draft',
    name:        'Untitled Map',
    description: 'Custom map created in the editor.',
    width:       MAP_W,
    height:      MAP_H,
    scene:       'custom',
    ...overrides.meta,
  };
  const w = meta.width ?? MAP_W;
  const h = meta.height ?? MAP_H;
  return {
    version: MAP_SCHEMA_VERSION,
    meta,
    theme: { timeOfDay: 'day', ...overrides.theme },
    openRects: defaultCustomOpenRects(w, h),
    assets: [],
    ...overrides,
  };
}

/** @param {import('./map-schema.js').CustomMapData} data */
export function normalizeMapData(data) {
  if (!data || typeof data !== 'object') return data;
  if (!data.meta) data.meta = { id: 'custom-draft', name: 'Untitled Map', width: MAP_W, height: MAP_H };
  if (!data.meta.width) data.meta.width = MAP_W;
  if (!data.meta.height) data.meta.height = MAP_H;
  if (!Array.isArray(data.assets)) {
    data.assets = data.assets && typeof data.assets === 'object'
      ? Object.values(data.assets)
      : [];
  }
  if (!data.theme || typeof data.theme !== 'object') {
    data.theme = { timeOfDay: 'day' };
  } else if (!data.theme.timeOfDay) {
    data.theme = { timeOfDay: 'day' };
  }
  return data;
}

/** @param {CustomMapData} data */
export function validateMapData(data) {
  normalizeMapData(data);
  if (!data || typeof data !== 'object') throw new Error('Invalid map data.');
  if (!data.meta?.id || !data.meta?.name) throw new Error('Map must have meta.id and meta.name.');
  if (!Array.isArray(data.assets)) throw new Error('Map assets must be an array.');
  const w = data.meta.width ?? MAP_W;
  const h = data.meta.height ?? MAP_H;
  for (const a of data.assets) {
    if (a.type === 'model' && !a.modelId) {
      throw new Error(`Model asset ${a.id} missing modelId.`);
    }
    for (const [gx, gz] of assetFootprintCells(a)) {
      if (gx < 0 || gz < 0 || gx >= w || gz >= h) {
        throw new Error(`Asset ${a.id} out of bounds (${gx}, ${gz}).`);
      }
    }
  }
  return data;
}

function pushBlockedCells(gx, gz, gridKind, pillars, covers) {
  if (gridKind === 'pillar' || gridKind === 'wall') {
    if (!pillars.some(([x, z]) => x === gx && z === gz)) pillars.push([gx, gz]);
  } else if (!covers.some(([x, z]) => x === gx && z === gz)) {
    covers.push([gx, gz]);
  }
}

/**
 * Convert editor JSON → gameplay bundle for MapGrid / MapGenerator.
 * @param {CustomMapData} data
 */
export function mapDataToGameplay(data) {
  validateMapData(data);
  const w = data.meta.width ?? MAP_W;
  const h = data.meta.height ?? MAP_H;
  const lod = standardLodibidon();

  /** @type {[number, number][]} */
  const pillars = [];
  /** @type {[number, number][]} */
  const covers = [];
  /** @type {{ x: number, z: number }[]} */
  const spawnPoints = [];
  /** @type {{ x: number, z: number }[]} */
  const spawnPve = [];
  /** @type {{ x: number, z: number }[]} */
  const alphaSpawns = [];
  /** @type {{ x: number, z: number }[]} */
  const omegaSpawns = [];
  /** @type {{ x: number, z: number }[]} */
  const ammoChests = [];

  for (const a of data.assets) {
    const pos = { x: a.x, z: a.z };
    const def = getAssetDef(a);

    // Custom maps use Blender COL mesh colliders baked at scene build — skip grid footprints.
    const useMeshCollision = data.meta?.scene === 'custom';
    if (!useMeshCollision && def?.blocks && def.gridKind) {
      for (const [gx, gz] of assetFootprintCells(a)) {
        pushBlockedCells(gx, gz, def.gridKind, pillars, covers);
      }
    }

    switch (a.type) {
      case 'spawn_pvp':
        spawnPoints.push(pos);
        break;
      case 'spawn_pve':
        spawnPve.push(pos);
        break;
      case 'spawn_alpha':
        alphaSpawns.push(pos);
        break;
      case 'spawn_omega':
        omegaSpawns.push(pos);
        break;
      case 'ammo_chest':
        ammoChests.push(pos);
        break;
      default:
        break;
    }
  }

  return {
    meta: {
      id:          data.meta.id,
      name:        data.meta.name,
      description: data.meta.description ?? '',
      width:       w,
      height:      h,
      scene:       'custom',
    },
    openRects:   defaultCustomOpenRects(w, h),
    doors:       { rows: [], left: [], right: [] },
    spawnPoints: spawnPoints.length ? spawnPoints : standardSpawnPoints(),
    spawnPve,
    ammoChests,
    groundWeapons: [],
    groundMags:    [],
    lanes:       standardLanes(),
    lodibidonCenter: lod.center,
    lodibidonSpawns: {
      alpha: alphaSpawns.length ? alphaSpawns : lod.spawns.alpha,
      omega: omegaSpawns.length ? omegaSpawns : lod.spawns.omega,
    },
    pillars,
    covers,
    dumpsters: [],
    lamps: [],
    customAssets: data.assets,
    theme: {
      timeOfDay: data.theme?.timeOfDay === 'night' ? 'night' : 'day',
    },
    sceneProfile: {
      palette: {
        asphalt:  0x1e1e22,
        building: 0x4e4e56,
        intFloor: 0x38363c,
        cover:    0x58504a,
        concrete: 0x6a6a72,
      },
    },
  };
}

export { getToolDefForType, assetFootprintCells } from './asset-catalog.js';
