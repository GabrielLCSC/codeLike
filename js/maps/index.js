// ═══════════════════════════════════════════════════════════
//  WARFRONT — Map registry
//  To add a map: create maps/<name>.data.js + maps/<name>.grid.js,
//  register in BUILDERS, set DEFAULT_MAP_ID.
// ═══════════════════════════════════════════════════════════

export { MapGrid, CELL_OPEN, CELL_BLOCKED } from './map-core.js';
export { buildCityGrid } from './city.grid.js';
export * from './city.data.js';

import { buildCityGrid } from './city.grid.js';

export const DEFAULT_MAP_ID = 'city';

/** @type {Record<string, () => import('./map-core.js').MapGrid>} */
const BUILDERS = {
  city: buildCityGrid,
};

/**
 * @param {string} [id]
 * @returns {import('./map-core.js').MapGrid}
 */
export function createMapGrid(id = DEFAULT_MAP_ID) {
  const build = BUILDERS[id];
  if (!build) throw new Error(`Unknown map id: ${id}`);
  return build();
}
