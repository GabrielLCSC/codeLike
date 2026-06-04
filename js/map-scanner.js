// ═══════════════════════════════════════════════════════════
//  WARFRONT — Minimap fog-of-war / map scanning
// ═══════════════════════════════════════════════════════════

import { CELL_SIZE } from './config.js';

const CS = CELL_SIZE;

export class MapScanner {
  /**
   * @param {number} mapWidth  — grid cells
   * @param {number} mapHeight — grid cells
   * @param {number} [revealRadius=2] — cells around player to mark explored
   */
  constructor(mapWidth, mapHeight, revealRadius = 2) {
    this.width  = mapWidth;
    this.height = mapHeight;
    this.radius = revealRadius;
    this.explored = new Uint8Array(mapWidth * mapHeight);
    this._lastGx = -1;
    this._lastGz = -1;
  }

  worldToCell(x, z) {
    return {
      gx: Math.floor(x / CS),
      gz: Math.floor(z / CS),
    };
  }

  /** Reveal cells around world position; returns true if center cell changed. */
  scan(x, z) {
    const gx = Math.floor(x / CS);
    const gz = Math.floor(z / CS);
    const changed = gx !== this._lastGx || gz !== this._lastGz;
    this._lastGx = gx;
    this._lastGz = gz;

    const r = this.radius;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const cx = gx + dx;
        const cz = gz + dz;
        if (cx < 0 || cz < 0 || cx >= this.width || cz >= this.height) continue;
        this.explored[cx * this.height + cz] = 1;
      }
    }
    return changed;
  }

  isExplored(gx, gz) {
    if (gx < 0 || gz < 0 || gx >= this.width || gz >= this.height) return false;
    return this.explored[gx * this.height + gz] === 1;
  }

  isWorldExplored(x, z) {
    const { gx, gz } = this.worldToCell(x, z);
    return this.isExplored(gx, gz);
  }
}
