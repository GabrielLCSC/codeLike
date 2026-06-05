// ═══════════════════════════════════════════════════════════
//  WARFRONT — Generic map grid builder from gameplay bundle
// ═══════════════════════════════════════════════════════════

import { MapGrid } from './map-core.js';

/**
 * @param {import('./index.js').MapGameplay} map
 * @returns {MapGrid}
 */
export function buildGridFromGameplay(map) {
  const g = new MapGrid(map.meta.width, map.meta.height);

  for (const r of map.openRects) {
    g.carveOpen(r.x, r.z, r.w, r.h, r.kind ?? 'floor');
  }

  g.placeBlockedMany(map.pillars ?? [], 'pillar');
  g.placeBlockedMany(map.covers ?? [], 'cover');
  g.placeBlockedMany(map.dumpsters ?? [], 'cover');
  g.placeBlockedMany(map.lamps ?? [], 'wall');
  for (const c of map.containers ?? []) {
    g.placeBlocked(c[0], c[1], 'cover');
  }

  const doors = map.doors;
  if (doors?.rows?.length) {
    for (const gz of doors.rows) {
      for (const gx of doors.left ?? []) g.carveOpen(gx, gz, 1, 1, 'floor');
      for (const gx of doors.right ?? []) g.carveOpen(gx, gz, 1, 1, 'floor');
    }
  }

  return g;
}
