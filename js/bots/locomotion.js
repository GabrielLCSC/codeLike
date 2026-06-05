// ═══════════════════════════════════════════════════════════
//  WARFRONT — Bot locomotion (path follow + collision)
// ═══════════════════════════════════════════════════════════

import { SPAWN_OCCUPANCY_RADIUS } from '../config.js';
import { yawToward } from '../character.js';

export class BotLocomotion {
  /**
   * @param {THREE.Object3D} mesh
   * @param {import('../mapgen.js').MapGenerator} map
   * @param {{ x: number, z: number }} spawnPos
   */
  constructor(mesh, map, spawnPos) {
    this.mesh      = mesh;
    this.map       = map;
    this.spawnPos  = spawnPos;
    this.stuckTime = 0;
  }

  get x() { return this.mesh.position.x; }
  get z() { return this.mesh.position.z; }

  nudgeFromSpawn() {
    const base = this.spawnPos;
    const offsets = [
      [0, 0], [1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4],
      [2.0, 0], [0, 2.0], [-2.0, 0], [0, -2.0],
    ];
    for (const [dx, dz] of offsets) {
      const tx = base.x + dx;
      const tz = base.z + dz;
      if (!this.canWalk(tx, tz)) continue;
      if (this.nearSpawn(tx, tz)) continue;
      this.mesh.position.set(tx, 0, tz);
      return;
    }
    for (const [dx, dz] of offsets) {
      const tx = base.x + dx;
      const tz = base.z + dz;
      if (this.canWalk(tx, tz)) this.mesh.position.set(tx, 0, tz);
    }
  }

  canWalk(x, z) {
    return !this.map.isWall(x, z);
  }

  nearSpawn(x, z) {
    const points = [...(this.map.spawnPoints ?? [])];
    for (const team of ['alpha', 'omega']) {
      for (const sp of this.map.lodibidonSpawns?.[team] ?? []) {
        points.push(sp);
      }
    }
    for (const sp of points) {
      if (Math.hypot(x - sp.x, z - sp.z) < SPAWN_OCCUPANCY_RADIUS) return true;
    }
    return false;
  }

  /**
   * Follow A* waypoints.
   * @returns {{ moved: boolean, pathIdx: number }}
   */
  stepAlongPath(waypoints, pathIdx, delta, speed) {
    if (!waypoints?.length) {
      this.stuckTime += delta;
      return { moved: false, pathIdx: 0 };
    }

    let idx = Math.min(pathIdx, waypoints.length - 1);

    while (idx < waypoints.length) {
      const wp   = waypoints[idx];
      const dx   = wp.x - this.x;
      const dz   = wp.z - this.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.55) {
        idx++;
        this.stuckTime = 0;
        continue;
      }

      const step = Math.min(speed * delta, dist);
      const ux   = dx / dist;
      const uz   = dz / dist;
      const nx   = this.x + ux * step;
      const nz   = this.z + uz * step;

      if (this.canWalk(nx, nz)) {
        this.mesh.position.x = nx;
        this.mesh.position.z = nz;
        this.stuckTime = 0;
        return { moved: true, pathIdx: idx };
      }
      if (this.canWalk(nx, this.z)) {
        this.mesh.position.x = nx;
        this.stuckTime = 0;
        return { moved: true, pathIdx: idx };
      }
      if (this.canWalk(this.x, nz)) {
        this.mesh.position.z = nz;
        this.stuckTime = 0;
        return { moved: true, pathIdx: idx };
      }

      this.stuckTime += delta;
      return { moved: false, pathIdx: idx };
    }

    this.stuckTime = 0;
    return { moved: false, pathIdx: idx };
  }

  /** Direct step toward a world point (combat closing / short reposition). */
  stepToward(tx, tz, delta, speed, minDist = 0.4) {
    const dx   = tx - this.x;
    const dz   = tz - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= minDist) {
      this.stuckTime += delta;
      return false;
    }
    const step = Math.min(speed * delta, Math.max(0, dist - minDist));
    const ux   = dx / dist;
    const uz   = dz / dist;
    const nx   = this.x + ux * step;
    const nz   = this.z + uz * step;
    if (this.canWalk(nx, nz)) {
      this.mesh.position.x = nx;
      this.mesh.position.z = nz;
      this.stuckTime = 0;
      return true;
    }
    if (this.canWalk(nx, this.z)) {
      this.mesh.position.x = nx;
      this.stuckTime = 0;
      return true;
    }
    if (this.canWalk(this.x, nz)) {
      this.mesh.position.z = nz;
      this.stuckTime = 0;
      return true;
    }
    this.stuckTime += delta;
    return false;
  }

  turnToward(tx, tz, delta, sharp = false) {
    const dx = tx - this.x;
    const dz = tz - this.z;
    if (Math.hypot(dx, dz) < 0.05) return;

    const target = yawToward(dx, dz);
    let diff = target - this.mesh.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const rate = sharp ? 16 : 8;
    this.mesh.rotation.y += diff * Math.min(1, delta * rate);
  }
}
