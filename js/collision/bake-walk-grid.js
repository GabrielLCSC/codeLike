// ═══════════════════════════════════════════════════════════
//  WARFRONT — Bake MapGrid walkability from mesh colliders (bot A*)
// ═══════════════════════════════════════════════════════════

import { CELL_SIZE, PLAYER_RADIUS } from '../config.js';
import { MapGrid } from '../maps/map-core.js';
import { blockMapPerimeter } from '../maps/grid-builder.js';

/**
 * Sample mesh collision into a walk grid for A* pathfinding + minimap.
 * @param {import('./collision-world.js').CollisionWorld} collisionWorld
 * @param {number} width — cells X
 * @param {number} height — cells Z
 * @param {{ blockPerimeter?: boolean }} [opts]
 */
export function bakeWalkGridFromCollision(collisionWorld, width, height, opts = {}) {
  const cellSize = CELL_SIZE;
  const grid = new MapGrid(width, height);
  grid.carveOpen(0, 0, width, height, 'floor');

  if (opts.blockPerimeter) blockMapPerimeter(grid);

  const r = PLAYER_RADIUS * 0.9;
  const half = cellSize * 0.38;

  for (let gx = 0; gx < width; gx++) {
    for (let gz = 0; gz < height; gz++) {
      const cx = gx * cellSize + cellSize * 0.5;
      const cz = gz * cellSize + cellSize * 0.5;
      const blocked = [
        [cx, cz],
        [cx + half, cz],
        [cx - half, cz],
        [cx, cz + half],
        [cx, cz - half],
        [cx + half, cz + half],
        [cx - half, cz - half],
      ].some(([x, z]) => collisionWorld.isBlocked(x, z, r));

      if (blocked) grid.placeBlocked(gx, gz, 'cover');
    }
  }

  return grid;
}

/** @param {MapGrid} grid @param {import('./collision-world.js').CollisionWorld} cw */
export function gridMatchesCollision(grid, cw) {
  if (!cw.active) return false;
  const cs = CELL_SIZE;
  for (let gx = 0; gx < grid.width; gx++) {
    for (let gz = 0; gz < grid.height; gz++) {
      const cx = gx * cs + cs * 0.5;
      const cz = gz * cs + cs * 0.5;
      const blocked = cw.isBlocked(cx, cz);
      const open = grid.isOpenCell(gx, gz);
      if (blocked !== !open) return false;
    }
  }
  return true;
}
