// ═══════════════════════════════════════════════════════════
//  WARFRONT — Grid A* pathfinding for bot navigation
// ═══════════════════════════════════════════════════════════

import { CELL_SIZE } from '../config.js';

const CS = CELL_SIZE;

const NEIGHBORS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Binary min-heap keyed by `f` — O(log n) push/pop vs sorting each step. */
class MinHeap {
  constructor() {
    /** @type {{ gx:number, gz:number, f:number }[]} */
    this._data = [];
  }

  get length() {
    return this._data.length;
  }

  push(item) {
    const a = this._data;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this._data;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop();
    if (a.length && last !== undefined) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      while (true) {
        let smallest = i;
        const l = (i << 1) + 1;
        const r = l + 1;
        if (l < n && a[l].f < a[smallest].f) smallest = l;
        if (r < n && a[r].f < a[smallest].f) smallest = r;
        if (smallest === i) break;
        [a[i], a[smallest]] = [a[smallest], a[i]];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * A* on MapGrid (blocked vs open). Used by bots to path around cover.
 */
export class GridPathfinder {
  /** @param {import('../mapgen.js').MapGenerator} map */
  constructor(map) {
    this.map = map;
  }

  worldToCell(wx, wz) {
    return {
      gx: Math.floor(wx / CS),
      gz: Math.floor(wz / CS),
    };
  }

  cellCenter(gx, gz) {
    return { x: gx * CS + CS * 0.5, z: gz * CS + CS * 0.5 };
  }

  isWalkableCell(gx, gz) {
    if (gx < 0 || gz < 0 || gx >= this.map.width || gz >= this.map.height) return false;
    return this.map.mapGrid?.isOpenCell(gx, gz) ?? this.map.grid[gx][gz] === 1;
  }

  /**
   * @returns {{ x:number, z:number }[]|null} world waypoints
   */
  findPath(fromX, fromZ, toX, toZ, maxNodes = 3000) {
    const start = this.worldToCell(fromX, fromZ);
    const goal  = this.worldToCell(toX, toZ);

    const gCell = this.isWalkableCell(goal.gx, goal.gz)
      ? goal
      : this._nearestWalkable(goal.gx, goal.gz, 10);
    if (!gCell) return null;

    const sCell = this.isWalkableCell(start.gx, start.gz)
      ? start
      : this._nearestWalkable(start.gx, start.gz, 6);
    if (!sCell) return null;

    const cells = this._aStar(sCell, gCell, maxNodes);
    if (!cells) return null;
    return cells.map(({ gx, gz }) => this.cellCenter(gx, gz));
  }

  /**
   * Nearest stand cell from which the bot can see the target (peek / flank goal).
   * @returns {{ x:number, z:number }|null}
   */
  findNearestLosCell(fromX, fromZ, targetX, targetZ, radius = 10) {
    const { gx: cx, gz: cz } = this.worldToCell(targetX, targetZ);
    let best     = null;
    let bestDist = Infinity;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (!this.isWalkableCell(gx, gz)) continue;
        const c = this.cellCenter(gx, gz);
        if (!this.map.hasLOS(c.x, c.z, targetX, targetZ)) continue;
        const d = Math.hypot(c.x - fromX, c.z - fromZ);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
    }
    return best;
  }

  _cellKey(gx, gz) {
    return gx * this.map.height + gz;
  }

  _octile(gx, gz, tx, tz) {
    const dx = Math.abs(gx - tx);
    const dz = Math.abs(gz - tz);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  }

  _aStar(start, goal, maxNodes) {
    const goalKey = this._cellKey(goal.gx, goal.gz);
    /** @type {Map<number, { gx:number, gz:number }>} */
    const cameFrom = new Map();
    /** @type {Map<number, number>} */
    const gScore   = new Map();

    const startKey = this._cellKey(start.gx, start.gz);
    gScore.set(startKey, 0);

    const open   = new MinHeap();
    const closed = new Set();
    open.push({
      gx: start.gx,
      gz: start.gz,
      f:  this._octile(start.gx, start.gz, goal.gx, goal.gz),
    });
    let nodes = 0;

    while (open.length && nodes++ < maxNodes) {
      const cur = open.pop();
      if (!cur) break;
      const ck  = this._cellKey(cur.gx, cur.gz);
      if (closed.has(ck)) continue;
      closed.add(ck);

      if (ck === goalKey) {
        return this._reconstruct(cameFrom, cur);
      }

      const gCur = gScore.get(ck) ?? Infinity;

      for (const [dx, dz] of NEIGHBORS) {
        const ngx = cur.gx + dx;
        const ngz = cur.gz + dz;
        if (!this.isWalkableCell(ngx, ngz)) continue;

        const nk = this._cellKey(ngx, ngz);
        if (closed.has(nk)) continue;

        const step = (dx && dz) ? Math.SQRT2 : 1;
        const tg   = gCur + step;
        if (tg >= (gScore.get(nk) ?? Infinity)) continue;

        cameFrom.set(nk, { gx: cur.gx, gz: cur.gz });
        gScore.set(nk, tg);
        open.push({
          gx: ngx,
          gz: ngz,
          f:  tg + this._octile(ngx, ngz, goal.gx, goal.gz),
        });
      }
    }
    return null;
  }

  _reconstruct(cameFrom, goal) {
    const path = [{ gx: goal.gx, gz: goal.gz }];
    let ck = this._cellKey(goal.gx, goal.gz);
    while (cameFrom.has(ck)) {
      const p = cameFrom.get(ck);
      path.push(p);
      ck = this._cellKey(p.gx, p.gz);
    }
    path.reverse();
    return path;
  }

  _nearestWalkable(gx, gz, radius) {
    let best  = null;
    let bestD = Infinity;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const nx = gx + dx;
        const nz = gz + dz;
        if (!this.isWalkableCell(nx, nz)) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best  = { gx: nx, gz: nz };
        }
      }
    }
    return best;
  }
}
