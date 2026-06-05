// ═══════════════════════════════════════════════════════════
//  WARFRONT — Map registry (+ custom maps from RTDB)
// ═══════════════════════════════════════════════════════════

export { MapGrid, CELL_OPEN, CELL_BLOCKED } from './map-core.js';
export { buildGridFromGameplay } from './grid-builder.js';
export { buildCityGrid } from './city.grid.js';
export { buildShipmentGrid } from './shipment.grid.js';
export { buildCrossfireGrid } from './crossfire.grid.js';
export { buildOutpostGrid } from './outpost.grid.js';
export { CITY_GAMEPLAY } from './city.data.js';
export { SHIPMENT_GAMEPLAY } from './shipment.data.js';
export { CROSSFIRE_GAMEPLAY } from './crossfire.data.js';
export { OUTPOST_GAMEPLAY } from './outpost.data.js';

import { buildGridFromGameplay } from './grid-builder.js';
import { buildCityGrid } from './city.grid.js';
import { buildShipmentGrid } from './shipment.grid.js';
import { buildCrossfireGrid } from './crossfire.grid.js';
import { buildOutpostGrid } from './outpost.grid.js';
import { CITY_GAMEPLAY } from './city.data.js';
import { SHIPMENT_GAMEPLAY } from './shipment.data.js';
import { CROSSFIRE_GAMEPLAY } from './crossfire.data.js';
import { OUTPOST_GAMEPLAY } from './outpost.data.js';
import { mapDataToGameplay } from './map-schema.js';
import { loadMapFromFirebase, listMapsFromFirebase } from './map-storage.js';

export const DEFAULT_MAP_ID = 'city';

/** @type {Map<string, { data: object, gameplay: object }>} */
const customMaps = new Map();

/** @type {object[]|null} */
let _catalogCache = null;

/** @type {Record<string, () => import('./map-core.js').MapGrid>} */
const BUILDERS = {
  city:      buildCityGrid,
  shipment:  buildShipmentGrid,
  crossfire: buildCrossfireGrid,
  outpost:   buildOutpostGrid,
};

/** @type {Record<string, object>} */
const GAMEPLAY = {
  city:      CITY_GAMEPLAY,
  shipment:  SHIPMENT_GAMEPLAY,
  crossfire: CROSSFIRE_GAMEPLAY,
  outpost:   OUTPOST_GAMEPLAY,
};

const MAP_CATALOG_BASE = [
  CITY_GAMEPLAY,
  SHIPMENT_GAMEPLAY,
  CROSSFIRE_GAMEPLAY,
  OUTPOST_GAMEPLAY,
].map(g => ({
  id:          g.meta.id,
  name:        g.meta.name,
  description: g.meta.description,
  custom:      false,
}));

/** Maps selectable in the menu (built-in + custom). */
export function getMapCatalog() {
  if (!_catalogCache) _rebuildCatalog();
  return _catalogCache;
}

/** @deprecated use getMapCatalog() */
export const MAP_CATALOG = MAP_CATALOG_BASE;

function _rebuildCatalog() {
  _catalogCache = [
    ...MAP_CATALOG_BASE,
    ...[...customMaps.values()].map(({ data }) => ({
      id:          data.meta.id,
      name:        data.meta.name,
      description: data.meta.description ?? 'Custom map',
      custom:      true,
    })),
  ];
}

/**
 * Register a custom map from editor JSON or Firebase.
 * @param {import('./map-schema.js').CustomMapData} mapData
 */
export function registerCustomMap(mapData) {
  const gp = mapDataToGameplay(mapData);
  customMaps.set(mapData.meta.id, { data: mapData, gameplay: gp });
  BUILDERS[mapData.meta.id] = () => buildGridFromGameplay(gp);
  GAMEPLAY[mapData.meta.id] = gp;
  _catalogCache = null;
}

/** @param {string} id */
export function isCustomMapId(id) {
  return customMaps.has(id);
}

/** Prefetch all `/maps/` entries from Firebase into the local registry. */
export async function prefetchCustomMapsFromFirebase() {
  try {
    const list = await listMapsFromFirebase();
    for (const entry of list) {
      try {
        const data = await loadMapFromFirebase(entry.id);
        registerCustomMap(data);
      } catch { /* skip broken entries */ }
    }
  } catch {
    /* offline or not logged in */
  }
}

/**
 * @param {string} [id]
 * @returns {import('./map-core.js').MapGrid}
 */
export function createMapGrid(id = DEFAULT_MAP_ID) {
  const build = BUILDERS[id];
  if (!build) throw new Error(`Unknown map id: ${id}`);
  return build();
}

/**
 * @param {string} [id]
 * @returns {object}
 */
export function getMapGameplay(id = DEFAULT_MAP_ID) {
  return GAMEPLAY[id] ?? GAMEPLAY[DEFAULT_MAP_ID];
}

/** @param {string} id */
export function isValidMapId(id) {
  return id in BUILDERS;
}
