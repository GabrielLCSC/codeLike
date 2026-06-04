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
  HEADSHOT_MULT, WEAPONS, BOT_COUNT, BOT_LEVELS, SYNC_INTERVAL,
} from './config.js';
import { MapGenerator }  from './mapgen.js';
import { Bot }           from './bot.js';
import { sound }         from './sound.js';
import { HUD }           from './hud.js';
import { WeaponSystem }  from './weapon.js';
import { ParticleSystem } from './particles.js';
import {
  buildCharacterMesh,
  updateCharacterAnimation,
  billboardCharacterLabels,
} from './character.js';

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
   *   botLevel?:   'private'|'corporal'|'commando'|'veteran',
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
    this._emptyClickPlayed = false;

    // Raycaster shared across all shots
    this.raycaster    = new THREE.Raycaster();
    this._hitWorldPos = new THREE.Vector3();
    this._playerSpawnSlot = 0;
    this._claimedSpawns   = new Set();
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
    this._claimedSpawns.clear();
    this.bots = [];
    this.remotePlayers.clear();

    this._initRenderer();
    this._initScene();
    this._initMap();
    this._initPlayerSpawnSlot();
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
    sound.stopAmbiance();
    sound.stopTacticalSprintLoop();
    this.running = false;
    this.controls?.unlock();
    this._unbindInput();
    this.bots.forEach(b => this.scene?.remove(b.mesh));
    this.bots = [];
    this.remotePlayers.forEach(({ mesh }) => this.scene?.remove(mesh));
    this.remotePlayers.clear();
    this._claimedSpawns.clear();
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

    const sp = this._getSpawnPos(this._playerSpawnSlot);
    this._placePlayerAt(sp.x, sp.z);

    const plo = document.getElementById('pointer-lock-overlay');
    plo.addEventListener('click', () => {
      if (this.alive && this.running) this.controls.lock();
    }, { capture: true });

    this.controls.addEventListener('lock', () => {
      plo.classList.add('hidden');
      const title = document.getElementById('plo-title');
      if (title) title.textContent = 'PAUSED';
      sound.init().then(() => sound.startAmbiance('city'));
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
    this.weapon.onMuzzleEffects = (pos, dir) => {
      this.particles.spawnMuzzleSmoke(pos, dir);
    };
  }

  _spawnHalf() {
    return Math.ceil(this.map.spawnPoints.length / 2);
  }

  /**
   * Reserve a unique spawn index. Tries preferred first, then any free slot.
   * @param {number|null} preferred
   * @returns {number}
   */
  _claimSpawnSlot(preferred = null) {
    const n = this.map.spawnPoints.length;
    if (
      preferred !== null &&
      preferred >= 0 &&
      preferred < n &&
      !this._claimedSpawns.has(preferred)
    ) {
      this._claimedSpawns.add(preferred);
      return preferred;
    }
    for (let i = 0; i < n; i++) {
      if (!this._claimedSpawns.has(i)) {
        this._claimedSpawns.add(i);
        return i;
      }
    }
    return preferred ?? 0;
  }

  /** Unique spawn slot for the local player (spawn zone A). */
  _initPlayerSpawnSlot() {
    const half = this._spawnHalf();
    let preferred = 0;
    if (this.mp) {
      const humans = [...this.mp.players.keys()].sort();
      const idx    = humans.indexOf(this.mp.uid);
      preferred    = idx >= 0 ? idx % half : 0;
    }
    this._playerSpawnSlot = this._claimSpawnSlot(preferred);
  }

  _getSpawnPos(slotIndex) {
    const pts = this.map.spawnPoints;
    const i   = ((slotIndex % pts.length) + pts.length) % pts.length;
    return { x: pts[i].x, z: pts[i].z };
  }

  /** Nudge position if the exact spawn cell overlaps a wall / another body. */
  _placePlayerAt(x, z) {
    const offsets = [
      [0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7],
      [1.0, 1.0], [-1.0, 1.0], [1.0, -1.0], [-1.0, -1.0],
    ];
    for (const [dx, dz] of offsets) {
      const tx = x + dx;
      const tz = z + dz;
      if (!this.map.isWall(tx, tz)) {
        this.camera.position.set(tx, PLAYER_HEIGHT, tz);
        return;
      }
    }
    this.camera.position.set(x, PLAYER_HEIGHT, z);
  }

  _spawnBots(count) {
    const cfg  = BOT_LEVELS[this.opts.botLevel ?? 'corporal'] ?? BOT_LEVELS.corporal;
    const half = this._spawnHalf();
    for (let i = 0; i < count; i++) {
      const preferred = half + (i % half);
      const slot      = this._claimSpawnSlot(preferred);
      const sp        = this._getSpawnPos(slot);
      const onSound   = (key, pos, opts) => this._playWorldSound(key, pos, opts);
      this.bots.push(new Bot(this.scene, sp, this.map, i, cfg, onSound, slot));
    }
  }

  /** Play a sound in world space — routes through sound.playAt() with the camera as the listener. */
  _playWorldSound(key, pos, opts = {}) {
    sound.playAt(key, pos, this.camera, opts);
  }

  /** Pick a random footstep key from the loaded variants. */
  _randomFootstepKey() {
    const keys = ['footstep', 'footstep2', 'footstep3', 'footstep4'];
    return keys[Math.floor(Math.random() * keys.length)];
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
          const corpse = this._makeCorpse(rp.mesh.position, rp.mesh.rotation.y, 0x3a4038);
          this.scene.add(corpse);
          this._fadeAndRemove(corpse, 5, 8);

          if (this._recentlyShot.has(uid)) {
            this._recentlyShot.delete(uid); // clear before _onKill to avoid re-entry
            this._onKill(data.name ?? 'Player');
          }
        }
      } else {
        const { mesh, rig } = this._buildRemotePlayerMesh(data.name ?? 'Player');
        mesh.position.set(data.x ?? 0, 0, data.z ?? 0);
        this.scene.add(mesh);
        this.remotePlayers.set(uid, {
          mesh,
          rig,
          data,
          targetPos:  new THREE.Vector3(data.x ?? 0, 0, data.z ?? 0),
          targetRotY: data.rotY ?? 0,
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
    const sprinting = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && this.isMoving;
    this.weapon.update(delta, this.isMoving, this.mouseDown, sprinting);

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
      return;
    }

    if (!this.weapon.canFire(nowMs)) return;

    for (let p = 0; p < this.weapon.def.pellets; p++) this._doShot();
    this.weapon.consumeShot(nowMs);
    if (this.weapon.ammo <= 0 && this.weapon.reserve > 0) this.weapon.reload();
  }

  /** Walk parent chain to find which character root was hit. */
  _resolveCharacterHit(hitObject, entries) {
    let node = hitObject;
    while (node) {
      for (const entry of entries) {
        if (node === entry.mesh) return entry;
      }
      node = node.parent;
    }
    return null;
  }

  /** Headshot uses world-space Y (nested limb local Y is unreliable). */
  _isHeadHit(hitObject) {
    if (hitObject.material?.depthTest === false) return false;
    hitObject.getWorldPosition(this._hitWorldPos);
    return this._hitWorldPos.y > 1.52;
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
    const botEntries = this.bots.filter(b => b.alive).map(b => ({ mesh: b.mesh, ref: b }));
    const botHits    = this.raycaster.intersectObjects(botEntries.map(e => e.mesh), true);
    for (const hit of botHits) {
      if (hit.distance >= wallDist) break;
      if (hit.object.material?.depthTest === false) continue;
      const entry = this._resolveCharacterHit(hit.object, botEntries);
      if (!entry?.ref?.alive) continue;

      const bot    = entry.ref;
      const isHead = this._isHeadHit(hit.object);
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
      const rpEntries = [...this.remotePlayers.values()]
        .filter(rp => rp.mesh.visible)
        .map(rp => ({ mesh: rp.mesh, ref: rp }));
      const rHits = this.raycaster.intersectObjects(rpEntries.map(e => e.mesh), true);
      for (const hit of rHits) {
        if (hit.distance >= wallDist) break;
        if (hit.object.material?.depthTest === false) continue;
        const entry = this._resolveCharacterHit(hit.object, rpEntries);
        if (!entry) continue;

        const rp     = entry.ref;
        const isHead = this._isHeadHit(hit.object);
        const dmg    = isHead ? this.weapon.def.damage * HEADSHOT_MULT : this.weapon.def.damage;

        for (const [uid, candidate] of this.remotePlayers) {
          if (candidate !== rp) continue;
          this.mp.sendHit(uid, dmg);
          sound.play(isHead ? 'headshot' : 'bullet_flesh', { volume: 1.0 });
          this.hud.showHitMarker(isHead);
          this.hud.showScorePopup(isHead ? '+75' : '+50');
          this._recentlyShot.add(uid);
          setTimeout(() => this._recentlyShot.delete(uid), 5000);
          break;
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
    sound.playKillVoice(0.38, 300);
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
    if (killerName.startsWith('Bot-')) sound.playKillVoice(0.32, 300);
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

    const sp = this._getSpawnPos(this._playerSpawnSlot);
    this._placePlayerAt(sp.x, sp.z);

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

      // Name labels + animation
      if (rp.rig && rp.prevPos) {
        this._animateRemotePlayer(rp, delta);
      }
      billboardCharacterLabels(rp.mesh, this.camera);
    });
  }

  /**
   * Drive animation for a remote player from movement / jump state.
   */
  _animateRemotePlayer(rp, delta) {
    const moved = rp.prevPos.distanceTo(rp.mesh.position);
    rp.prevPos.copy(rp.mesh.position);

    const groundY    = 0;
    const isAirborne = (rp.data.y ?? groundY) > groundY + 0.35;

    let pose = 'idle';
    if (isAirborne) {
      pose = 'jump';
    } else if (moved > 0.005) {
      pose = moved > 0.022 ? 'run' : 'walk';

      rp._stepTimer = (rp._stepTimer ?? 0) - delta;
      if (rp._stepTimer <= 0) {
        rp._stepTimer = pose === 'run' ? 0.28 : 0.44;
        this._playWorldSound(this._randomFootstepKey(), rp.mesh.position, {
          volume: 0.82, maxDist: 24,
        });
      }
    }

    updateCharacterAnimation(rp.rig, delta, pose);
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
      const nowMs = performance.now();
      if (this.weapon.ammo <= 0) {
        if (this.weapon.reserve > 0) this.weapon.reload();
        else if (!this._emptyClickPlayed) {
          this.weapon.clickEmpty();
          this._emptyClickPlayed = true;
        }
      } else if (!this.weapon.def.automatic) {
        this._tryShoot(nowMs);
      }
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
    if (e.button === 0) {
      this.mouseDown = false;
      this._emptyClickPlayed = false;
    }
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
    const { mesh, rig } = buildCharacterMesh({
      team: 'ally',
      name: playerName,
      showHealthBar: false,
    });
    return { mesh, rig };
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
