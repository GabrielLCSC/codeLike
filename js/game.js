// ═══════════════════════════════════════════════════════════
//  WARFRONT — Game (orchestrator)
//  Owns: Three.js renderer/scene/camera, player physics,
//        combat, bot + remote-player coordination, input.
//  Delegates to: HUD, WeaponSystem, ParticleSystem.
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import {
  PLAYER_HEIGHT, PLAYER_SPEED, SPRINT_MULT,
  GRAVITY, JUMP_FORCE,
  REGEN_DELAY, REGEN_RATE, RESPAWN_TIME,
  HEADSHOT_MULT, WEAPONS, BOT_COUNT, SYNC_INTERVAL,
} from './config.js';
import { MapGenerator }  from './mapgen.js';
import { Bot }           from './bot.js';
import { sound }         from './sound.js';
import { HUD }           from './hud.js';
import { WeaponSystem }  from './weapon.js';
import { ParticleSystem } from './particles.js';

export class Game {
  /**
   * @param {{
   *   mode:        'solo'|'multi',
   *   weapon:      string,
   *   sensitivity: number,
   *   fov:         number,
   *   adsMode:     'toggle'|'hold',
   *   username:    string,
   *   botCount?:   number,
   *   mp?:         import('./multiplayer.js').MultiplayerManager,
   * }} opts
   */
  constructor(opts) {
    this.opts     = opts;
    this.mode     = opts.mode;
    this.mp       = opts.mp || null;
    this.username = opts.username || 'Ghost';

    // ── Three.js ──────────────────────────────────────────
    /** @type {THREE.WebGLRenderer}      */ this.renderer = null;
    /** @type {THREE.Scene}              */ this.scene    = null;
    /** @type {THREE.PerspectiveCamera}  */ this.camera   = null;
    /** @type {PointerLockControls}      */ this.controls = null;
    /** @type {MapGenerator}             */ this.map      = null;

    // ── Player state ──────────────────────────────────────
    this.running = false;
    this.alive   = true;
    this.health  = 100;
    this.kills   = 0;
    this.deaths  = 0;

    // ── Physics ───────────────────────────────────────────
    this.velY      = 0;
    this.onGround  = true;
    this.isMoving  = false;
    this._airVelX  = 0;   // horizontal momentum locked at jump takeoff
    this._airVelZ  = 0;

    // ── Combat ────────────────────────────────────────────
    this._hitShake     = 0;   // 0–1, camera jitter when hit
    this._killStreak   = 0;   // resets on death; drives kill-confirm pitch
    /** @type {Set<string>} UIDs we've shot recently (multiplayer kill confirm) */
    this._recentlyShot = new Set();

    // ── Timing ────────────────────────────────────────────
    this.lastFrameMs      = performance.now();
    this.lastDamageMs     = -9999;
    this.lastSyncMs       = -9999;
    this.damageFlashTimer = 0;

    // ── Scene objects ─────────────────────────────────────
    /** @type {Bot[]} */ this.bots = [];
    /** @type {Map<string,{mesh:THREE.Group, data:object, targetPos:THREE.Vector3, targetRotY:number}>} */
    this.remotePlayers = new Map();

    // ── Systems (created in start()) ──────────────────────
    /** @type {HUD}            */ this.hud       = null;
    /** @type {WeaponSystem}   */ this.weapon    = null;
    /** @type {ParticleSystem} */ this.particles = null;

    // ── Input ─────────────────────────────────────────────
    this.keys      = new Set();
    this.mouseDown = false;

    // Raycaster shared across all shots
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 80;

    // Bound handlers stored for clean removal
    this._onKeyDown  = this._handleKeyDown.bind(this);
    this._onKeyUp    = this._handleKeyUp.bind(this);
    this._onMouseDn  = this._handleMouseDown.bind(this);
    this._onMouseUp  = this._handleMouseUp.bind(this);
    this._onCtxMenu  = e => e.preventDefault();
    this._onResize   = this._handleResize.bind(this);
  }

  // ═══════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════

  start() {
    this._initRenderer();
    this._initScene();
    this._initMap();
    this._initPlayer();
    this._initSystems();
    this._bindInput();

    if ((this.opts.botCount ?? 0) > 0) this._spawnBots(this.opts.botCount);
    if (this.mp)              this._setupMultiplayer();

    this.hud.show();
    document.getElementById('pointer-lock-overlay').classList.remove('hidden');
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
    this.controls?.unlock();
    this._unbindInput();
    this.bots.forEach(b => this.scene?.remove(b.mesh));
    this.remotePlayers.forEach(({ mesh }) => this.scene?.remove(mesh));
    this.particles?.dispose();
    this.renderer?.dispose();
    this.scene = null;
    this.mp?.leave();
    this.hud?.hide();

    document.getElementById('pointer-lock-overlay').classList.add('hidden');
    document.getElementById('death-screen').classList.add('hidden');
    document.getElementById('scope-overlay').classList.add('hidden');
    document.getElementById('crosshair').classList.remove('hidden');
  }

  /** Called from in-game pause panel. */
  changeWeapon(key) {
    this.weapon.equip(key);     // equip() calls setADS(false) internally
    this._applyADSState(false);
  }

  /** Called from in-game pause panel. */
  setSensitivity(value) {
    this.opts.sensitivity = value;
    if (this.controls) this.controls.pointerSpeed = value * 0.42;
  }

  // ═══════════════════════════════════════════════════════
  //  INIT HELPERS
  // ═══════════════════════════════════════════════════════

  _initRenderer() {
    const canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    window.addEventListener('resize', this._onResize);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog        = new THREE.FogExp2(0x12121c, 0.022);
    this.scene.background = new THREE.Color(0x08080f);
    this.camera = new THREE.PerspectiveCamera(
      this.opts.fov,
      window.innerWidth / window.innerHeight,
      0.08, 120,
    );
  }

  _initMap() {
    this.map = new MapGenerator().generate();
    this.map.buildScene(this.scene);
  }

  _initPlayer() {
    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.controls.pointerSpeed = this.opts.sensitivity * 0.42;
    this.scene.add(this.camera);

    const sp   = this.map.spawnPoints;
    const pick = sp[Math.floor(Math.random() * sp.length)];
    this.camera.position.set(pick.x, PLAYER_HEIGHT, pick.z);

    const plo = document.getElementById('pointer-lock-overlay');
    plo.addEventListener('click', () => {
      if (this.alive && this.running) this.controls.lock();
    }, { capture: true });

    this.controls.addEventListener('lock', () => {
      plo.classList.add('hidden');
      const title = document.getElementById('plo-title');
      if (title) title.textContent = 'PAUSED';
      sound.init();
    });
    this.controls.addEventListener('unlock', () => {
      if (this.alive && this.running) plo.classList.remove('hidden');
    });

    setTimeout(() => this.controls.lock(), 200);
  }

  _initSystems() {
    // HUD
    this.hud = new HUD(
      this.username,
      this.mode === 'multi' && this.mp ? this.mp.roomCode : '',
    );
    this.hud.setHealth(this.health);
    this.hud.setScore(this.kills, this.deaths);

    // WeaponSystem — wire callbacks so it drives HUD updates
    this.weapon = new WeaponSystem(
      this.camera, this.opts.weapon, this.opts.fov, this.opts.adsMode,
    );
    this.weapon.onAmmoChanged    = () => this.hud.setAmmo(this.weapon.ammo, this.weapon.reserve);
    this.weapon.onWeaponChanged  = name => this.hud.setAmmo(this.weapon.ammo, this.weapon.reserve, name);
    this.weapon.onReloadStart    = () => this.hud.showReloadBar(this.weapon.def.reloadTime);
    this.weapon.onReloadComplete = () => this.hud.hideReloadBar();
    this.hud.setAmmo(this.weapon.ammo, this.weapon.reserve, this.weapon.def.name);

    // Particles
    this.particles = new ParticleSystem(this.scene);
  }

  _spawnBots(count) {
    const sp = this.map.spawnPoints;
    for (let i = 0; i < count; i++) {
      this.bots.push(new Bot(this.scene, sp[(i + 1) % sp.length], this.map, i));
    }
  }

  _setupMultiplayer() {
    this.mp.onPlayerUpdate = (uid, data) => {
      if (this.remotePlayers.has(uid)) {
        const rp = this.remotePlayers.get(uid);

        // Snapshot previous alive state THEN update immediately.
        // This ensures any re-delivery of the same Firebase event (caused by
        // concurrent writes, e.g. updateKills) sees rp.data.alive = false and
        // skips the kill block — preventing the kill from counting multiple times.
        const wasAlive = rp.data.alive;
        rp.data       = data;
        rp.targetPos.set(data.x, 0, data.z);
        rp.targetRotY = data.rotY ?? 0;
        rp.mesh.visible = !!data.alive;

        if (wasAlive && !data.alive) {
          // Drop a corpse at last known position
          const corpse = this._makeCorpse(rp.mesh.position, rp.mesh.rotation.y, 0x0055cc);
          this.scene.add(corpse);
          this._fadeAndRemove(corpse, 5, 8);

          if (this._recentlyShot.has(uid)) {
            this._recentlyShot.delete(uid); // clear before _onKill to avoid re-entry
            this._onKill(data.name ?? 'Player');
          }
        }
      } else {
        const { mesh, limbs } = this._buildRemotePlayerMesh(data.name ?? 'Player');
        mesh.position.set(data.x ?? 0, 0, data.z ?? 0);
        this.scene.add(mesh);
        this.remotePlayers.set(uid, {
          mesh,
          limbs,
          data,
          targetPos:  new THREE.Vector3(data.x ?? 0, 0, data.z ?? 0),
          targetRotY: data.rotY ?? 0,
          animPhase:  0,
          prevPos:    new THREE.Vector3(data.x ?? 0, 0, data.z ?? 0),
        });
      }
    };

    this.mp.onPlayerRemoved = uid => {
      const rp = this.remotePlayers.get(uid);
      if (rp) { this.scene.remove(rp.mesh); this.remotePlayers.delete(uid); }
    };

    this.mp.onHitReceived = evt => {
      const killerName = this.mp.players.get(evt.shooter)?.name ?? 'Player';
      this.takeDamage(evt.damage, killerName);
    };
  }

  // ═══════════════════════════════════════════════════════
  //  MAIN LOOP
  // ═══════════════════════════════════════════════════════

  _loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this._loop());

    const nowMs = performance.now();
    const delta = Math.min((nowMs - this.lastFrameMs) / 1000, 0.1);
    this.lastFrameMs = nowMs;

    this._update(delta, nowMs);
    this.renderer.render(this.scene, this.camera);
  }

  _update(delta, nowMs) {
    if (!this.alive) return;

    // Auto fire
    if (this.mouseDown && this.weapon.def.automatic && this.controls.isLocked) {
      this._tryShoot(nowMs);
    }

    this._updateMovement(delta);
    this._updatePhysics(delta);
    this._updateRegen(delta, nowMs);
    this._updateHitShake(delta);

    // Weapon system — receives isMoving for bob, mouseDown for recoil recovery gate
    this.weapon.setHitShake(this._hitShake);
    this.weapon.update(delta, this.isMoving, this.mouseDown);

    this._updateBots(delta, nowMs);
    this._updateRemotePlayers(delta);
    this.particles.update(delta);

    // Firebase position sync (rate-limited)
    if (this.mp && nowMs - this.lastSyncMs > SYNC_INTERVAL) {
      this.lastSyncMs = nowMs;
      const pos = this.camera.position;
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.mp.updatePosition(pos.x, pos.y, pos.z, Math.atan2(dir.x, dir.z));
    }

    // Damage vignette fade-out
    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer -= delta;
      if (this.damageFlashTimer <= 0) this.hud.hideDamageVignette();
    }

    // Minimap — flatten Three.js objects to plain data
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.hud.updateMinimap(
      { grid: this.map.grid, width: this.map.width, height: this.map.height },
      { x: this.camera.position.x, z: this.camera.position.z, dirX: dir.x, dirZ: dir.z },
      this.bots.map(b => ({ x: b.mesh.position.x, z: b.mesh.position.z, alive: b.alive })),
      [...this.remotePlayers.values()].map(rp => ({
        x: rp.mesh.position.x, z: rp.mesh.position.z, alive: rp.mesh.visible,
      })),
    );
  }

  // ═══════════════════════════════════════════════════════
  //  MOVEMENT & PHYSICS
  // ═══════════════════════════════════════════════════════

  _updateMovement(delta) {
    if (!this.controls.isLocked) return;

    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const spd    = PLAYER_SPEED
      * (sprint ? SPRINT_MULT : 1)
      * (this.weapon.isADS ? 0.55 : 1);

    // AZERTY: KeyW = physical Z key, KeyA = physical Q key
    const fwd = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const rgt = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);

    const fwdVec = new THREE.Vector3();
    this.camera.getWorldDirection(fwdVec);
    fwdVec.y = 0; fwdVec.normalize();

    const rgtVec = new THREE.Vector3();
    rgtVec.setFromMatrixColumn(this.camera.matrix, 0);
    rgtVec.y = 0; rgtVec.normalize();

    if (this.onGround) {
      if (fwd !== 0 || rgt !== 0) {
        this._airVelX = fwdVec.x * fwd * spd + rgtVec.x * rgt * spd;
        this._airVelZ = fwdVec.z * fwd * spd + rgtVec.z * rgt * spd;
        this.isMoving = true;
        sound.playFootstep(performance.now() / 1000, sprint);
      } else {
        this._airVelX = 0;
        this._airVelZ = 0;
        this.isMoving = false;
      }
    } else {
      // Air: momentum locked at takeoff — camera rotation has no effect on trajectory
      this.isMoving = Math.hypot(this._airVelX, this._airVelZ) > 0.5;
    }

    const cx = this.camera.position;
    if (!this.map.isWall(cx.x + this._airVelX * delta, cx.z)) cx.x += this._airVelX * delta;
    if (!this.map.isWall(cx.x, cx.z + this._airVelZ * delta)) cx.z += this._airVelZ * delta;

    if (this.keys.has('Space') && this.onGround) {
      this.velY = JUMP_FORCE;
      this.onGround = false;
      sound.play('jump', { volume: 0.18 });
    }
  }

  _updatePhysics(delta) {
    if (!this.onGround) this.velY -= GRAVITY * delta;

    const newY = this.camera.position.y + this.velY * delta;
    if (newY <= PLAYER_HEIGHT) {
      if (!this.onGround && this.velY < -3) {
        sound.play('land', { volume: 0.15 + Math.min(0.20, -this.velY / 15) });
      }
      this.camera.position.y = PLAYER_HEIGHT;
      this.velY = 0; this.onGround = true;
    } else {
      this.camera.position.y = newY; this.onGround = false;
    }
  }

  // ═══════════════════════════════════════════════════════
  //  SHOOTING
  // ═══════════════════════════════════════════════════════

  _tryShoot(nowMs) {
    if (!this.alive || !this.controls.isLocked || this.weapon.reloading) return;

    if (this.weapon.ammo <= 0) {
      if (this.weapon.reserve > 0) this.weapon.reload();
      else if (this.weapon.isEmptyClickReady(nowMs)) this.weapon.clickEmpty(nowMs);
      return;
    }

    if (!this.weapon.canFire(nowMs)) return;

    for (let p = 0; p < this.weapon.def.pellets; p++) this._doShot();
    this.weapon.consumeShot(nowMs);
    if (this.weapon.ammo <= 0 && this.weapon.reserve > 0) this.weapon.reload();
  }

  _doShot() {
    const s = this.weapon.effectiveSpread;
    this.raycaster.setFromCamera(
      new THREE.Vector2((Math.random() - 0.5) * s * 2, (Math.random() - 0.5) * s * 2),
      this.camera,
    );

    // Cast walls first — anything behind a wall is unreachable
    const wallHits = this.raycaster.intersectObjects(this.map.staticMeshes, false);
    const wallDist = wallHits.length > 0 ? wallHits[0].distance : Infinity;

    // ── Bots ────────────────────────────────────────────
    const botHits = this.raycaster.intersectObjects(
      this.bots.filter(b => b.alive).map(b => b.mesh), true,
    );
    if (botHits.length > 0 && botHits[0].distance < wallDist) {
      const hit = botHits[0];
      const bot = this.bots.find(b => b.mesh === hit.object || b.mesh === hit.object.parent);
      if (!bot?.alive) return;

      const isHead = hit.object.position.y > 1.3;
      const dmg    = isHead ? this.weapon.def.damage * HEADSHOT_MULT : this.weapon.def.damage;
      const killed = bot.takeDamage(dmg);

      sound.play(isHead ? 'headshot' : 'bullet_flesh', { volume: 1.0 });
      this.hud.showHitMarker(isHead);

      if (killed) {
        this._onKill(`Bot-${bot.index + 1}`);
      } else {
        this.hud.showScorePopup(isHead ? '+75' : '+50');
      }
      return;
    }

    // ── Remote players ───────────────────────────────────
    if (this.mode === 'multi' && this.remotePlayers.size > 0) {
      const rHits = this.raycaster.intersectObjects(
        [...this.remotePlayers.values()].map(r => r.mesh), true,
      );
      if (rHits.length > 0 && rHits[0].distance < wallDist) {
        const hit = rHits[0];
        for (const [uid, rp] of this.remotePlayers) {
          if (rp.mesh === hit.object || rp.mesh === hit.object.parent) {
            const isHead = hit.object.position.y > 1.3;
            const dmg    = isHead ? this.weapon.def.damage * HEADSHOT_MULT : this.weapon.def.damage;
            this.mp.sendHit(uid, dmg);
            sound.play(isHead ? 'headshot' : 'bullet_flesh', { volume: 1.0 });
            this.hud.showHitMarker(isHead);
            this.hud.showScorePopup(isHead ? '+75' : '+50');
            this._recentlyShot.add(uid);
            setTimeout(() => this._recentlyShot.delete(uid), 5000);
            break;
          }
        }
        return;
      }
    }

    // ── Static surfaces ──────────────────────────────────
    if (wallHits.length > 0) {
      const sh     = wallHits[0];
      const normal = sh.face.normal.clone().transformDirection(sh.object.matrixWorld);
      this.particles.spawnImpact(sh.point, normal);
      sound.play('bullet_wall', { volume: 0.5, pitch: 0.85 + Math.random() * 0.3 });
    }
  }

  // ═══════════════════════════════════════════════════════
  //  COMBAT
  // ═══════════════════════════════════════════════════════

  takeDamage(amount, killerName = 'Enemy') {
    if (!this.alive) return;
    this.health      = Math.max(0, this.health - amount);
    this.lastDamageMs = performance.now();
    this._hitShake   = Math.min(1.0, this._hitShake + amount / 25);

    sound.play('hurt', { volume: Math.min(1, amount / 30) });
    this.hud.showDamageVignette();
    this.damageFlashTimer = 0.4;
    this.hud.setHealth(this.health);
    this.mp?.updateHealth(this.health);

    if (this.health <= 0) this._die(killerName);
  }

  /** Shared kill-confirm path for bots and remote players. */
  _onKill(victimName) {
    this._killStreak++;
    this.kills++;
    this.hud.showScorePopup('+100', true);
    this.hud.showMedal(this._killStreak);
    sound.play('kill_confirm', { volume: 1.0, pitch: this._killConfirmPitch() });
    this.hud.setScore(this.kills, this.deaths);
    this.hud.addKillFeed(this.username, victimName);
    this.mp?.updateKills(this.kills, this.deaths);
  }

  /** kill-confirm pitch: +0.08 per kill in streak, capped at 5. */
  _killConfirmPitch() {
    return 1.0 + Math.min(4, Math.max(0, this._killStreak - 1)) * 0.08;
  }

  _die(killerName) {
    this.alive       = false;
    this.deaths++;
    this._killStreak = 0;
    this.mp?.updateKills(this.kills, this.deaths);

    sound.play('die', { volume: 1.0 });
    this.controls.unlock();
    this.weapon.setADS(false);
    this._applyADSState(false);
    this.hud.addKillFeed(killerName, this.username);
    this.hud.setScore(this.kills, this.deaths);
    this.hud.showDeathScreen(killerName);

    let countdown = RESPAWN_TIME;
    this.hud.setRespawnCountdown(countdown);
    const iv = setInterval(() => {
      this.hud.setRespawnCountdown(--countdown);
      if (countdown <= 0) { clearInterval(iv); this._respawn(); }
    }, 1000);
  }

  _respawn() {
    this.health = 100;
    this.alive  = true;
    this.weapon.equip(this.weapon.key);   // resets ammo via equip, fires callbacks

    const sp   = this.map.spawnPoints;
    const pick = sp[Math.floor(Math.random() * sp.length)];
    this.camera.position.set(pick.x, PLAYER_HEIGHT, pick.z);

    this.hud.setHealth(100);
    this.hud.setScore(this.kills, this.deaths);
    this.hud.hideDeathScreen();
    this.mp?.updateHealth(100);
    setTimeout(() => this.controls.lock(), 100);
  }

  // ═══════════════════════════════════════════════════════
  //  REGEN
  // ═══════════════════════════════════════════════════════

  _updateRegen(delta, nowMs) {
    if (!this.alive || this.health >= 100) return;
    if (nowMs - this.lastDamageMs < REGEN_DELAY) return;
    this.health = Math.min(100, this.health + REGEN_RATE * delta);
    this.hud.setHealth(this.health);
    this.mp?.updateHealth(Math.round(this.health));
  }

  // ═══════════════════════════════════════════════════════
  //  BOTS & REMOTE PLAYERS
  // ═══════════════════════════════════════════════════════

  _updateBots(delta, nowMs) {
    this.bots.forEach(bot => {
      bot.update(delta, nowMs, this.camera.position, (dmg, name) => this.takeDamage(dmg, name));
      bot.updateHealthBar(this.camera);
    });
  }

  _updateRemotePlayers(delta) {
    this.remotePlayers.forEach(rp => {
      if (!rp.mesh.visible) return;
      rp.mesh.position.lerp(rp.targetPos, 0.25);
      rp.mesh.rotation.y = THREE.MathUtils.lerp(rp.mesh.rotation.y, rp.targetRotY, 0.25);

      // Billboard name labels (depthTest=false) toward local camera
      rp.mesh.traverse(c => {
        if (c.isMesh && c.material?.depthTest === false) c.lookAt(this.camera.position);
      });

      // Limb animation
      if (rp.limbs && rp.prevPos) {
        this._animateRemotePlayer(rp, delta);
      }
    });
  }

  /**
   * Drive limb swing for a remote player based on how much their mesh
   * moved this frame (lerp-smoothed) and whether they are airborne.
   */
  _animateRemotePlayer(rp, delta) {
    const L = rp.limbs;
    const moved = rp.prevPos.distanceTo(rp.mesh.position);
    rp.prevPos.copy(rp.mesh.position);

    // Detect airborne: y position is synced from Firebase
    const groundY = 0;
    const isAirborne = (rp.data.y ?? groundY) > groundY + 0.35;

    if (isAirborne) {
      // Jump pose: arms spread forward, legs pulled back slightly
      L.leftArm.rotation.x  = THREE.MathUtils.lerp(L.leftArm.rotation.x,   0.55, 0.18);
      L.rightArm.rotation.x = THREE.MathUtils.lerp(L.rightArm.rotation.x,  0.55, 0.18);
      L.leftLeg.rotation.x  = THREE.MathUtils.lerp(L.leftLeg.rotation.x,  -0.30, 0.18);
      L.rightLeg.rotation.x = THREE.MathUtils.lerp(L.rightLeg.rotation.x, -0.30, 0.18);
    } else if (moved > 0.005) {
      // Walking / running — threshold tuned to lerp-damped displacement
      const isRunning = moved > 0.022;
      const freq = isRunning ? 10   : 5.5;
      const amp  = isRunning ? 0.68 : 0.42;
      rp.animPhase += delta * freq;
      const swing = Math.sin(rp.animPhase);
      L.leftArm.rotation.x  =  swing * amp;
      L.rightArm.rotation.x = -swing * amp;
      L.leftLeg.rotation.x  = -swing * amp * 0.85;
      L.rightLeg.rotation.x =  swing * amp * 0.85;
    } else {
      // Idle: smoothly return all limbs to neutral
      const t = Math.min(1, delta * 6);
      L.leftArm.rotation.x  = THREE.MathUtils.lerp(L.leftArm.rotation.x,  0, t);
      L.rightArm.rotation.x = THREE.MathUtils.lerp(L.rightArm.rotation.x, 0, t);
      L.leftLeg.rotation.x  = THREE.MathUtils.lerp(L.leftLeg.rotation.x,  0, t);
      L.rightLeg.rotation.x = THREE.MathUtils.lerp(L.rightLeg.rotation.x, 0, t);
    }
  }

  // ═══════════════════════════════════════════════════════
  //  HIT SHAKE
  // ═══════════════════════════════════════════════════════

  _updateHitShake(delta) {
    if (this._hitShake <= 0.005) { this._hitShake = 0; return; }
    this._hitShake = Math.max(0, this._hitShake - delta * 3.5);
    const s = this._hitShake;
    // Apply random camera jitter; PointerLockControls will overwrite it on next mousemove
    this.camera.quaternion.multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(
        (Math.random() - 0.5) * s * 0.10,
        (Math.random() - 0.5) * s * 0.05,
        0, 'YXZ',
      ))
    );
  }

  // ═══════════════════════════════════════════════════════
  //  ADS
  // ═══════════════════════════════════════════════════════

  _toggleADS() {
    if (!this.controls.isLocked || !this.alive) return;
    this.weapon.toggleADS();
    this._applyADSState(this.weapon.isADS);
  }

  /** Central point for all ADS side-effects (speed/sens handled in movement/pointer). */
  _applyADSState(on) {
    // Mouse sensitivity
    this.controls.pointerSpeed = this.opts.sensitivity * 0.42 * (on ? 0.5 : 1);
    // Scope overlay (sniper only)
    if (this.weapon.def.zoom >= 3) this.hud.setScope(on);
    // Crosshair shrink (non-scope weapons still see the crosshair, just smaller)
    this.hud.setAiming(on);
  }

  // ═══════════════════════════════════════════════════════
  //  INPUT
  // ═══════════════════════════════════════════════════════

  _bindInput() {
    document.addEventListener('keydown',    this._onKeyDown);
    document.addEventListener('keyup',      this._onKeyUp);
    document.addEventListener('mousedown',  this._onMouseDn);
    document.addEventListener('mouseup',    this._onMouseUp);
    document.addEventListener('contextmenu', this._onCtxMenu);
  }

  _unbindInput() {
    document.removeEventListener('keydown',    this._onKeyDown);
    document.removeEventListener('keyup',      this._onKeyUp);
    document.removeEventListener('mousedown',  this._onMouseDn);
    document.removeEventListener('mouseup',    this._onMouseUp);
    document.removeEventListener('contextmenu', this._onCtxMenu);
    window.removeEventListener('resize',       this._onResize);
  }

  _handleKeyDown(e) {
    this.keys.add(e.code);
    if (!this.controls.isLocked || !this.alive) return;
    if (e.code === 'KeyR') this.weapon.reload();
    if (e.code === 'KeyE') this._toggleADS();
  }

  _handleKeyUp(e) { this.keys.delete(e.code); }

  _handleMouseDown(e) {
    if (!this.controls.isLocked || !this.alive) return;
    if (e.button === 0) {
      this.mouseDown = true;
      if (!this.weapon.def.automatic) this._tryShoot(performance.now());
    }
    if (e.button === 2) {
      if (this.opts.adsMode === 'hold') {
        if (!this.weapon.isADS) this._toggleADS();
      } else {
        this._toggleADS();
      }
    }
  }

  _handleMouseUp(e) {
    if (e.button === 0) this.mouseDown = false;
    if (e.button === 2 && this.opts.adsMode === 'hold' && this.weapon.isADS) this._toggleADS();
  }

  _handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ═══════════════════════════════════════════════════════
  //  MESH BUILDERS
  // ═══════════════════════════════════════════════════════

  _buildRemotePlayerMesh(playerName = 'Player') {
    const g    = new THREE.Group();
    const bMat = new THREE.MeshLambertMaterial({ color: 0x0055cc });
    const hMat = new THREE.MeshLambertMaterial({ color: 0xc8865a });
    const gMat = new THREE.MeshLambertMaterial({ color: 0x111111 });

    const box = (mat, [w, h, d], [x, y, z]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };

    box(bMat, [0.55, 0.65, 0.30], [0,     0.90, 0]);  // torso
    const leftArm  = box(bMat, [0.16, 0.50, 0.16], [-0.37, 0.90, 0]);
    const rightArm = box(bMat, [0.16, 0.50, 0.16], [ 0.37, 0.90, 0]);
    const leftLeg  = box(bMat, [0.20, 0.55, 0.22], [-0.13, 0.35, 0]);
    const rightLeg = box(bMat, [0.20, 0.55, 0.22], [ 0.13, 0.35, 0]);
    box(hMat, [0.34, 0.32, 0.30], [0,     1.52, 0]);  // head
    box(gMat, [0.06, 0.06, 0.38], [0.37,  0.72, 0.24]); // gun (positive Z = forward)

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.13, 0.16, 8), hMat);
    neck.position.y = 1.30;
    g.add(neck);

    // Name label — billboarded each frame in _updateRemotePlayers
    const nc  = document.createElement('canvas');
    nc.width  = 256; nc.height = 48;
    const ctx = nc.getContext('2d');
    ctx.font       = 'bold 22px "Rajdhani", sans-serif';
    ctx.fillStyle  = '#88bbff';
    ctx.textAlign  = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
    ctx.fillText(playerName, 128, 34);

    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.19),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(nc),
        transparent: true, depthTest: false, side: THREE.DoubleSide,
      }),
    );
    label.name = 'nameSprite';
    label.position.y = 2.28;
    g.add(label);

    return { mesh: g, limbs: { leftArm, rightArm, leftLeg, rightLeg } };
  }

  /** Flat body mesh. @param {THREE.Vector3} pos @param {number} rotY @param {number} color */
  _makeCorpse(pos, rotY, color) {
    const mat  = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 1.50), mat);
    mesh.position.set(pos.x, 0.09, pos.z);
    mesh.rotation.y = rotY;
    return mesh;
  }

  /**
   * Fade a mesh's opacity from 1→0 between fadeStartSec and fadeEndSec,
   * then remove it from the scene and free its material.
   */
  _fadeAndRemove(mesh, fadeStartSec, fadeEndSec) {
    let t = 0;
    const iv = setInterval(() => {
      t += 0.1;
      if (t > fadeStartSec) {
        mesh.material.opacity = Math.max(
          0,
          1 - (t - fadeStartSec) / (fadeEndSec - fadeStartSec),
        );
      }
      if (t >= fadeEndSec) {
        clearInterval(iv);
        this.scene?.remove(mesh);
        mesh.material.dispose();
      }
    }, 100);
  }
}
