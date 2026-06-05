// ═══════════════════════════════════════════════════════════
//  WARFRONT — Map registry
// ═══════════════════════════════════════════════════════════

export { MapGrid, CELL_OPEN, CELL_BLOCKED } from './map-core.js';
export { buildCityGrid } from './city.grid.js';
export { buildShipmentGrid } from './shipment.grid.js';
export { buildCrossfireGrid } from './crossfire.grid.js';
export { buildOutpostGrid } from './outpost.grid.js';
export { CITY_GAMEPLAY } from './city.data.js';
export { SHIPMENT_GAMEPLAY } from './shipment.data.js';
export { CROSSFIRE_GAMEPLAY } from './crossfire.data.js';
export { OUTPOST_GAMEPLAY } from './outpost.data.js';

import { buildCityGrid } from './city.grid.js';
import { buildShipmentGrid } from './shipment.grid.js';
import { buildCrossfireGrid } from './crossfire.grid.js';
import { buildOutpostGrid } from './outpost.grid.js';
import { CITY_GAMEPLAY } from './city.data.js';
import { SHIPMENT_GAMEPLAY } from './shipment.data.js';
import { CROSSFIRE_GAMEPLAY } from './crossfire.data.js';
import { OUTPOST_GAMEPLAY } from './outpost.data.js';

export const DEFAULT_MAP_ID = 'city';

/** @typedef {import('./city.data.js').CITY_GAMEPLAY extends infer T ? T : never} MapGameplay */

/** @type {Record<string, () => import('./map-core.js').MapGrid>} */
const BUILDERS = {
  city:      buildCityGrid,
  shipment:  buildShipmentGrid,
  crossfire: buildCrossfireGrid,
  outpost:   buildOutpostGrid,
};

/** @type {Record<string, MapGameplay>} */
const GAMEPLAY = {
  city:      CITY_GAMEPLAY,
  shipment:  SHIPMENT_GAMEPLAY,
  crossfire: CROSSFIRE_GAMEPLAY,
  outpost:   OUTPOST_GAMEPLAY,
};

/** Maps selectable in the menu. */
export const MAP_CATALOG = [
  CITY_GAMEPLAY,
  SHIPMENT_GAMEPLAY,
  CROSSFIRE_GAMEPLAY,
  OUTPOST_GAMEPLAY,
].map(g => ({
  id:          g.meta.id,
  name:        g.meta.name,
  description: g.meta.description,
}));

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
 * @returns {MapGameplay}
 */
export function getMapGameplay(id = DEFAULT_MAP_ID) {
  return GAMEPLAY[id] ?? GAMEPLAY[DEFAULT_MAP_ID];
}

/** @param {string} id */
export function isValidMapId(id) {
  return id in BUILDERS;
}
