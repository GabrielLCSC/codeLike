// ═══════════════════════════════════════════════════════════
//  WARFRONT — Host-authoritative bot (AI + body)
// ═══════════════════════════════════════════════════════════

import { BOT_SPEED } from '../config.js';
import { BotBrain } from './brain.js';
import { BotLocomotion } from './locomotion.js';
import { BotSoldierEntity } from './soldier-entity.js';

const DEFAULT_SKILL = { label: 'CORPORAL', hitBase: 0.35 };

/**
 * Full bot for solo / multiplayer host.
 * Behavior: chase player (A* around walls) → shoot when line-of-sight opens.
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

    this.speed = BOT_SPEED + (Math.random() - 0.5) * 0.25;

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

    const bx     = this.loco.x;
    const bz     = this.loco.z;
    const hasLOS = this.map.hasLOS(bx, bz, playerPos.x, playerPos.z);
    const ctx    = this.brain.tick(bx, bz, playerPos.x, playerPos.z, hasLOS, delta);

    this.entity.phase = this.brain.phase;
    this.loco.turnToward(ctx.aimX, ctx.aimZ, delta, ctx.mode === 'fight');

    if (ctx.mode === 'fight') {
      const shot = this.brain.tryShoot(nowMs, ctx.dist, delta);
      if (shot.playShot) {
        this._playSound('ar_shoot', { volume: 0.78, maxDist: 35 });
        this._onShoot?.();
        this.entity.playRecoil();
      }
      if (shot.fire && shot.damage > 0) {
        onHitPlayer(shot.damage, `Bot-${this.index + 1}`);
      }
    } else {
      const { moved, pathIdx } = this.loco.stepAlongPath(
        this.brain.path,
        this.brain.pathIdx,
        delta,
        this.speed,
      );
      this.brain.pathIdx = pathIdx;

      if (moved) {
        this._emitFootstep(delta, true);
      } else if (this.loco.stuckTime > 0.35) {
        this.brain.replanTimer = 0;
        this.loco.stuckTime = 0;
      }
    }

    this.entity.updateAnimation(delta, true);
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
        this.brain.reset();
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
