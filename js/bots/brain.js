// ═══════════════════════════════════════════════════════════
//  WARFRONT — Bot brain (chase → fight)
// ═══════════════════════════════════════════════════════════

import {
  BOT_ATTACK_RANGE,
  BOT_SHOOT_MIN,
  BOT_SHOOT_JITTER,
  BOT_DAMAGE,
  BOT_REPLAN_INTERVAL,
  BOT_REPLAN_MOVE_SQ,
} from '../config.js';
import { GridPathfinder } from './grid-path.js';

/** @typedef {'chase'|'fight'} BotMode */

export class BotBrain {
  /**
   * @param {number} index
   * @param {{ hitBase: number }} skill
   * @param {import('../mapgen.js').MapGenerator} map
   */
  constructor(index, skill, map) {
    this.index       = index;
    this.hitBase     = skill.hitBase ?? 0.35;
    this.pathfinder  = new GridPathfinder(map);
    this.mode        = /** @type {BotMode} */ ('chase');
    /** @type {{ x:number, z:number }[]} */
    this.path        = [];
    this.pathIdx     = 0;
    this.replanTimer   = index * 0.08;
    this._lastGoalX    = null;
    this._lastGoalZ    = null;

    this.lastShotMs   = -9999;
    this.shootGap     = BOT_SHOOT_MIN + Math.random() * BOT_SHOOT_JITTER;
    this.burstLeft    = 0;
    this.burstPauseMs = 0;
  }

  /** @deprecated alias for host-bot animation sync */
  get phase() {
    return this.mode === 'fight' ? 'engage' : 'advance';
  }

  reset() {
    this.mode = 'chase';
    this.path = [];
    this.pathIdx = 0;
    this.replanTimer = 0;
    this._lastGoalX  = null;
    this._lastGoalZ  = null;
  }

  /**
   * Decide chase vs fight and keep path up to date.
   * @returns {{ mode: BotMode, dist: number, canFight: boolean, aimX: number, aimZ: number }}
   */
  tick(botX, botZ, playerX, playerZ, hasLOS, delta) {
    const dist     = Math.hypot(playerX - botX, playerZ - botZ);
    const canFight = hasLOS && dist <= BOT_ATTACK_RANGE;

    if (canFight) {
      this.mode = 'fight';
      this.path  = [];
      this.pathIdx = 0;
    } else {
      this.mode = 'chase';
      this.replanTimer -= delta;

      const goalDx = this._lastGoalX == null ? Infinity : playerX - this._lastGoalX;
      const goalDz = this._lastGoalZ == null ? Infinity : playerZ - this._lastGoalZ;
      const goalMovedSq = goalDx * goalDx + goalDz * goalDz;
      const due    = this.replanTimer <= 0;
      const moved  = this._lastGoalX == null || goalMovedSq >= BOT_REPLAN_MOVE_SQ;

      if (!this.path.length || (due && moved)) {
        this.replanTimer = BOT_REPLAN_INTERVAL + this.index * 0.08;
        this._lastGoalX   = playerX;
        this._lastGoalZ   = playerZ;
        this._replanPath(botX, botZ, playerX, playerZ);
      } else if (due) {
        this.replanTimer = BOT_REPLAN_INTERVAL * 0.5;
      }
    }

    return { mode: this.mode, dist, canFight, aimX: playerX, aimZ: playerZ };
  }

  _replanPath(botX, botZ, playerX, playerZ) {
    let goalX = playerX;
    let goalZ = playerZ;

    const peek = this.pathfinder.findNearestLosCell(botX, botZ, playerX, playerZ);
    if (peek) {
      goalX = peek.x;
      goalZ = peek.z;
    }

    const raw = this.pathfinder.findPath(botX, botZ, goalX, goalZ)
      ?? this.pathfinder.findPath(botX, botZ, playerX, playerZ);

    if (!raw?.length) {
      this.path    = [{ x: playerX, z: playerZ }];
      this.pathIdx = 0;
      return;
    }

    let start = 0;
    while (start < raw.length - 1) {
      const wp = raw[start];
      if (Math.hypot(wp.x - botX, wp.z - botZ) > 1) break;
      start++;
    }

    this.path    = raw.slice(start);
    this.pathIdx = 0;
  }

  /** @returns {{ fire: boolean, damage: number, playShot: boolean }} */
  tryShoot(nowMs, dist, deltaSec) {
    if (this.mode !== 'fight') {
      return { fire: false, damage: 0, playShot: false };
    }

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
}
