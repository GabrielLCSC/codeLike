// ═══════════════════════════════════════════════════════════
//  WARFRONT — Host-authoritative bot (AI + body)
// ═══════════════════════════════════════════════════════════

import {
  BOT_SPEED,
  BOT_PLAYER_TRACK_INTERVAL,
} from '../config.js';
import { BotBrain }     from './brain.js';
import { BotLocomotion } from './locomotion.js';
import { BotSoldierEntity } from './soldier-entity.js';

const DEFAULT_SKILL = { label: 'CORPORAL', hitBase: 0.35 };

/**
 * Full bot for solo / multiplayer host.
 * API unchanged for game.js compatibility.
 */
export class Bot {
  /**
   * @param {THREE.Scene} scene
   * @param {{ x:number, z:number }} spawnPos
   * @param {import('../mapgen.js').MapGenerator} map
   * @param {number} index
   * @param {{ hitBase: number }} [skill]
   * @param {function(string,THREE.Vector3,object):void} [onSound]
   * @param {number} [spawnSlot]
   * @param {function():void} [onShoot]
   */
  constructor(scene, spawnPos, map, index = 0, skill = DEFAULT_SKILL, onSound = null, spawnSlot = 0, onShoot = null) {
    this.index     = index;
    this.spawnSlot = spawnSlot;
    this.map       = map;
    this._onSound  = onSound;
    this._onShoot  = onShoot;

    this.entity = new BotSoldierEntity(scene, index, spawnPos);
    this.mesh   = this.entity.mesh;
    this.rig    = this.entity.rig;
    this.health = this.entity.health;
    this.maxHealth = this.entity.maxHealth;
    this.alive  = this.entity.alive;

    this.brain = new BotBrain(index, skill, map);
    this.loco  = new BotLocomotion(this.mesh, map, spawnPos);
    this.loco.nudgeFromSpawn();
    this.brain._refreshAdvanceTarget(spawnPos.x, spawnPos.z, spawnPos.x, spawnPos.z);
    this.brain.trackTimer = BOT_PLAYER_TRACK_INTERVAL * 0.25;

    this.speed = BOT_SPEED + (Math.random() - 0.5) * 0.25;

    /** Session scoreboard only (not persisted). */
    this.kills   = 0;
    this.deaths  = 0;
    this.assists = 0;

    this._stepTimer   = index * 0.15;
    this._lastStepIdx = -1;
    this._stepKeys    = ['footstep', 'footstep2', 'footstep3', 'footstep4'];
  }

  get state() { return this.entity.phase; }
  set state(v) { this.entity.phase = v; }

  update(delta, nowMs, playerPos, onHitPlayer) {
    if (!this.alive) return;

    const bx = this.loco.x;
    const bz = this.loco.z;
    const hasLOS = this.map.hasLOS(bx, bz, playerPos.x, playerPos.z);
    const { dist, aimX, aimZ } = this.brain.perceive(playerPos, bx, bz, hasLOS, delta);
    this.entity.phase = this.brain.phase;

    if (this.brain.phase === 'engage') {
      this._tickEngage(delta, nowMs, aimX, aimZ, dist, onHitPlayer);
    } else {
      this._tickAdvance(delta, aimX, aimZ);
    }

    this.entity.updateAnimation(delta, true);
  }

  _tickAdvance(delta, aimX, aimZ) {
    const bx = this.loco.x;
    const bz = this.loco.z;
    const tx = this.brain.target.x;
    const tz = this.brain.target.z;

    if (Math.hypot(tx - bx, tz - bz) < 1.4) {
      this.brain._refreshAdvanceTarget(bx, bz, aimX, aimZ);
    }

    const lane = this.brain.laneMarch.lane;
    const wx   = this.brain.target.x;
    const wz   = this.brain.target.z;

    if (this.loco.stepLane(wx, wz, lane, delta, this.speed)) {
      this._emitFootstep(delta, true);
    } else if (this.loco.stuckTime > 0.35) {
      this.loco.nudgeInLane(lane);
      this.brain._refreshAdvanceTarget(this.loco.x, this.loco.z, aimX, aimZ);
      this.loco.stuckTime = 0;
    }

    this.loco.turnToward(aimX, aimZ, delta, false);
  }

  _tickEngage(delta, nowMs, aimX, aimZ, dist, onHitPlayer) {
    this.loco.turnToward(aimX, aimZ, delta, true);

    const retreat = this.brain.retreatStep(dist, delta, this.speed, this.mesh.rotation.y);
    if (retreat) this.loco.tryStep(retreat.dx, retreat.dz);

    const strafe = this.brain.strafeStep(delta, this.speed, this.mesh.rotation.y);
    if (strafe && this.loco.tryStep(strafe.dx, strafe.dz)) {
      this._emitFootstep(delta, true);
    }

    const shot = this.brain.tryShoot(nowMs, dist, delta);
    if (shot.playShot) {
      this._playSound('ar_shoot', { volume: 0.78, maxDist: 35 });
      this._onShoot?.();
      this.entity.playRecoil();
    }
    if (shot.fire && shot.damage > 0) {
      onHitPlayer(shot.damage, `Bot-${this.index + 1}`);
    }
  }

  getSyncState() {
    return {
      ...this.entity.getSyncState(),
      kills:   this.kills,
      deaths:  this.deaths,
      assists: this.assists,
    };
  }

  takeDamage(amount) {
    if (!this.alive) return false;
    this.entity.health -= amount;
    this.health = this.entity.health;
    this.entity.flashHit();
    if (this.health <= 0) {
      this.alive = false;
      this.entity.die(() => {
        this.alive = this.entity.alive;
        this.health = this.entity.health;
        this.loco.nudgeFromSpawn();
        this.brain.resetTracking();
        this.loco.stuckTime = 0;
      });
      return true;
    }
    return false;
  }

  updateHealthBar(camera, map) {
    this.entity.updateHealthBar(camera, map);
  }

  _emitFootstep(delta, sprint) {
    this._stepTimer -= delta;
    if (this._stepTimer > 0) return;
    this._stepTimer = sprint ? 0.30 : 0.52;
    let idx;
    do { idx = Math.floor(Math.random() * this._stepKeys.length); }
    while (idx === this._lastStepIdx && this._stepKeys.length > 1);
    this._lastStepIdx = idx;
    this._playSound(this._stepKeys[idx], { volume: 0.88, maxDist: 24 });
  }

  _playSound(key, opts = {}) {
    this._onSound?.(key, this.mesh.position, opts);
  }
}
