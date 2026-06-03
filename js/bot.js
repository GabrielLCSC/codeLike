// ═══════════════════════════════════════════════════════════
//  WARFRONT — Bot AI  (patrol → chase → attack / cover)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import {
  CELL_SIZE,
  BOT_HEALTH, BOT_DAMAGE, BOT_RESPAWN_MS,
} from './config.js';

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
  constructor(scene, spawnPos, map, index = 0, cfg = DEFAULT_CFG, onSound = null) {
    this.scene    = scene;
    this.map      = map;
    this.spawnPos = { ...spawnPos };
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

    // Collect all materials for the hit-flash effect
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
    const mat    = new THREE.MeshLambertMaterial({ color: 0xaa1111, transparent: true, opacity: 1 });
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

      const sp   = this.map.spawnPoints;
      const pick = sp[Math.floor(Math.random() * sp.length)];
      this.mesh.position.set(pick.x, 0, pick.z);
      this.mesh.rotation.set(0, 0, 0);
      if (this._limbs) {
        Object.values(this._limbs).forEach(l => { l.rotation.x = 0; });
      }
      this._animPhase = 0;
      this.mesh.visible = true;
    }, BOT_RESPAWN_MS);
  }

  // ─── ANIMATION ────────────────────────────────────────────

  _animate(delta) {
    const L = this._limbs;
    if (!L) return;

    if (this.state === 'attack') {
      // Aiming pose: both arms raised forward
      L.leftArm.rotation.x  = THREE.MathUtils.lerp(L.leftArm.rotation.x,  -0.65, 0.12);
      L.rightArm.rotation.x = THREE.MathUtils.lerp(L.rightArm.rotation.x, -0.65, 0.12);
      L.leftLeg.rotation.x  = THREE.MathUtils.lerp(L.leftLeg.rotation.x,    0,   0.12);
      L.rightLeg.rotation.x = THREE.MathUtils.lerp(L.rightLeg.rotation.x,   0,   0.12);
    } else {
      // Walk / run gait — cover and chase share the running frequency
      const isRunning = (this.state === 'chase' || this.state === 'cover');
      const freq = isRunning ? 10   : 5.5;
      const amp  = isRunning ? 0.68 : 0.42;
      this._animPhase += delta * freq;
      const swing = Math.sin(this._animPhase);
      L.leftArm.rotation.x  =  swing * amp;
      L.rightArm.rotation.x = -swing * amp;
      L.leftLeg.rotation.x  = -swing * amp * 0.85;
      L.rightLeg.rotation.x =  swing * amp * 0.85;
    }
  }

  // ─── MESH CONSTRUCTION ────────────────────────────────────

  _createMesh() {
    const group = new THREE.Group();

    const bodyMat   = new THREE.MeshLambertMaterial({ color: 0xaa1111 });
    const headMat   = new THREE.MeshLambertMaterial({ color: 0xc8865a });
    const helmetMat = new THREE.MeshLambertMaterial({ color: 0x2a2a18 });
    const gearMat   = new THREE.MeshLambertMaterial({ color: 0x1a2810 });
    const gunMat    = new THREE.MeshLambertMaterial({ color: 0x111111 });

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.65, 0.30), bodyMat);
    torso.position.y = 0.90;
    group.add(torso);

    // Tactical vest
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.50, 0.33), gearMat);
    vest.position.y = 0.95;
    group.add(vest);

    // Legs
    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.55, 0.22), bodyMat);
    leftLeg.position.set(-0.13, 0.35, 0);
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.55, 0.22), bodyMat);
    rightLeg.position.set(0.13, 0.35, 0);
    group.add(rightLeg);

    // Arms
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.50, 0.16), bodyMat);
    leftArm.position.set(-0.37, 0.90, 0);
    group.add(leftArm);

    const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.50, 0.16), bodyMat);
    rightArm.position.set(0.37, 0.90, 0);
    group.add(rightArm);

    // Store limb refs for animation
    this._limbs     = { leftArm, rightArm, leftLeg, rightLeg };
    this._animPhase = 0;

    // Neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.13, 0.16, 8), headMat);
    neck.position.y = 1.30;
    group.add(neck);

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.30), headMat);
    head.position.y = 1.52;
    group.add(head);

    // Helmet
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.34), helmetMat);
    helmet.position.y = 1.67;
    group.add(helmet);

    // Gun (positive Z = forward, visible from front)
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.35), gunMat);
    gun.position.set(0.28, 1.10, 0.22);
    group.add(gun);

    // Name label (canvas sprite, billboarded each frame)
    const nameCanvas = document.createElement('canvas');
    nameCanvas.width = 256; nameCanvas.height = 48;
    const nc = nameCanvas.getContext('2d');
    nc.font      = 'bold 22px "Rajdhani", sans-serif';
    nc.fillStyle = '#ff8888';
    nc.textAlign = 'center';
    nc.shadowColor = 'rgba(0,0,0,0.8)';
    nc.shadowBlur  = 6;
    nc.fillText(`BOT-${this.index + 1}`, 128, 34);
    const nameTex = new THREE.CanvasTexture(nameCanvas);
    const nameSprite = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.19),
      new THREE.MeshBasicMaterial({ map: nameTex, transparent: true, depthTest: false, side: THREE.DoubleSide })
    );
    nameSprite.name       = 'nameSprite';
    nameSprite.position.y = 2.28;
    group.add(nameSprite);

    // Health bar background
    const barBg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x330000, depthTest: false })
    );
    barBg.position.y = 2.1;
    group.add(barBg);

    this._healthBar = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x00ff44, depthTest: false })
    );
    this._healthBar.position.set(0, 2.1, 0.001);
    group.add(this._healthBar);

    return group;
  }

  /** Call each frame to keep health bar and name label facing the camera. */
  updateHealthBar(camera) {
    if (!this._healthBar) return;
    if (this.alive) {
      const ratio = Math.max(0, this.health / this.maxHealth);
      this._healthBar.scale.x    = ratio;
      this._healthBar.position.x = (ratio - 1) * 0.25;
    }
    this.mesh.traverse(c => {
      if (c.isMesh && c.material?.depthTest === false) c.lookAt(camera.position);
    });
  }
}
