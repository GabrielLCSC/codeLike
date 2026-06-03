// ═══════════════════════════════════════════════════════════
//  WARFRONT — Bot AI (patrol → chase → attack)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import {
  CELL_SIZE, WALL_HEIGHT,
  BOT_HEALTH, BOT_SPEED, BOT_DETECT_RANGE, BOT_ATTACK_RANGE,
  BOT_DAMAGE, BOT_SHOOT_MIN, BOT_SHOOT_JITTER, BOT_RESPAWN_MS,
} from './config.js';

export class Bot {
  /**
   * @param {THREE.Scene} scene
   * @param {{ x:number, z:number }} spawnPos  — world-space spawn
   * @param {import('./mapgen.js').MapGenerator} map
   * @param {number} index  — used for staggered behaviour
   */
  constructor(scene, spawnPos, map, index = 0) {
    this.scene    = scene;
    this.map      = map;
    this.spawnPos = { ...spawnPos };
    this.index    = index;

    this.health    = BOT_HEALTH;
    this.maxHealth = BOT_HEALTH;
    this.alive     = true;

    this.state     = 'patrol'; // 'patrol' | 'chase' | 'attack'
    this.speed     = BOT_SPEED + (Math.random() - 0.5) * 0.6;

    this.waypointTarget = null;
    this.waypointTimer  = index * 800; // stagger first waypoint

    this.lastShotMs  = -9999;
    this.shootEvery  = BOT_SHOOT_MIN + Math.random() * BOT_SHOOT_JITTER;

    this.mesh = this._createMesh();
    this.mesh.position.set(spawnPos.x, 0, spawnPos.z);
    scene.add(this.mesh);

    // Materials stored separately for hit-flash effect
    this._mats = [];
    this.mesh.traverse(c => {
      if (c.isMesh) this._mats.push(c.material);
    });
    this._flashTimer = null;
  }

  // ─── UPDATE (called every frame) ─────────────────────────
  /**
   * @param {number}             delta      — seconds since last frame
   * @param {number}             nowMs      — performance.now()
   * @param {THREE.Vector3}      playerPos  — camera position
   * @param {function(number,string):void} onHitPlayer — callback(damage, botName)
   */
  update(delta, nowMs, playerPos, onHitPlayer) {
    if (!this.alive) return;

    const px = playerPos.x;
    const pz = playerPos.z;
    const bx = this.mesh.position.x;
    const bz = this.mesh.position.z;
    const dist = Math.hypot(px - bx, pz - bz);
    const hasLOS = this.map.hasLOS(bx, bz, px, pz);

    // ── State machine ──────────────────────────────────────
    if (dist < BOT_ATTACK_RANGE && hasLOS) {
      this.state = 'attack';
    } else if (dist < BOT_DETECT_RANGE && hasLOS) {
      this.state = 'chase';
    } else if (this.state !== 'patrol') {
      // Lost sight — keep chasing briefly, then patrol
      if (dist > BOT_DETECT_RANGE * 1.4) this.state = 'patrol';
    }

    // ── Behaviours ─────────────────────────────────────────
    if (this.state === 'attack') {
      this._facePoint(px, pz);
      // Shoot
      if (nowMs - this.lastShotMs > this.shootEvery) {
        this.lastShotMs = nowMs;
        this.shootEvery = BOT_SHOOT_MIN + Math.random() * BOT_SHOOT_JITTER;
        const hitChance = dist < 5 ? 0.62 : dist < 8 ? 0.40 : 0.22;
        if (Math.random() < hitChance) {
          onHitPlayer(BOT_DAMAGE, `Bot-${this.index + 1}`);
        }
      }
    } else if (this.state === 'chase') {
      this._moveToward(px, pz, delta, this.speed);
    } else {
      // Patrol
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
      }
    }
  }

  /** Apply damage; returns true if this hit killed the bot. */
  takeDamage(amount) {
    if (!this.alive) return false;
    this.health -= amount;
    this._flashHit();
    if (this.health <= 0) {
      this._die();
      return true;
    }
    return false;
  }

  // ─── PRIVATE HELPERS ─────────────────────────────────────
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
    const cx = Math.floor(this.mesh.position.x / CELL_SIZE);
    const cz = Math.floor(this.mesh.position.z / CELL_SIZE);
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
    // No valid waypoint found: wait
    this.waypointTimer = 1500;
  }

  _flashHit() {
    this._mats.forEach(m => { m.emissive?.set(0xaa0000); });
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      this._mats.forEach(m => { m.emissive?.set(0x000000); });
    }, 120);
  }

  _die() {
    this.alive = false;
    this.mesh.visible = false;

    // Leave a flat corpse at the death position
    const mat = new THREE.MeshLambertMaterial({ color: 0xaa1111, transparent: true, opacity: 1 });
    const corpse = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 1.50), mat);
    corpse.position.set(this.mesh.position.x, 0.09, this.mesh.position.z);
    corpse.rotation.y = this.mesh.rotation.y;
    this.scene.add(corpse);

    // Fade corpse out (starts at 5 s, gone by 8 s)
    let t = 0;
    const iv = setInterval(() => {
      t += 0.1;
      if (t > 5) mat.opacity = Math.max(0, 1 - (t - 5) / 3);
      if (t >= 8) { clearInterval(iv); this.scene.remove(corpse); mat.dispose(); }
    }, 100);

    // Respawn bot
    setTimeout(() => {
      this.health = this.maxHealth;
      this.alive  = true;
      this.state  = 'patrol';
      this._mats.forEach(m => { m.emissive?.set(0x000000); });

      const sp   = this.map.spawnPoints;
      const pick = sp[Math.floor(Math.random() * sp.length)];
      this.mesh.position.set(pick.x, 0, pick.z);
      this.mesh.rotation.set(0, 0, 0);
      this.mesh.visible = true;
    }, BOT_RESPAWN_MS);
  }

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

    // Tactical vest layer
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.50, 0.33), gearMat);
    vest.position.y = 0.95;
    group.add(vest);

    // Legs
    for (const side of [-0.13, 0.13]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.55, 0.22), bodyMat);
      leg.position.set(side, 0.35, 0);
      group.add(leg);
    }

    // Arms
    for (const side of [-0.37, 0.37]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.50, 0.16), bodyMat);
      arm.position.set(side, 0.90, 0);
      group.add(arm);
    }

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

    // Gun — positive Z = forward (toward the player the bot faces)
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.35), gunMat);
    gun.position.set(0.28, 1.10, 0.22);
    group.add(gun);

    // Name label (canvas texture, always facing camera)
    const nameCanvas = document.createElement('canvas');
    nameCanvas.width = 256; nameCanvas.height = 48;
    const nc = nameCanvas.getContext('2d');
    nc.font = 'bold 22px "Rajdhani", sans-serif';
    nc.fillStyle = '#ff8888';
    nc.textAlign = 'center';
    nc.shadowColor = 'rgba(0,0,0,0.8)'; nc.shadowBlur = 6;
    nc.fillText(`BOT-${this.index + 1}`, 128, 34);
    const nameTex = new THREE.CanvasTexture(nameCanvas);
    const nameSprite = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.19),
      new THREE.MeshBasicMaterial({ map: nameTex, transparent: true, depthTest: false, side: THREE.DoubleSide })
    );
    nameSprite.name = 'nameSprite';
    nameSprite.position.y = 2.28;
    group.add(nameSprite);

    // Health bar (sprite) — simple plane above head
    const barBg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x330000, depthTest: false })
    );
    barBg.position.y = 2.1;
    barBg.rotation.y = 0;
    group.add(barBg);

    this._healthBar = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x00ff44, depthTest: false })
    );
    this._healthBar.position.set(-0, 2.1, 0.001);
    group.add(this._healthBar);

    return group;
  }

  /** Call each frame to keep health bar and name label facing the camera */
  updateHealthBar(camera) {
    if (!this._healthBar) return;
    if (this.alive) {
      const ratio = Math.max(0, this.health / this.maxHealth);
      this._healthBar.scale.x = ratio;
      this._healthBar.position.x = (ratio - 1) * 0.25;
    }
    // Billboard all name/health sprites toward camera
    this.mesh.traverse(c => {
      if (c.isMesh && c.material?.depthTest === false) c.lookAt(camera.position);
    });
  }
}
