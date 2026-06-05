// ═══════════════════════════════════════════════════════════
//  WARFRONT — Map core (collision grid + minimap)
//  Single source of truth: 1 = walkable, 0 = blocked.
// ═══════════════════════════════════════════════════════════

import { CELL_SIZE, PLAYER_RADIUS } from '../config.js';

export const CELL_OPEN    = 1;
export const CELL_BLOCKED = 0;

/** @typedef {'floor'|'cover'|'pillar'|'wall'} MinimapTile */

/**
 * Collision + pathfinding grid shared by gameplay, bots, and minimap.
 */
export class MapGrid {
  /**
   * @param {number} width  — cells X
   * @param {number} height — cells Z
   */
  constructor(width, height) {
    this.width  = width;
    this.height = height;
    this.cellSize = CELL_SIZE;
    /** @type {Uint8Array[]} grid[gx][gz] */
    this.grid = Array.from({ length: width }, () => new Uint8Array(height));
    /** @type {Map<number, MinimapTile>} */
    this._tileKind = new Map();
  }

  _key(gx, gz) {
    return gx * this.height + gz;
  }

  /** Mark a rectangle as walkable floor. */
  carveOpen(x, z, w, h, kind = 'floor') {
    for (let gx = x; gx < x + w; gx++) {
      for (let gz = z; gz < z + h; gz++) {
        if (gx < 0 || gz < 0 || gx >= this.width || gz >= this.height) continue;
        this.grid[gx][gz] = CELL_OPEN;
        this._tileKind.set(this._key(gx, gz), kind);
      }
    }
  }

  /** Mark a cell as blocked (wall, cover, pillar, etc.). */
  placeBlocked(gx, gz, kind = 'wall') {
    if (gx < 0 || gz < 0 || gx >= this.width || gz >= this.height) return;
    this.grid[gx][gz] = CELL_BLOCKED;
    this._tileKind.set(this._key(gx, gz), kind);
  }

  placeBlockedMany(cells, kind = 'wall') {
    for (const [gx, gz] of cells) this.placeBlocked(gx, gz, kind);
  }

  isOpenCell(gx, gz) {
    if (gx < 0 || gz < 0 || gx >= this.width || gz >= this.height) return false;
    return this.grid[gx][gz] === CELL_OPEN;
  }

  cellIsBlocked(worldX, worldZ) {
    const gx = Math.floor(worldX / this.cellSize);
    const gz = Math.floor(worldZ / this.cellSize);
    return !this.isOpenCell(gx, gz);
  }

  /** Player cylinder vs grid (same sampling as legacy isWall). */
  isWall(worldX, worldZ) {
    const r = PLAYER_RADIUS;
    return [
      [worldX, worldZ],
      [worldX + r, worldZ],
      [worldX - r, worldZ],
      [worldX, worldZ + r],
      [worldX, worldZ - r],
    ].some(([x, z]) => this.cellIsBlocked(x, z));
  }

  hasLOS(x1, z1, x2, z2) {
    const steps = 24;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.cellIsBlocked(
        x1 + (x2 - x1) * t,
        z1 + (z2 - z1) * t,
      )) return false;
    }
    return true;
  }

  /** Alias used by HUD / MapGenerator. */
  getMinimapImageData() {
    return this.buildMinimapImageData();
  }

  /** RGBA image for minimap — derived from the same grid as collision. */
  buildMinimapImageData() {
    const cols = this.width;
    const rows = this.height;
    const img  = new ImageData(cols, rows);
    const pal  = {
      floor:  [18, 20, 28],
      cover:  [72, 58, 44],
      pillar: [48, 52, 62],
      wall:   [42, 53, 69],
    };

    for (let gx = 0; gx < cols; gx++) {
      for (let gz = 0; gz < rows; gz++) {
        const i = (gz * cols + gx) * 4;
        let rgb;
        if (this.grid[gx][gz] === CELL_OPEN) {
          rgb = pal.floor;
        } else {
          const kind = this._tileKind.get(this._key(gx, gz)) ?? 'wall';
          rgb = pal[kind] ?? pal.wall;
        }
        img.data[i]     = rgb[0];
        img.data[i + 1] = rgb[1];
        img.data[i + 2] = rgb[2];
        img.data[i + 3] = 255;
      }
    }
    return img;
  }
}
