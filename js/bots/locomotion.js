// ═══════════════════════════════════════════════════════════
//  WARFRONT — Bot locomotion (lane march, no wall sliding)
// ═══════════════════════════════════════════════════════════

import { SPAWN_OCCUPANCY_RADIUS } from '../config.js';
import { yawToward } from '../character.js';

/**
 * Movement on the map grid — no sliding along walls on advance.
 */
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
    for (const sp of this.map.spawnPoints ?? []) {
      if (Math.hypot(x - sp.x, z - sp.z) < SPAWN_OCCUPANCY_RADIUS) return true;
    }
    return false;
  }

  /** Combat strafe — single step only, no axis slide. */
  tryStep(dx, dz) {
    const nx = this.x + dx;
    const nz = this.z + dz;
    if (!this.canWalk(nx, nz)) return false;
    this.mesh.position.x = nx;
    this.mesh.position.z = nz;
    return true;
  }

  /**
   * March toward a lane waypoint (stay near lane centre, no wall hugging).
   * @param {{ centerX: number }} lane
   * @returns {boolean}
   */
  stepLane(wx, wz, lane, delta, speed) {
    const bx = this.x;
    const bz = this.z;
    let dx = wx - bx;
    let dz = wz - bz;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.2) {
      this.stuckTime = 0;
      return false;
    }

    const step = Math.min(speed * delta, dist);
    if (lane) {
      dx += (lane.centerX - bx) * 0.35;
    }

    const len = Math.hypot(dx, dz) || 1;
    const nx = bx + (dx / len) * step;
    const nz = bz + (dz / len) * step;

    if (this.canWalk(nx, nz)) {
      this.mesh.position.x = nx;
      this.mesh.position.z = nz;
      this.stuckTime = 0;
      return true;
    }

    if (Math.abs(dz) >= Math.abs(dx)) {
      const nzOnly = bz + Math.sign(wz - bz) * step;
      if (this.canWalk(bx, nzOnly)) {
        this.mesh.position.z = nzOnly;
        this.stuckTime = 0;
        return true;
      }
    }

    if (lane) {
      const pull = Math.sign(lane.centerX - bx) * Math.min(step, Math.abs(lane.centerX - bx));
      const nxOnly = bx + pull;
      if (pull !== 0 && this.canWalk(nxOnly, bz)) {
        this.mesh.position.x = nxOnly;
        this.stuckTime = 0;
        return true;
      }
    }

    this.stuckTime += delta;
    return false;
  }

  /** Nudge to a random open spot in-lane when blocked. */
  nudgeInLane(lane) {
    if (!lane) return;
    for (let i = 0; i < 10; i++) {
      const nx = lane.centerX + (Math.random() - 0.5) * lane.halfWidth;
      const nz = this.z + (Math.random() - 0.5) * 4;
      if (this.canWalk(nx, nz) && !this.nearSpawn(nx, nz)) {
        this.mesh.position.x = nx;
        this.mesh.position.z = nz;
        this.stuckTime = 0;
        return;
      }
    }
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
