// ═══════════════════════════════════════════════════════════
//  WARFRONT — Bot tactical brain (targeting, combat decisions)
// ═══════════════════════════════════════════════════════════

import {
  BOT_ATTACK_RANGE,
  BOT_PLAYER_TRACK_INTERVAL,
  BOT_SHOOT_MIN,
  BOT_SHOOT_JITTER,
  BOT_STRAFES,
  BOT_DAMAGE,
} from '../config.js';
import { LaneMarch } from './lane-march.js';

/** @typedef {'advance'|'engage'} BotPhase */

/**
 * Handles perception sampling, phase transitions, and combat rolls.
 */
export class BotBrain {
  /**
   * @param {number} index — bot slot (spreads flank offsets)
   * @param {{ hitBase: number }} skill — difficulty accuracy only
   */
  /**
   * @param {number} index
   * @param {{ hitBase: number }} skill
   * @param {import('../mapgen.js').MapGenerator} map
   */
  constructor(index, skill, map) {
    this.index    = index;
    this.hitBase  = skill.hitBase ?? 0.35;
    this.phase    = /** @type {BotPhase} */ ('advance');

    this.laneMarch  = new LaneMarch(map, index);
    this.target     = { x: 0, z: 0 };
    this.trackTimer = (index * BOT_PLAYER_TRACK_INTERVAL) / 8;

    this.lastShotMs  = -9999;
    this.shootGap    = BOT_SHOOT_MIN + Math.random() * BOT_SHOOT_JITTER;
    this.burstLeft    = 0;
    this.burstPauseMs = 0;

    this.strafeDir   = Math.random() > 0.5 ? 1 : -1;
    this.strafeTimer = 1.2 + Math.random();
  }

  resetTracking() {
    this.trackTimer = 0;
    this.laneMarch.lane = null;
  }

  /** Advance target: lane-centred waypoint, not direct beeline to player. */
  _refreshAdvanceTarget(botX, botZ, playerX, playerZ) {
    this.laneMarch.ensureLane(botX, botZ, playerX, playerZ);
    this.laneMarch.rollWaypoint(botX, botZ, playerX, playerZ);
    this.target.x = this.laneMarch.waypoint.x;
    this.target.z = this.laneMarch.waypoint.z;
  }

  /**
   * @param {THREE.Vector3} playerPos
   * @param {number} botX
   * @param {number} botZ
   * @param {boolean} hasLOS
   * @param {number} delta
   */
  perceive(playerPos, botX, botZ, hasLOS, delta) {
    this.trackTimer -= delta;
    if (this.phase === 'advance' && this.trackTimer <= 0) {
      this.trackTimer = BOT_PLAYER_TRACK_INTERVAL;
      this._refreshAdvanceTarget(botX, botZ, playerPos.x, playerPos.z);
    }

    const dist = Math.hypot(playerPos.x - botX, playerPos.z - botZ);
    const leave = BOT_ATTACK_RANGE * 1.1;

    if (this.phase === 'engage') {
      if (dist > leave || !hasLOS) {
        this.phase = 'advance';
        this.trackTimer = 0;
      }
    } else if (dist <= BOT_ATTACK_RANGE && hasLOS) {
      this.phase = 'engage';
      this.strafeDir   = Math.random() > 0.5 ? 1 : -1;
      this.strafeTimer = 0.8 + Math.random() * 1.2;
      this.burstLeft   = 2 + Math.floor(Math.random() * 4);
    } else {
      this.phase = 'advance';
    }

    return { dist, hasLOS, aimX: playerPos.x, aimZ: playerPos.z };
  }

  /** @returns {{ fire: boolean, damage: number, playShot: boolean }} */
  tryShoot(nowMs, dist, deltaSec) {
    if (this.phase !== 'engage') return { fire: false, damage: 0, playShot: false };

    if (this.burstPauseMs > 0) {
      this.burstPauseMs -= deltaSec * 1000;
      return { fire: false, damage: 0, playShot: false };
    }

    if (nowMs - this.lastShotMs < this.shootGap) {
      return { fire: false, damage: 0, playShot: false };
    }

    this.lastShotMs = nowMs;
    this.shootGap    = BOT_SHOOT_MIN + Math.random() * BOT_SHOOT_JITTER;
    this.burstLeft  -= 1;
    if (this.burstLeft <= 0) {
      this.burstPauseMs = 400 + Math.random() * 600;
      this.burstLeft    = 2 + Math.floor(Math.random() * 3);
    }

    const distMul = dist < 6 ? 1 : dist < 14 ? 0.7 : 0.4;
    const hit     = Math.random() < this.hitBase * distMul;

    return {
      fire:     hit,
      damage:   hit ? BOT_DAMAGE : 0,
      playShot: true,
    };
  }

  /** Strafe step vector in world XZ (metres this frame). */
  strafeStep(delta, speed, rotY) {
    if (!BOT_STRAFES || this.phase !== 'engage') return null;

    this.strafeTimer -= delta;
    if (this.strafeTimer <= 0) {
      this.strafeDir   = -this.strafeDir;
      this.strafeTimer = 1.2 + Math.random() * 1.6;
    }

    const perp = rotY + Math.PI / 2;
    const s    = speed * 0.42 * this.strafeDir * delta;
    return { dx: Math.sin(perp) * s, dz: Math.cos(perp) * s };
  }

  /** Optional micro-reposition when hugging the player. */
  retreatStep(dist, delta, speed, rotY) {
    if (this.phase !== 'engage' || dist > 5) return null;
    const back = speed * 0.35 * delta;
    return { dx: -Math.sin(rotY) * back, dz: -Math.cos(rotY) * back };
  }
}
