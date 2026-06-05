// ═══════════════════════════════════════════════════════════
//  WARFRONT — Build city collision grid from city.data.js
// ═══════════════════════════════════════════════════════════

import { MapGrid } from './map-core.js';
import {
  CITY_MAP_META,
  CITY_OPEN_RECTS,
  CITY_PILLARS,
  CITY_COVERS,
  CITY_DUMPSTERS,
  CITY_LAMPS,
  CITY_DOOR_ROWS,
  CITY_DOOR_LEFT,
  CITY_DOOR_RIGHT,
} from './city.data.js';

/**
 * @returns {MapGrid}
 */
export function buildCityGrid() {
  const g = new MapGrid(CITY_MAP_META.width, CITY_MAP_META.height);

  for (const r of CITY_OPEN_RECTS) {
    g.carveOpen(r.x, r.z, r.w, r.h, r.kind ?? 'floor');
  }

  g.placeBlockedMany(CITY_PILLARS, 'pillar');
  g.placeBlockedMany(CITY_COVERS, 'cover');
  g.placeBlockedMany(CITY_DUMPSTERS, 'cover');
  g.placeBlockedMany(CITY_LAMPS, 'wall');

  for (const gz of CITY_DOOR_ROWS) {
    for (const gx of CITY_DOOR_LEFT) g.carveOpen(gx, gz, 1, 1, 'floor');
    for (const gx of CITY_DOOR_RIGHT) g.carveOpen(gx, gz, 1, 1, 'floor');
  }

  validateCityGrid(g);
  return g;
}

/**
 * Dev check: every declared obstacle is blocked; door cells stay open.
 * Call when authoring a new map layout.
 * @param {import('./map-core.js').MapGrid} g
 */
export function validateCityGrid(g) {
  const blocked = [
    ...CITY_PILLARS.map(c => [c, 'pillar']),
    ...CITY_COVERS.map(c => [c, 'cover']),
    ...CITY_DUMPSTERS.map(c => [c, 'cover']),
    ...CITY_LAMPS.map(c => [c, 'wall']),
  ];
  const bad = blocked.filter(([[gx, gz]]) => g.isOpenCell(gx, gz));
  if (bad.length) {
    const sample = bad.slice(0, 5).map(([[gx, gz], k]) => `[${gx},${gz}] ${k}`).join(', ');
    throw new Error(`City map: ${bad.length} obstacle cell(s) still walkable: ${sample}`);
  }

  for (const gz of CITY_DOOR_ROWS) {
    for (const gx of [...CITY_DOOR_LEFT, ...CITY_DOOR_RIGHT]) {
      if (!g.isOpenCell(gx, gz)) {
        throw new Error(`City map: door cell [${gx},${gz}] is blocked`);
      }
    }
  }
}
