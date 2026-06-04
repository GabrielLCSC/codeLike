// ═══════════════════════════════════════════════════════════
//  WARFRONT — Bot AI  (patrol → chase → attack / cover)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import {
  CELL_SIZE,
  BOT_HEALTH, BOT_DAMAGE, BOT_RESPAWN_MS,
} from './config.js';
import {
  buildCharacterMesh,
  updateCharacterAnimation,
  resetCharacterPose,
  triggerCharacterRecoil,
  updateCharacterOverheadUI,
  botStateToPose,
} from './character.js';

// Fallback config (corporal level) — used when no cfg is passed
const DEFAULT_CFG = {
  label:       'CORPORAL',
  speed:        3.2,
  detectRange:  14,
  attackRange:  11,
  hitBase:      0.35,
  shootMin:     1100,
  shootJitter:  800,
  seeksCover:   false,
  strafes:      true,
};

export class Bot {
  /**
   * @param {THREE.Scene}  scene
   * @param {{ x:number, z:number }} spawnPos  — world-space spawn
   * @param {import('./mapgen.js').MapGenerator} map
   * @param {number} index         — used for staggered behaviour
   * @param {object} [cfg]         — difficulty config from BOT_LEVELS
   * @param {function(string,THREE.Vector3,object):void} [onSound]
   *        Spatial sound callback: (soundKey, worldPos, opts) => void
   */
  constructor(scene, spawnPos, map, index = 0, cfg = DEFAULT_CFG, onSound = null, spawnSlot = 0) {
    this.scene    = scene;
    this.map      = map;
    this.spawnPos = { ...spawnPos };
    this.spawnSlot = spawnSlot;
    this.index    = index;
    this.cfg      = { ...DEFAULT_CFG, ...cfg };
    this._onSound = onSound;

    this.health    = BOT_HEALTH;
    this.maxHealth = BOT_HEALTH;
    this.alive     = true;

    // Speed jitter so bots don't move identically
    this.speed = this.cfg.speed + (Math.random() - 0.5) * 0.4;

    // State machine: 'patrol' | 'chase' | 'attack' | 'cover'
    this.state = 'patrol';

    // Patrol waypoints
    this.waypointTarget = null;
    this.waypointTimer  = index * 800;  // stagger first waypoint

    // Combat timing
    this.lastShotMs = -9999;
    this.shootEvery = this.cfg.shootMin + Math.random() * this.cfg.shootJitter;

    // Strafe state (used during 'attack')
    this._strafeDir   = Math.random() > 0.5 ? 1 : -1;
    this._strafeTimer = 1.5 + Math.random() * 2.0;

    // Cover state
    this._coverTarget = null;
    this._coverTimer  = 0;

    // Footstep rate-limiting
    this._stepTimer   = index * 0.15;  // stagger initial steps
    this._lastStepIdx = -1;
    this._stepKeys    = ['footstep', 'footstep2', 'footstep3', 'footstep4'];

    this.mesh = this._createMesh();
    this.mesh.position.set(spawnPos.x, 0, spawnPos.z);
    scene.add(this.mesh);

    this._mats = [];
    this.mesh.traverse(c => { if (c.isMesh) this._mats.push(c.material); });
    this._flashTimer = null;
  }

  // ─── PUBLIC UPDATE (called every frame) ──────────────────
  /**
   * @param {number}   delta      — seconds since last frame
   * @param {number}   nowMs      — performance.now()
   * @param {THREE.Vector3} playerPos — camera world position
   * @param {function(number,string):void} onHitPlayer — callback(damage, botName)
   */
  update(delta, nowMs, playerPos, onHitPlayer) {
    if (!this.alive) return;

    const px = playerPos.x;
    const pz = playerPos.z;
    const bx = this.mesh.position.x;
    const bz = this.mesh.position.z;
    const dist   = Math.hypot(px - bx, pz - bz);
    const hasLOS = this.map.hasLOS(bx, bz, px, pz);

    // ── State transitions (cover state self-manages exits) ──
    if (this.state !== 'cover') {
      if (dist < this.cfg.attackRange && hasLOS) {
        if (this.state !== 'attack') {
          this.state        = 'attack';
          this._strafeDir   = Math.random() > 0.5 ? 1 : -1;
          this._strafeTimer = 1.0 + Math.random() * 1.5;
        }
      } else if (dist < this.cfg.detectRange && hasLOS) {
        this.state = 'chase';
      } else if (this.state === 'attack') {
        // Lost sight while attacking — keep chasing
        this.state = 'chase';
      } else if (this.state === 'chase' && dist > this.cfg.detectRange * 1.4) {
        this.state = 'patrol';
      }
    }

    // ── Behaviour execution ─────────────────────────────────
    switch (this.state) {
      case 'attack': this._doAttack(px, pz, dist, nowMs, onHitPlayer, delta); break;
      case 'chase':  this._doChase(px, pz, delta);  break;
      case 'cover':  this._doCover(px, pz, delta);  break;
      default:       this._doPatrol(delta);          break;
    }

    this._animate(delta);
  }

  /** Apply damage. Returns true if this hit killed the bot. */
  takeDamage(amount) {
    if (!this.alive) return false;
    this.health -= amount;
    this._flashHit();

    // Seek cover when health drops low enough (if difficulty unlocks it)
    if (
      this.cfg.seeksCover &&
      this.state !== 'cover' &&
      this.health > 0 &&
      this.health < this.maxHealth * 0.55 &&
      Math.random() < 0.72
    ) {
      this.state        = 'cover';
      this._coverTarget = null;
      this._coverTimer  = 2.0 + Math.random() * 2.0;
    }

    if (this.health <= 0) {
      this._die();
      return true;
    }
    return false;
  }

  // ─── BEHAVIOUR METHODS ────────────────────────────────────

  _doAttack(px, pz, dist, nowMs, onHitPlayer, delta) {
    this._facePoint(px, pz);

    // Lateral strafe while shooting (if difficulty allows)
    if (this.cfg.strafes) {
      this._strafeTimer -= delta;
      if (this._strafeTimer <= 0) {
        this._strafeDir   = -this._strafeDir;
        this._strafeTimer = 1.5 + Math.random() * 2.0;
      }
      const perpAngle = this.mesh.rotation.y + Math.PI / 2;
      const sx = Math.sin(perpAngle) * this.speed * 0.45 * this._strafeDir * delta;
      const sz = Math.cos(perpAngle) * this.speed * 0.45 * this._strafeDir * delta;
      const bx = this.mesh.position.x;
      const bz = this.mesh.position.z;
      let nx = bx + sx, nz = bz + sz;
      if (this.map.isWallThin(nx, bz)) nx = bx;
      if (this.map.isWallThin(bx, nz)) nz = bz;
      this.mesh.position.x = nx;
      this.mesh.position.z = nz;
      this._emitFootstep(delta, true);
    }

    // Shoot
    if (nowMs - this.lastShotMs > this.shootEvery) {
      this.lastShotMs = nowMs;
      this.shootEvery = this.cfg.shootMin + Math.random() * this.cfg.shootJitter;

      // Distance-scaled accuracy
      const hitChance = this.cfg.hitBase * (dist < 5 ? 1.0 : dist < 10 ? 0.65 : 0.35);

      // Audible gunshot at bot position so player hears nearby fire
      this._playSound('ar_shoot', { volume: 0.78, maxDist: 35 });
      triggerCharacterRecoil(this.rig);

      if (Math.random() < hitChance) {
        onHitPlayer(BOT_DAMAGE, `Bot-${this.index + 1}`);
      }
    }
  }

  _doChase(px, pz, delta) {
    this._moveToward(px, pz, delta, this.speed);
    this._emitFootstep(delta, true);
  }

  _doCover(px, pz, delta) {
    const bx = this.mesh.position.x;
    const bz = this.mesh.position.z;

    // Resolve a cover destination if we don't have one yet
    if (!this._coverTarget) {
      this._coverTarget = this._findCoverPoint(px, pz);
      if (!this._coverTarget) {
        // No valid cover found — fall back to attack
        this.state = 'attack';
        return;
      }
    }

    const covDist = Math.hypot(bx - this._coverTarget.x, bz - this._coverTarget.z);

    if (covDist > 0.7) {
      // Still moving toward cover — run at 85% speed
      this._moveToward(this._coverTarget.x, this._coverTarget.z, delta, this.speed * 0.85);
      this._emitFootstep(delta, true);
    } else {
      // Crouching in cover: count down, then peek (transition to attack)
      this._coverTimer -= delta;
      if (this._coverTimer <= 0) {
        this.state        = 'attack';
        this._coverTarget = null;
        this._strafeDir   = Math.random() > 0.5 ? 1 : -1;
        this._strafeTimer = 1.0 + Math.random() * 1.5;
      }
    }
  }

  _doPatrol(delta) {
    const bx = this.mesh.position.x;
    const bz = this.mesh.position.z;

    this.waypointTimer -= delta * 1000;
    if (
      !this.waypointTarget ||
      this.waypointTimer <= 0 ||
      Math.hypot(bx - this.waypointTarget.x, bz - this.waypointTarget.z) < 0.6
    ) {
      this._pickWaypoint();
    }
    if (this.waypointTarget) {
      this._moveToward(this.waypointTarget.x, this.waypointTarget.z, delta, this.speed * 0.55);
      this._emitFootstep(delta, false);
    }
  }

  // ─── COVER HELPERS ────────────────────────────────────────

  /**
   * Sample random positions around the bot looking for a spot that:
   *  1. Is walkable (not a wall cell)
   *  2. Has NO line-of-sight to the player (good hiding spot)
   */
  _findCoverPoint(px, pz) {
    const bx = this.mesh.position.x;
    const bz = this.mesh.position.z;
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle  = Math.random() * Math.PI * 2;
      const radius = 3 + Math.random() * 7;
      const cx     = bx + Math.cos(angle) * radius;
      const cz     = bz + Math.sin(angle) * radius;
      if (this.map.isWall(cx, cz)) continue;                // must be walkable
      if (this.map.hasLOS(cx, cz, px, pz)) continue;        // must be hidden
      return { x: cx, z: cz };
    }
    return null;
  }

  // ─── MOVEMENT / NAVIGATION ────────────────────────────────

  _facePoint(tx, tz) {
    const dx = tx - this.mesh.position.x;
    const dz = tz - this.mesh.position.z;
    this.mesh.rotation.y = Math.atan2(dx, dz);
  }

  _moveToward(tx, tz, delta, speed) {
    const bx = this.mesh.position.x;
    const bz = this.mesh.position.z;
    const dx = tx - bx;
    const dz = tz - bz;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.25) return;

    const nx = dx / dist;
    const nz = dz / dist;
    let newX = bx + nx * speed * delta;
    let newZ  = bz + nz * speed * delta;

    // Sliding wall collision
    if (this.map.isWallThin(newX, bz)) newX = bx;
    if (this.map.isWallThin(bx, newZ)) newZ = bz;

    this.mesh.position.x = newX;
    this.mesh.position.z = newZ;
    this._facePoint(tx, tz);
  }

  _pickWaypoint() {
    const cx    = Math.floor(this.mesh.position.x / CELL_SIZE);
    const cz    = Math.floor(this.mesh.position.z / CELL_SIZE);
    const range = 6;

    for (let attempt = 0; attempt < 15; attempt++) {
      const rx = cx + Math.floor((Math.random() - 0.5) * range * 2);
      const rz = cz + Math.floor((Math.random() - 0.5) * range * 2);
      if (
        rx > 0 && rx < this.map.width - 1 &&
        rz > 0 && rz < this.map.height - 1 &&
        this.map.grid[rx][rz] === 1
      ) {
        this.waypointTarget = {
          x: rx * CELL_SIZE + CELL_SIZE * 0.5,
          z: rz * CELL_SIZE + CELL_SIZE * 0.5,
        };
        this.waypointTimer = 2500 + Math.random() * 3000;
        return;
      }
    }
    this.waypointTimer = 1500; // wait before retrying
  }

  // ─── SOUND HELPERS ────────────────────────────────────────

  /**
   * Rate-limited footstep sound — picks a random non-repeating variant.
   * @param {number}  delta       — seconds this frame
   * @param {boolean} isSprinting — tightens interval
   */
  _emitFootstep(delta, isSprinting) {
    this._stepTimer -= delta;
    if (this._stepTimer > 0) return;
    this._stepTimer = isSprinting ? 0.30 : 0.52;

    let idx;
    if (this._stepKeys.length === 1) {
      idx = 0;
    } else {
      do { idx = Math.floor(Math.random() * this._stepKeys.length); }
      while (idx === this._lastStepIdx);
    }
    this._lastStepIdx = idx;
    this._playSound(this._stepKeys[idx], { volume: 0.88, maxDist: 24 });
  }

  /** Forward a spatial sound to the callback registered in the constructor. */
  _playSound(key, opts = {}) {
    if (this._onSound) this._onSound(key, this.mesh.position, opts);
  }

  // ─── HIT FLASH ────────────────────────────────────────────

  _flashHit() {
    this._mats.forEach(m => { m.emissive?.set(0xaa0000); });
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      this._mats.forEach(m => { m.emissive?.set(0x000000); });
    }, 120);
  }

  // ─── DEATH & RESPAWN ──────────────────────────────────────

  _die() {
    this.alive = false;
    this.mesh.visible = false;

    // Drop a flat corpse that fades out after 5 s
    const mat    = new THREE.MeshLambertMaterial({ color: 0x3a3f38, transparent: true, opacity: 1 });
    const corpse = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 1.50), mat);
    corpse.position.set(this.mesh.position.x, 0.09, this.mesh.position.z);
    corpse.rotation.y = this.mesh.rotation.y;
    this.scene.add(corpse);

    let t = 0;
    const iv = setInterval(() => {
      t += 0.1;
      if (t > 5) mat.opacity = Math.max(0, 1 - (t - 5) / 3);
      if (t >= 8) { clearInterval(iv); this.scene.remove(corpse); mat.dispose(); }
    }, 100);

    setTimeout(() => {
      this.health = this.maxHealth;
      this.alive  = true;
      this.state  = 'patrol';
      this._mats.forEach(m => { m.emissive?.set(0x000000); });
      this._coverTarget = null;
      this._coverTimer  = 0;

      const sp   = this.spawnPos;
      this.mesh.position.set(sp.x, 0, sp.z);
      this.mesh.rotation.set(0, 0, 0);
      resetCharacterPose(this.rig);
      this.mesh.visible = true;
    }, BOT_RESPAWN_MS);
  }

  // ─── ANIMATION ────────────────────────────────────────────

  _animate(delta) {
    const bx = this.mesh.position.x;
    const bz = this.mesh.position.z;
    const atCover = this.state === 'cover' && this._coverTarget &&
      Math.hypot(bx - this._coverTarget.x, bz - this._coverTarget.z) < 0.75;
    updateCharacterAnimation(this.rig, delta, botStateToPose(this.state, atCover));
  }

  _createMesh() {
    const { mesh, rig, healthBar } = buildCharacterMesh({
      team: 'enemy',
      name: `BOT-${this.index + 1}`,
      showHealthBar: true,
    });
    this.rig         = rig;
    this._healthBar  = healthBar;
    return mesh;
  }

  /** Call each frame to keep health bar and name label facing the camera. */
  updateHealthBar(camera, map) {
    if (!this.alive) return;
    updateCharacterOverheadUI(this.mesh, camera, map, {
      healthBar: this._healthBar,
      healthRatio: this.health / this.maxHealth,
    });
  }
}
