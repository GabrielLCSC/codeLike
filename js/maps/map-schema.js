// ═══════════════════════════════════════════════════════════
//  WARFRONT — Custom map JSON schema (v1)
// ═══════════════════════════════════════════════════════════

import { MAP_W, MAP_H, CELL_SIZE } from '../config.js';
import {
  standardSpawnPoints,
  standardAmmoChests,
  standardLodibidon,
  standardLanes,
} from './lane-layout.js';
import {
  assetFootprintCells,
  getAssetDef,
  getToolDefForType,
} from './asset-catalog.js';

export const MAP_SCHEMA_VERSION = 1;

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
 */

/**
 * @typedef {object} CustomMapData
 * @property {number} version
 * @property {{ id: string, name: string, description?: string, width: number, height: number, scene?: string }} meta
 * @property {MapAsset[]} assets
 * @property {{ x: number, z: number, w: number, h: number, kind?: string }[]} [openRects]
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

/** @returns {CustomMapData} */
export function createEmptyMapData(overrides = {}) {
  return {
    version: MAP_SCHEMA_VERSION,
    meta: {
      id:          'custom-draft',
      name:        'Untitled Map',
      description: 'Custom map created in the editor.',
      width:       MAP_W,
      height:      MAP_H,
      scene:       'custom',
      ...overrides.meta,
    },
    openRects: defaultCustomOpenRects(),
    assets: [],
    ...overrides,
  };
}

/** @param {CustomMapData} data */
export function validateMapData(data) {
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

    if (def?.blocks && def.gridKind) {
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
    ammoChests:  ammoChests.length ? ammoChests : standardAmmoChests(),
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
      sky: 0x8899aa,
      fog: 0x8899aa,
      fogDensity: 0.016,
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
