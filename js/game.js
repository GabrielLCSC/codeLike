// ═══════════════════════════════════════════════════════════
//  WARFRONT — Main Game class
//  Handles: rendering, player movement, weapons, physics,
//           bots, remote players, HUD, minimap, death/respawn
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import {
  CELL_SIZE, WALL_HEIGHT,
  PLAYER_HEIGHT, PLAYER_SPEED, SPRINT_MULT, GRAVITY, JUMP_FORCE,
  REGEN_DELAY, REGEN_RATE, RESPAWN_TIME, HEADSHOT_MULT, WEAPONS,
  BOT_COUNT, SYNC_INTERVAL,
} from './config.js';
import { MapGenerator } from './mapgen.js';
import { Bot } from './bot.js';

export class Game {
  /**
   * @param {{
   *   mode:        'solo'|'multi',
   *   weapon:      string,
   *   sensitivity: number,
   *   fov:         number,
   *   username:    string,
   *   mp?:         import('./multiplayer.js').MultiplayerManager
   * }} opts
   */
  constructor(opts) {
    this.opts     = opts;
    this.mode     = opts.mode;
    this.mp       = opts.mp || null;
    this.username = opts.username || 'Ghost';

    // ── Three.js ─────────────────────────────────────────
    /** @type {THREE.WebGLRenderer} */ this.renderer = null;
    /** @type {THREE.Scene}         */ this.scene    = null;
    /** @type {THREE.PerspectiveCamera} */ this.camera = null;
    /** @type {PointerLockControls} */ this.controls  = null;

    // ── State ─────────────────────────────────────────────
    this.running  = false;
    this.alive    = true;
    this.health   = 100;
    this.kills    = 0;
    this.deaths   = 0;

    // ── Weapon ────────────────────────────────────────────
    this.weaponKey = opts.weapon;
    this.wDef      = WEAPONS[opts.weapon];
    this.ammo      = this.wDef.magSize;
    this.reserve   = this.wDef.reserve;
    this.reloading = false;
    this._reloadTimer = null;
    this.lastShotMs   = -9999;
    this.isADS        = false;
    this.targetFov    = opts.fov;

    // ── Input ─────────────────────────────────────────────
    this.keys      = new Set();
    this.mouseDown = false;

    // ── Physics ───────────────────────────────────────────
    this.velY     = 0;
    this.onGround = true;
    this.isMoving = false;

    // ── Visual ────────────────────────────────────────────
    this.bobPhase   = 0;
    this.recoilZ    = 0;
    this.recoilRotX = 0;
    this.damageFlashTimer = 0;

    // ── Scene objects ─────────────────────────────────────
    /** @type {Bot[]} */            this.bots           = [];
    /** @type {Map<string,{mesh:THREE.Group, data:object, targetPos:THREE.Vector3}>} */
    this.remotePlayers = new Map();
    /** @type {THREE.Group} */      this.weaponGroup    = null;
    /** @type {THREE.Mesh} */       this.muzzleFlash    = null;
    this._flashOff = null;

    // ── Map ───────────────────────────────────────────────
    /** @type {MapGenerator} */     this.map = null;

    // ── Minimap ───────────────────────────────────────────
    this._mmCanvas = null;
    this._mmCtx    = null;

    // ── Timing ────────────────────────────────────────────
    this.lastFrameMs   = performance.now();
    this.lastDamageMs  = -9999;
    this.lastSyncMs    = -9999;

    // ── Raycaster ─────────────────────────────────────────
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 80;

    // ── Bound event handlers (for cleanup) ────────────────
    this._onKeyDown  = this._handleKeyDown.bind(this);
    this._onKeyUp    = this._handleKeyUp.bind(this);
    this._onMouseDn  = this._handleMouseDown.bind(this);
    this._onMouseUp  = this._handleMouseUp.bind(this);
    this._onCtxMenu  = e => e.preventDefault();
    this._onRMB      = this._handleRMB.bind(this);
    this._onResize   = this._handleResize.bind(this);
  }

  // ═══════════════════════════════════════════════════════
  //  STARTUP
  // ═══════════════════════════════════════════════════════
  start() {
    this._setupRenderer();
    this._setupScene();
    this._buildMap();
    this._setupPlayer();
    this._setupWeapon();
    this._setupInput();
    this._setupHUD();

    if (this.mode === 'solo') {
      this._spawnBots(BOT_COUNT);
    }

    if (this.mp) {
      this._setupMultiplayer();
    }

    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('pointer-lock-overlay').classList.remove('hidden');
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
    this.controls?.unlock();
    this._removeInput();
    this.bots.forEach(b => { if (b.mesh) this.scene.remove(b.mesh); });
    this.remotePlayers.forEach(({ mesh }) => { if (mesh) this.scene.remove(mesh); });
    this.renderer?.dispose();
    this.scene = null;
    if (this.mp) this.mp.leave();
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('pointer-lock-overlay').classList.add('hidden');
    document.getElementById('death-screen').classList.add('hidden');
    document.getElementById('scope-overlay').classList.add('hidden');
    document.getElementById('crosshair').classList.remove('hidden');
  }

  // ═══════════════════════════════════════════════════════
  //  SETUP HELPERS
  // ═══════════════════════════════════════════════════════
  _setupRenderer() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    window.addEventListener('resize', this._onResize);
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x12121c, 0.022);
    this.scene.background = new THREE.Color(0x08080f);

    this.camera = new THREE.PerspectiveCamera(
      this.opts.fov,
      window.innerWidth / window.innerHeight,
      0.08, 120
    );
  }

  _buildMap() {
    this.map = new MapGenerator().generate();
    this.map.buildScene(this.scene);

    this._mmCanvas = document.getElementById('minimap');
    this._mmCtx    = this._mmCanvas.getContext('2d');
    this._mmCanvas.width  = 150;
    this._mmCanvas.height = 150;
  }

  _setupPlayer() {
    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.controls.pointerSpeed = this.opts.sensitivity * 0.42;
    this.scene.add(this.camera);

    // Spawn at random room centre
    const sp = this.map.spawnPoints;
    const pick = sp[Math.floor(Math.random() * sp.length)];
    this.camera.position.set(pick.x, PLAYER_HEIGHT, pick.z);

    // Pointer lock events
    const plo = document.getElementById('pointer-lock-overlay');
    plo.addEventListener('click', () => {
      if (this.alive && this.running) this.controls.lock();
    }, { capture: true });

    this.controls.addEventListener('lock', () => {
      plo.classList.add('hidden');
    });
    this.controls.addEventListener('unlock', () => {
      if (this.alive && this.running) {
        plo.classList.remove('hidden');
      }
    });

    // Auto-lock on start
    setTimeout(() => this.controls.lock(), 200);
  }

  _setupWeapon() {
    this.weaponGroup = this._buildGunModel(this.weaponKey);
    this.weaponGroup.position.set(0.22, -0.28, -0.46);
    this.camera.add(this.weaponGroup);

    // Muzzle flash
    const flashGeo  = new THREE.SphereGeometry(0.05, 6, 6);
    const flashMat  = new THREE.MeshBasicMaterial({ color: 0xffdd44 });
    const flashMesh = new THREE.Mesh(flashGeo, flashMat);
    const flashLight = new THREE.PointLight(0xffaa00, 4, 2.5);
    this.muzzleFlash = new THREE.Group();
    this.muzzleFlash.add(flashMesh, flashLight);
    this.muzzleFlash.position.set(0, 0, -0.62);
    this.muzzleFlash.visible = false;
    this.weaponGroup.add(this.muzzleFlash);
  }

  _setupInput() {
    document.addEventListener('keydown',   this._onKeyDown);
    document.addEventListener('keyup',     this._onKeyUp);
    document.addEventListener('mousedown', this._onMouseDn);
    document.addEventListener('mouseup',   this._onMouseUp);
    document.addEventListener('contextmenu', this._onCtxMenu);
  }

  _removeInput() {
    document.removeEventListener('keydown',      this._onKeyDown);
    document.removeEventListener('keyup',        this._onKeyUp);
    document.removeEventListener('mousedown',    this._onMouseDn);
    document.removeEventListener('mouseup',      this._onMouseUp);
    document.removeEventListener('contextmenu',  this._onCtxMenu);
    window.removeEventListener('resize',         this._onResize);
  }

  _setupHUD() {
    document.getElementById('hud-weapon-name').textContent = this.wDef.name;
    document.getElementById('hud-ammo-mag').textContent    = this.ammo;
    document.getElementById('hud-ammo-reserve').textContent = this.reserve;
    if (this.mode === 'multi' && this.mp) {
      document.getElementById('hud-room-tag').textContent = `· ${this.mp.roomCode}`;
    }
    this._updateHealthHUD();
    this._updateScoreHUD();
  }

  _spawnBots(count) {
    const sp = this.map.spawnPoints;
    for (let i = 0; i < count; i++) {
      const pick = sp[(i + 1) % sp.length]; // avoid first spawn (player's)
      this.bots.push(new Bot(this.scene, pick, this.map, i));
    }
  }

  _setupMultiplayer() {
    this.mp.onPlayerUpdate = (uid, data) => {
      if (this.remotePlayers.has(uid)) {
        const rp = this.remotePlayers.get(uid);
        rp.data = data;
        rp.targetPos.set(data.x, 0, data.z);
        rp.targetRotY = data.rotY ?? 0;
        rp.mesh.visible = !!data.alive;
      } else {
        const mesh = this._buildRemotePlayerMesh();
        mesh.position.set(data.x ?? 0, 0, data.z ?? 0);
        this.scene.add(mesh);
        this.remotePlayers.set(uid, {
          mesh,
          data,
          targetPos:  new THREE.Vector3(data.x ?? 0, 0, data.z ?? 0),
          targetRotY: data.rotY ?? 0,
        });
      }
    };

    this.mp.onPlayerRemoved = (uid) => {
      const rp = this.remotePlayers.get(uid);
      if (rp) { this.scene.remove(rp.mesh); this.remotePlayers.delete(uid); }
    };

    this.mp.onHitReceived = (evt) => {
      const shooterData = this.mp.players.get(evt.shooter);
      const killerName  = shooterData?.name || 'Player';
      this.takeDamage(evt.damage, killerName);
    };
  }

  // ═══════════════════════════════════════════════════════
  //  MAIN LOOP
  // ═══════════════════════════════════════════════════════
  _loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this._loop());

    const nowMs  = performance.now();
    const delta  = Math.min((nowMs - this.lastFrameMs) / 1000, 0.1);
    this.lastFrameMs = nowMs;

    this._update(delta, nowMs);
    this.renderer.render(this.scene, this.camera);
  }

  _update(delta, nowMs) {
    if (!this.alive) return;

    // ── Shooting (auto weapons) ─────────────────────────
    if (this.mouseDown && this.wDef.automatic && this.controls.isLocked) {
      this._tryShoot(nowMs);
    }

    // ── Movement & physics ─────────────────────────────
    this._updateMovement(delta);
    this._updatePhysics(delta);

    // ── FOV lerp (ADS) ─────────────────────────────────
    if (Math.abs(this.camera.fov - this.targetFov) > 0.3) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.targetFov, 0.18);
      this.camera.updateProjectionMatrix();
    }

    // ── Weapon animation ───────────────────────────────
    this._updateWeaponAnim(delta);

    // ── Health regeneration ────────────────────────────
    this._updateRegen(delta, nowMs);

    // ── Bots ───────────────────────────────────────────
    this._updateBots(delta, nowMs);

    // ── Remote players (multiplayer) ───────────────────
    this._updateRemotePlayers();

    // ── Firebase position sync ─────────────────────────
    if (this.mp && nowMs - this.lastSyncMs > SYNC_INTERVAL) {
      this.lastSyncMs = nowMs;
      const pos = this.camera.position;
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.mp.updatePosition(pos.x, pos.y, pos.z, Math.atan2(dir.x, dir.z));
    }

    // ── HUD ────────────────────────────────────────────
    this._updateMinimap();

    // ── Damage vignette fade ───────────────────────────
    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer -= delta;
      if (this.damageFlashTimer <= 0) {
        document.getElementById('damage-vignette').classList.remove('flash');
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  //  MOVEMENT & PHYSICS
  // ═══════════════════════════════════════════════════════
  _updateMovement(delta) {
    if (!this.controls.isLocked) return;

    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const spd    = PLAYER_SPEED * (sprint ? SPRINT_MULT : 1);

    // AZERTY: Z physical key → KeyW, Q physical key → KeyA
    const fwd = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const rgt = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);

    if (fwd !== 0 || rgt !== 0) {
      // Build move vector in world space from camera orientation
      const fwdVec = new THREE.Vector3();
      this.camera.getWorldDirection(fwdVec);
      fwdVec.y = 0; fwdVec.normalize();

      const rgtVec = new THREE.Vector3();
      rgtVec.setFromMatrixColumn(this.camera.matrix, 0);
      rgtVec.y = 0; rgtVec.normalize();

      const mv = new THREE.Vector3()
        .addScaledVector(fwdVec, fwd * spd * delta)
        .addScaledVector(rgtVec, rgt * spd * delta);

      const cx = this.camera.position;
      const nx = cx.x + mv.x;
      const nz = cx.z + mv.z;

      if (!this.map.isWall(nx, cx.z)) this.camera.position.x = nx;
      if (!this.map.isWall(cx.x, nz)) this.camera.position.z = nz;

      this.isMoving = true;
    } else {
      this.isMoving = false;
    }

    // Jump
    if (this.keys.has('Space') && this.onGround) {
      this.velY     = JUMP_FORCE;
      this.onGround = false;
    }
  }

  _updatePhysics(delta) {
    if (!this.onGround) this.velY -= GRAVITY * delta;

    const newY = this.camera.position.y + this.velY * delta;
    if (newY <= PLAYER_HEIGHT) {
      this.camera.position.y = PLAYER_HEIGHT;
      this.velY     = 0;
      this.onGround = true;
    } else {
      this.camera.position.y = newY;
      this.onGround = false;
    }
  }

  // ═══════════════════════════════════════════════════════
  //  SHOOTING
  // ═══════════════════════════════════════════════════════
  _tryShoot(nowMs) {
    if (!this.alive || !this.controls.isLocked) return;
    if (this.reloading) { return; }
    if (this.ammo <= 0) { this.reload(); return; }

    const fireInterval = 60000 / this.wDef.fireRate;
    if (nowMs - this.lastShotMs < fireInterval) return;

    this.lastShotMs = nowMs;

    for (let p = 0; p < this.wDef.pellets; p++) {
      this._doShot();
    }

    this.ammo--;
    this.recoilZ    = this.wDef.recoilZ;
    this.recoilRotX = this.wDef.recoilRotX;

    this._showMuzzleFlash();
    this._updateAmmoHUD();

    if (this.ammo <= 0 && this.reserve > 0) {
      this.reload();
    }
  }

  _doShot() {
    const spread = this.isADS ? this.wDef.spread * 0.35 : this.wDef.spread;
    const sx = (Math.random() - 0.5) * spread * 2;
    const sy = (Math.random() - 0.5) * spread * 2;

    this.raycaster.setFromCamera(new THREE.Vector2(sx, sy), this.camera);

    // ── Check bots ─────────────────────────────────────
    const botMeshes = this.bots.filter(b => b.alive).map(b => b.mesh);
    const botHits   = this.raycaster.intersectObjects(botMeshes, true);
    if (botHits.length > 0) {
      const hit = botHits[0];
      const bot = this.bots.find(b => b.mesh === hit.object || b.mesh === hit.object.parent);
      if (bot?.alive) {
        const isHead = hit.object.position.y > 1.3;
        const dmg    = isHead ? this.wDef.damage * HEADSHOT_MULT : this.wDef.damage;
        const killed = bot.takeDamage(dmg);
        this._showHitMarker(isHead);
        if (killed) {
          this.kills++;
          this._updateScoreHUD();
          this._addKillFeed(this.username, `Bot-${bot.index + 1}`);
          if (this.mp) this.mp.updateKills(this.kills, this.deaths);
        }
      }
      return;
    }

    // ── Check remote players (multiplayer) ────────────
    if (this.mode === 'multi' && this.remotePlayers.size > 0) {
      const rMeshes = [...this.remotePlayers.values()].map(r => r.mesh);
      const rHits   = this.raycaster.intersectObjects(rMeshes, true);
      if (rHits.length > 0) {
        const hit = rHits[0];
        for (const [uid, rp] of this.remotePlayers) {
          if (rp.mesh === hit.object || rp.mesh === hit.object.parent) {
            const isHead = hit.object.position.y > 1.3;
            const dmg    = isHead ? this.wDef.damage * HEADSHOT_MULT : this.wDef.damage;
            this.mp.sendHit(uid, dmg);
            this._showHitMarker(isHead);
            break;
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  //  RELOAD
  // ═══════════════════════════════════════════════════════
  reload() {
    if (this.reloading || this.ammo === this.wDef.magSize || this.reserve === 0) return;
    this.reloading = true;

    document.getElementById('reload-bar').classList.remove('hidden');
    // Animate fill bar width from 0 → 100% over reloadTime ms
    const fill = document.getElementById('reload-fill-bar');
    fill.style.transition = 'none';
    fill.style.width = '0%';
    void fill.offsetHeight; // force reflow
    fill.style.transition = `width ${this.wDef.reloadTime}ms linear`;
    fill.style.width = '100%';

    this._reloadTimer = setTimeout(() => {
      const needed = this.wDef.magSize - this.ammo;
      const taken  = Math.min(needed, this.reserve);
      this.ammo   += taken;
      this.reserve -= taken;
      this.reloading = false;
      bar.classList.add('hidden');
      this._updateAmmoHUD();
    }, this.wDef.reloadTime);
  }

  // ═══════════════════════════════════════════════════════
  //  DAMAGE / DEATH / RESPAWN
  // ═══════════════════════════════════════════════════════
  takeDamage(amount, killerName = 'Enemy') {
    if (!this.alive) return;
    this.health      = Math.max(0, this.health - amount);
    this.lastDamageMs = performance.now();

    // Flash vignette
    const vign = document.getElementById('damage-vignette');
    vign.classList.remove('flash');
    void vign.offsetHeight;
    vign.classList.add('flash');
    this.damageFlashTimer = 0.4;

    this._updateHealthHUD();

    if (this.mp) this.mp.updateHealth(this.health);

    if (this.health <= 0) this._die(killerName);
  }

  _die(killerName) {
    this.alive = false;
    this.deaths++;
    if (this.mp) this.mp.updateKills(this.kills, this.deaths);

    this.controls.unlock();
    document.getElementById('pointer-lock-overlay').classList.add('hidden');
    document.getElementById('scope-overlay').classList.add('hidden');
    document.getElementById('crosshair').classList.remove('hidden');
    this.isADS = false;
    this.targetFov = this.opts.fov;

    const ds = document.getElementById('death-screen');
    document.getElementById('lbl-killer').textContent = killerName;
    ds.classList.remove('hidden');

    let countdown = RESPAWN_TIME;
    document.getElementById('lbl-respawn-count').textContent = countdown;

      this._addKillFeed(killerName, this.username);

      const iv = setInterval(() => {
        countdown--;
        document.getElementById('lbl-respawn-count').textContent = countdown;
        if (countdown <= 0) {
          clearInterval(iv);
          this._respawn();
        }
      }, 1000);
  }

  _respawn() {
    this.health    = 100;
    this.alive     = true;
    this.ammo      = this.wDef.magSize;
    this.reserve   = this.wDef.reserve;
    this.reloading = false;
    clearTimeout(this._reloadTimer);
    document.getElementById('reload-bar').classList.add('hidden');

    const sp   = this.map.spawnPoints;
    const pick = sp[Math.floor(Math.random() * sp.length)];
    this.camera.position.set(pick.x, PLAYER_HEIGHT, pick.z);

    this._updateHealthHUD();
    this._updateAmmoHUD();
    this._updateScoreHUD();

    document.getElementById('death-screen').classList.add('hidden');
    if (this.mp) this.mp.updateHealth(100);

    setTimeout(() => this.controls.lock(), 100);
  }

  // ═══════════════════════════════════════════════════════
  //  ADS / SCOPE
  // ═══════════════════════════════════════════════════════
  _toggleADS() {
    if (!this.controls.isLocked || !this.alive) return;
    this.isADS = !this.isADS;
    this.targetFov = this.isADS
      ? this.opts.fov / this.wDef.zoom
      : this.opts.fov;

    const scopeEl = document.getElementById('scope-overlay');
    const xhairEl = document.getElementById('crosshair');
    if (this.isADS && this.wDef.zoom >= 3) {
      scopeEl.classList.remove('hidden');
      xhairEl.classList.add('hidden');
    } else {
      scopeEl.classList.add('hidden');
      xhairEl.classList.remove('hidden');
    }
  }

  // ═══════════════════════════════════════════════════════
  //  REGENERATION
  // ═══════════════════════════════════════════════════════
  _updateRegen(delta, nowMs) {
    if (!this.alive || this.health >= 100) return;
    if (nowMs - this.lastDamageMs < REGEN_DELAY) return;
    this.health = Math.min(100, this.health + REGEN_RATE * delta);
    this._updateHealthHUD();
    if (this.mp) this.mp.updateHealth(Math.round(this.health));
  }

  // ═══════════════════════════════════════════════════════
  //  BOTS
  // ═══════════════════════════════════════════════════════
  _updateBots(delta, nowMs) {
    const pPos = this.camera.position;
    this.bots.forEach(bot => {
      bot.update(delta, nowMs, pPos, (dmg, name) => this.takeDamage(dmg, name));
      bot.updateHealthBar(this.camera);
    });
  }

  // ═══════════════════════════════════════════════════════
  //  REMOTE PLAYERS (multiplayer)
  // ═══════════════════════════════════════════════════════
  _updateRemotePlayers() {
    this.remotePlayers.forEach(rp => {
      if (!rp.mesh.visible) return;
      rp.mesh.position.lerp(rp.targetPos, 0.25);
      rp.mesh.rotation.y = THREE.MathUtils.lerp(
        rp.mesh.rotation.y, rp.targetRotY ?? 0, 0.25
      );
    });
  }

  // ═══════════════════════════════════════════════════════
  //  WEAPON ANIMATION (recoil + head bob)
  // ═══════════════════════════════════════════════════════
  _updateWeaponAnim(delta) {
    // Recoil decay
    this.recoilZ    *= 0.82;
    this.recoilRotX *= 0.82;

    // Head bob
    this.bobPhase += delta * (this.isMoving ? 7.5 : 2.0);
    const bobAmt   = this.isMoving ? 1 : 0.3;
    const bobX     = Math.sin(this.bobPhase) * 0.010 * bobAmt;
    const bobY     = Math.abs(Math.cos(this.bobPhase * 0.5)) * 0.007 * bobAmt;

    if (this.weaponGroup) {
      this.weaponGroup.position.set(
        0.22 + bobX,
        -0.28 - bobY,
        -0.46 - this.recoilZ
      );
      this.weaponGroup.rotation.x = this.recoilRotX;
    }
  }

  // ═══════════════════════════════════════════════════════
  //  HUD UPDATES
  // ═══════════════════════════════════════════════════════
  _updateHealthHUD() {
    const pct = Math.max(0, this.health) / 100;
    const bar = document.getElementById('health-bar');
    bar.style.width = `${pct * 100}%`;
    // Shift hue: 0=red, 60=yellow, 120=green — matches CSS hsl()
    const hue = Math.floor(pct * 120);
    bar.style.backgroundColor = `hsl(${hue}, 85%, 48%)`;
    document.getElementById('hud-health-val').textContent = Math.ceil(this.health);
  }

  _updateAmmoHUD() {
    document.getElementById('hud-ammo-mag').textContent     = this.ammo;
    document.getElementById('hud-ammo-reserve').textContent = this.reserve;
  }

  _updateScoreHUD() {
    document.getElementById('hud-kills').textContent  = `K ${this.kills}`;
    document.getElementById('hud-deaths').textContent = `D ${this.deaths}`;
  }

  _addKillFeed(killer, victim) {
    const feed  = document.getElementById('kill-feed');
    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    const isMe = victim === this.username;
    entry.innerHTML =
      `<span class="kf-killer">${killer}</span>` +
      `<span class="kf-icon">✦</span>` +
      `<span class="kf-victim${isMe ? ' is-me' : ''}">${victim}</span>`;
    feed.prepend(entry);
    setTimeout(() => entry.remove(), 5000);
  }

  _showHitMarker(isHeadshot = false) {
    const el = document.getElementById('hit-marker');
    el.className = isHeadshot ? 'headshot' : 'hit';
    el.classList.remove('hidden');
    clearTimeout(this._hmTimeout);
    this._hmTimeout = setTimeout(() => el.classList.add('hidden'), 220);
  }

  _showMuzzleFlash() {
    this.muzzleFlash.visible = true;
    clearTimeout(this._flashOff);
    this._flashOff = setTimeout(() => { this.muzzleFlash.visible = false; }, 55);
  }

  // ═══════════════════════════════════════════════════════
  //  MINIMAP
  // ═══════════════════════════════════════════════════════
  _updateMinimap() {
    const ctx = this._mmCtx;
    const W = this._mmCanvas.width;
    const H = this._mmCanvas.height;
    const mapWorldW = this.map.width  * CELL_SIZE;
    const mapWorldH = this.map.height * CELL_SIZE;
    const sx = W / mapWorldW;
    const sz = H / mapWorldH;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, W, H);

    // Floor cells
    ctx.fillStyle = '#2a3545';
    for (let gx = 0; gx < this.map.width; gx++) {
      for (let gz = 0; gz < this.map.height; gz++) {
        if (this.map.grid[gx][gz] === 1) {
          ctx.fillRect(
            gx * CELL_SIZE * sx, gz * CELL_SIZE * sz,
            CELL_SIZE * sx + 0.5, CELL_SIZE * sz + 0.5
          );
        }
      }
    }

    // Bots
    ctx.fillStyle = '#ff3333';
    this.bots.forEach(b => {
      if (!b.alive) return;
      ctx.beginPath();
      ctx.arc(b.mesh.position.x * sx, b.mesh.position.z * sz, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Remote players
    ctx.fillStyle = '#4488ff';
    this.remotePlayers.forEach(rp => {
      if (!rp.mesh.visible) return;
      ctx.beginPath();
      ctx.arc(rp.mesh.position.x * sx, rp.mesh.position.z * sz, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Player
    const px = this.camera.position.x * sx;
    const pz = this.camera.position.z * sz;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    ctx.fillStyle = '#00ff88';
    ctx.beginPath();
    ctx.arc(px, pz, 3.5, 0, Math.PI * 2);
    ctx.fill();

    const len = Math.hypot(dir.x, dir.z);
    if (len > 0.01) {
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, pz);
      ctx.lineTo(px + (dir.x / len) * 9, pz + (dir.z / len) * 9);
      ctx.stroke();
    }
  }

  // ═══════════════════════════════════════════════════════
  //  INPUT HANDLERS
  // ═══════════════════════════════════════════════════════
  _handleKeyDown(e) {
    this.keys.add(e.code);

    if (e.code === 'KeyR' && this.controls.isLocked && this.alive) {
      this.reload();
    }
    if (e.code === 'KeyE' && this.controls.isLocked && this.alive) {
      this._toggleADS();
    }
  }

  _handleKeyUp(e) {
    this.keys.delete(e.code);
  }

  _handleMouseDown(e) {
    if (!this.controls.isLocked || !this.alive) return;
    if (e.button === 0) {
      this.mouseDown = true;
      if (!this.wDef.automatic) {
        this._tryShoot(performance.now());
      }
    }
    if (e.button === 2) {
      this._toggleADS();
    }
  }

  _handleMouseUp(e) {
    if (e.button === 0) this.mouseDown = false;
  }

  _handleRMB(e) {
    e.preventDefault();
    this._toggleADS();
  }

  _handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ═══════════════════════════════════════════════════════
  //  GUN MODEL BUILDER
  // ═══════════════════════════════════════════════════════
  _buildGunModel(key) {
    const g    = new THREE.Group();
    const wDef = WEAPONS[key];
    const bMat = new THREE.MeshLambertMaterial({ color: wDef.bodyColor });
    const dMat = new THREE.MeshLambertMaterial({ color: wDef.barrelColor });

    const configs = {
      assault_rifle: [
        { mat: bMat, geo: [0.068, 0.068, 0.38], pos: [0,       0,      0      ] }, // receiver
        { mat: dMat, geo: [0.030, 0.030, 0.22], pos: [0,  0.018, -0.30] },         // barrel
        { mat: bMat, geo: [0.040, 0.13,  0.06], pos: [0, -0.098,  0.04 ] },        // magazine
        { mat: bMat, geo: [0.058, 0.058, 0.14], pos: [0,       0,  0.26 ] },       // stock
        { mat: dMat, geo: [0.018, 0.018, 0.08], pos: [0,  0.050,  0.01 ] },        // carry handle
      ],
      shotgun: [
        { mat: bMat, geo: [0.090, 0.075, 0.36], pos: [0,      0,     0     ] }, // receiver
        { mat: dMat, geo: [0.055, 0.040, 0.26], pos: [0, 0.018, -0.31] },       // barrel
        { mat: bMat, geo: [0.085, 0.050, 0.09], pos: [0,      0,  0.16] },      // pump
        { mat: bMat, geo: [0.060, 0.065, 0.18], pos: [0,      0,  0.27] },      // stock
      ],
      sniper: [
        { mat: bMat, geo: [0.052, 0.052, 0.50], pos: [0,      0,     0    ] }, // receiver
        { mat: dMat, geo: [0.020, 0.020, 0.30], pos: [0, 0.010, -0.40] },      // barrel
        { mat: dMat, geo: [0.030, 0.030, 0.18], pos: [0, 0.048,  0.00] },      // scope body
        { mat: bMat, geo: [0.044, 0.046, 0.18], pos: [0,      0,  0.34] },     // stock
        { mat: bMat, geo: [0.034, 0.12,  0.05], pos: [0, -0.086, 0.12] },      // magazine
      ],
    };

    (configs[key] || configs.assault_rifle).forEach(({ mat, geo, pos }) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...geo), mat);
      mesh.position.set(...pos);
      g.add(mesh);
    });

    return g;
  }

  // ═══════════════════════════════════════════════════════
  //  REMOTE PLAYER MESH
  // ═══════════════════════════════════════════════════════
  _buildRemotePlayerMesh() {
    const g = new THREE.Group();
    const bMat = new THREE.MeshLambertMaterial({ color: 0x0055cc });
    const hMat = new THREE.MeshLambertMaterial({ color: 0xc8865a });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.65, 0.30), bMat);
    torso.position.y = 0.90;
    g.add(torso);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.30), hMat);
    head.position.y = 1.52;
    g.add(head);

    for (const side of [-0.13, 0.13]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.55, 0.22), bMat);
      leg.position.set(side, 0.35, 0);
      g.add(leg);
    }

    return g;
  }
}
