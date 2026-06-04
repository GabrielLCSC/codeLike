// ═══════════════════════════════════════════════════════════
//  WARFRONT — Lane-centred march targets (no wall-hugging)
// ═══════════════════════════════════════════════════════════

/**
 * Picks waypoints along map lane midlines with light randomness.
 */
export class LaneMarch {
  /**
   * @param {import('../mapgen.js').MapGenerator} map
   * @param {number} botIndex
   */
  constructor(map, botIndex) {
    this.map       = map;
    this.botIndex  = botIndex;
    this.lanes     = map.lanes ?? [];
    this.lane      = this.lanes[0] ?? null;
    this.waypoint  = { x: 0, z: 0 };
  }

  /** Choose a lane near the player (with slight randomness). */
  ensureLane(botX, botZ, playerX, playerZ) {
    if (!this.lanes.length) {
      this.lane = null;
      return;
    }
    if (this.lane && this._inLane(botX, botZ, this.lane)) return;

    let best = this.lanes[0];
    let bestScore = Infinity;
    for (const lane of this.lanes) {
      const score =
        Math.abs(playerX - lane.centerX) * 1.15 +
        Math.abs(botX - lane.centerX) * 0.35 +
        Math.random() * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = lane;
      }
    }
    this.lane = best;
  }

  _inLane(x, z, lane) {
    return (
      Math.abs(x - lane.centerX) <= lane.halfWidth * 1.8 &&
      z >= lane.zMin - 1 &&
      z <= lane.zMax + 1
    );
  }

  /**
   * Next march point: forward along the lane toward the player, centred with jitter.
   */
  rollWaypoint(botX, botZ, playerX, playerZ) {
    if (!this.lane) {
      this.waypoint.x = playerX;
      this.waypoint.z = playerZ;
      return;
    }

    const lane = this.lane;
    const signZ = playerZ >= botZ ? 1 : playerZ < botZ ? -1 : (this.botIndex % 2 ? 1 : -1);
    const seg   = 4.5 + Math.random() * 6.5;

    let z = botZ + signZ * seg;
    z = Math.max(lane.zMin + 0.8, Math.min(lane.zMax - 0.8, z));

    if (Math.abs(playerZ - botZ) < seg + 1.5) {
      z = playerZ + (Math.random() - 0.5) * 2;
      z = Math.max(lane.zMin + 0.8, Math.min(lane.zMax - 0.8, z));
    }

    const jitterX = (Math.random() - 0.5) * lane.halfWidth * 0.85;
    let x = lane.centerX + jitterX;

    if (!this.map.isWall(x, z)) {
      this.waypoint.x = x;
      this.waypoint.z = z;
      return;
    }

    for (let i = 0; i < 8; i++) {
      const jx = lane.centerX + (Math.random() - 0.5) * lane.halfWidth;
      const jz = z + (Math.random() - 0.5) * 3;
      if (!this.map.isWall(jx, jz)) {
        this.waypoint.x = jx;
        this.waypoint.z = jz;
        return;
      }
    }

    this.waypoint.x = lane.centerX;
    this.waypoint.z = z;
  }
}
