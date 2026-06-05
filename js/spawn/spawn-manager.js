// ═══════════════════════════════════════════════════════════
//  WARFRONT — Spawn slot selection & player placement
// ═══════════════════════════════════════════════════════════

import { PLAYER_HEIGHT, SPAWN_OCCUPANCY_RADIUS } from '../config.js';
import { yawTowardPoint } from '../math/angles.js';

/**
 * Manages spawn slot claims and player placement on the map.
 * @param {import('../game.js').Game} game
 */
export class SpawnManager {
  constructor(game) {
    this.game = game;
    this.claimedSpawns = new Set();
    this.playerSpawnSlot = 0;
  }

  reset() {
    this.claimedSpawns.clear();
    this.playerSpawnSlot = 0;
  }

  spawnHalf() {
    return Math.ceil(this.game.map.spawnPoints.length / 2);
  }

  countOccupancyNearSpawn(slotIndex) {
    const game = this.game;
    const sp = game.map.spawnPoints[slotIndex];
    if (!sp) return 0;
    const r2 = SPAWN_OCCUPANCY_RADIUS * SPAWN_OCCUPANCY_RADIUS;
    let n = 0;

    const near = (x, z) => {
      const dx = x - sp.x;
      const dz = z - sp.z;
      return dx * dx + dz * dz <= r2;
    };

    if (game.camera && near(game.camera.position.x, game.camera.position.z)) n++;

    for (const b of game.bots) {
      if (b.alive && near(b.mesh.position.x, b.mesh.position.z)) n++;
    }
    for (const sb of game.syncedBots) {
      if (sb?.alive && near(sb.mesh.position.x, sb.mesh.position.z)) n++;
    }
    for (const rp of game.remotePlayers.values()) {
      if (rp.mesh.visible && near(rp.mesh.position.x, rp.mesh.position.z)) n++;
    }
    for (const [uid, p] of game.mp?.players ?? []) {
      if (uid === game.mp?.uid) continue;
      const px = p.x ?? 0;
      const pz = p.z ?? 0;
      if (px !== 0 || pz !== 0) {
        if (near(px, pz)) n++;
      }
    }
    return n;
  }

  /**
   * Pick the least crowded spawn slot in [minSlot, maxSlot).
   * @param {number} minSlot
   * @param {number} maxSlot
   */
  claimLeastCrowdedSpawn(minSlot, maxSlot) {
    let best = minSlot;
    let bestCount = Infinity;
    for (let i = minSlot; i < maxSlot; i++) {
      if (this.claimedSpawns.has(i)) continue;
      const c = this.countOccupancyNearSpawn(i);
      if (c < bestCount) {
        bestCount = c;
        best = i;
      }
    }
    if (bestCount === Infinity) {
      for (let i = minSlot; i < maxSlot; i++) {
        if (!this.claimedSpawns.has(i)) {
          this.claimedSpawns.add(i);
          return i;
        }
      }
      return minSlot;
    }
    this.claimedSpawns.add(best);
    return best;
  }

  initPlayerSpawnSlot() {
    const half = this.spawnHalf();
    if (this.game.mp?.uid) {
      let h = 0;
      for (let i = 0; i < this.game.mp.uid.length; i++) {
        h = (h * 31 + this.game.mp.uid.charCodeAt(i)) | 0;
      }
      const preferred = ((h % half) + half) % half;
      if (this.countOccupancyNearSpawn(preferred) === 0) {
        this.playerSpawnSlot = preferred;
        this.claimedSpawns.add(preferred);
        return;
      }
    }
    this.playerSpawnSlot = this.claimLeastCrowdedSpawn(0, half);
  }

  getSpawnPos(slotIndex) {
    const pts = this.game.map.spawnPoints;
    const i   = ((slotIndex % pts.length) + pts.length) % pts.length;
    return { x: pts[i].x, z: pts[i].z };
  }

  /** Nudge position if the exact spawn cell overlaps a wall. */
  placePlayerAt(x, z) {
    const { camera, map } = this.game;
    const offsets = [
      [0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7],
      [1.0, 1.0], [-1.0, 1.0], [1.0, -1.0], [-1.0, -1.0],
    ];
    for (const [dx, dz] of offsets) {
      const tx = x + dx;
      const tz = z + dz;
      if (!map.isWall(tx, tz)) {
        camera.position.set(tx, PLAYER_HEIGHT, tz);
        return;
      }
    }
    camera.position.set(x, PLAYER_HEIGHT, z);
  }

  placePlayerAtWithYaw(x, z, lookX, lookZ) {
    this.placePlayerAt(x, z);
    this.game.camera.rotation.set(0, yawTowardPoint(x, z, lookX, lookZ), 0);
  }

  /** Reclaim a spawn slot after respawn. */
  claimRespawnSlot() {
    this.claimedSpawns.delete(this.playerSpawnSlot);
    const half = this.spawnHalf();
    this.playerSpawnSlot = this.claimLeastCrowdedSpawn(0, half);
    return this.getSpawnPos(this.playerSpawnSlot);
  }
}
