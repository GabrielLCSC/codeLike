// ═══════════════════════════════════════════════════════════
//  WARFRONT — Game (orchestrator)
//  Owns: Three.js renderer/scene/camera, player physics,
//        combat, bot + remote-player coordination, input.
//  Delegates to: HUD, WeaponSystem, ParticleSystem.
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import {
  REGEN_DELAY, REGEN_RATE, RESPAWN_TIME,
  MAX_HEALTH, AMMO_CHEST_RADIUS, AMMO_CHEST_COOLDOWN_MS, BOT_COUNT, BOT_LEVELS, BOT_SYNC_INTERVAL, MAX_PIXEL_RATIO,
  GRENADE_MAX, MAP_SCAN_RADIUS, ASSIST_WINDOW_MS,
  SYNC_INTERVAL, LODIBIDON_BOT_HIT_BONUS,
} from './config.js';
import { MapScanner } from './map-scanner.js';
import { MapGenerator }  from './mapgen.js';
import { Bot, SyncedBot } from './bots/index.js';
import { sound }         from './sound.js';
import { HUD }           from './hud.js';
import { WeaponSystem }  from './weapon.js';
import { ParticleSystem } from './particles.js';
import { GrenadeSystem }  from './grenade.js';
import {
  updateCharacterOverheadUI,
  resetCharacterPose,
  resetCharacterDeath,
} from './character.js';
import { LodibidonController, yawToward, enemyTeam } from './lodibidon.js';
import { ClassicMatchController } from './classic-match.js';
import { DEFAULT_MAP_ID, getMapGameplay, isValidMapId } from './maps/index.js';
import { WeaponPickupManager } from './weapon-pickups.js';
import { MagPickupManager } from './mag-pickups.js';
import { SpawnManager } from './spawn/spawn-manager.js';
import { PickupController } from './pickups/pickup-controller.js';
import { ShotResolver } from './combat/shot-resolver.js';
import { applyGrenadeDamage } from './combat/grenade-damage.js';
import { RemotePlayerManager } from './multiplayer/remote-player-manager.js';
import { MovementController } from './player/movement-controller.js';
import { MapEditor } from './maps/map-editor.js';
import { createEmptyMapData } from './maps/map-schema.js';
import { initMapModels } from './maps/model-loader.js';
import { setModelTools } from './maps/asset-catalog.js';

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
   *   gameType?:   'ffa'|'lodibidon',
   *   team?:       'alpha'|'omega',
   *   mapId?:      string,
   *   editorMode?: boolean,
   *   mp?:         import('./multiplayer.js').MultiplayerManager,
   * }} opts
   */
  constructor(opts) {
    this.opts     = opts;
    this.mode     = opts.mode;
    this.mp       = opts.mp || null;
    this.username = opts.username || 'Ghost';
    this.editorMode = opts.editorMode ?? false;

    // ── Three.js ──────────────────────────────────────────
    /** @type {THREE.WebGLRenderer}      */ this.renderer = null;
    /** @type {THREE.Scene}              */ this.scene    = null;
    /** @type {THREE.PerspectiveCamera}  */ this.camera   = null;
    /** @type {PointerLockControls}      */ this.controls = null;
    /** @type {MapGenerator}             */ this.map      = null;

    // ── Player state ──────────────────────────────────────
    this.running = false;
    this.alive   = true;
    this.health  = MAX_HEALTH;
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
    /** @type {Map<string, boolean>} uid → killing blow was headshot */
    this._recentlyShot = new Map();
    this._nearAmmoChest = false;
    this._ammoChestReadyAt = 0;
    /** @type {WeaponPickupManager|null} */
    this.weaponPickups = null;
    /** @type {MagPickupManager|null} */
    this.magPickups = null;
    /** @type {SpawnManager} */ this.spawns = new SpawnManager(this);
    /** @type {PickupController} */ this.pickups = new PickupController(this);
    /** @type {ShotResolver} */ this.shots = new ShotResolver(this);
    /** @type {RemotePlayerManager} */ this.remotes = new RemotePlayerManager(this);
    /** @type {MovementController} */ this.movement = new MovementController(this);
    /** @type {MapEditor} */ this.mapEditor = new MapEditor(this);
    /** Shared Map for spawn occupancy, lodibidon, combat — same as remotes.players */
    this.remotePlayers = this.remotes.players;
    this._lockAcquiredAt = 0;

    // ── Timing ────────────────────────────────────────────
    this.lastFrameMs      = performance.now();
    this.lastDamageMs     = -9999;
    this.lastSyncMs       = -9999;
    this._lastSyncGx      = -999;
    this._lastSyncGz      = -999;
    this._tabHeld         = false;
    /** @type {Map<string, { uid: string, t: number }[]>} */
    this._damageLog       = new Map();
    /** @type {import('./map-scanner.js').MapScanner|null} */
    this.mapScanner       = null;
    this.damageFlashTimer = 0;
    this._lastMatchSyncMs  = 0;

    // ── Scene objects ─────────────────────────────────────
    /** @type {Bot[]} */ this.bots = [];
    /** @type {SyncedBot[]} */ this.syncedBots = [];
    this.lastBotSyncMs = 0;

    // ── Systems (created in start()) ──────────────────────
    /** @type {HUD}            */ this.hud       = null;
    /** @type {WeaponSystem}   */ this.weapon    = null;
    /** @type {ParticleSystem} */ this.particles = null;
    /** @type {GrenadeSystem}   */ this.grenades  = null;

    /** @type {import('./lodibidon.js').LodibidonController|null} */
    this.lodibidon = null;
    /** Rotates lodibidon spawn slots each round. */
    this._lodibidonSpawnRotation = 0;

    // ── Input ─────────────────────────────────────────────
    this.keys      = new Set();
    this.mouseDown = false;
    this._emptyClickPlayed = false;
    this._lastScrollWeaponSwapMs = 0;

    // Raycaster shared across all shots
    this.raycaster    = new THREE.Raycaster();
    this._hitWorldPos = new THREE.Vector3();
    this._fwdVec      = new THREE.Vector3();
    this._rgtVec      = new THREE.Vector3();
    this._muzzlePos   = new THREE.Vector3();
    this._muzzleDir   = new THREE.Vector3();
    this._camDir      = new THREE.Vector3();
    this._lodibidonMatchOverActive = false;
    this._lodibidonLastOneVoicePlayed = false;
    this._lodibidonRoundEndSoundRound = -1;
    this._classicMatchOverActive = false;
    this._lastClassicSyncMs = 0;
    this.mapId = opts.mapId ?? DEFAULT_MAP_ID;
    /** @type {ClassicMatchController|null} */     this.classicMatch = null;
    this.raycaster.far = 80;

    // Bound handlers stored for clean removal
    this._onKeyDown  = this._handleKeyDown.bind(this);
    this._onKeyUp    = this._handleKeyUp.bind(this);
    this._onMouseDn  = this._handleMouseDown.bind(this);
    this._onMouseUp  = this._handleMouseUp.bind(this);
    this._onWheel     = this._handleWheel.bind(this);
    this._onCtxMenu  = e => e.preventDefault();
    this._onResize   = this._handleResize.bind(this);
    this._onCanvasPointerDown = this._handleCanvasPointerDown.bind(this);
  }

  // ═══════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════

  async start() {
    this.spawns.reset();
    this.pickups.reset();
    this.bots = [];
    this.syncedBots = [];
    this.remotes.clear();
    this._lodibidonSpawnRotation = 0;
    this._lodibidonMatchOverActive = false;
    this._lodibidonLastOneVoicePlayed = false;
    this._lodibidonRoundEndSoundRound = -1;
    this._classicMatchOverActive = false;
    this._lastClassicSyncMs = 0;
    this._pointerLockEngaged = false;
    this._lockAcquiredAt = 0;
    this.classicMatch = null;
    this._initRenderer();
    this._initScene();

    await this._preloadMapModels();

    if (this.editorMode) {
      await this._startEditorSession();
      return;
    }

    this._initMap();
    this.weaponPickups = new WeaponPickupManager(this.scene);
    this.weaponPickups.initMapPickups(this.map.groundWeapons);
    this.weaponPickups.resetMapPickups();
    this.weaponPickups.clearGround();
    this.magPickups = new MagPickupManager(this.scene);
    this.magPickups.initMapPickups(this.map.groundMags);
    this.magPickups.resetMapPickups();
    this.magPickups.clearGround();
    this.mapScanner = new MapScanner(this.map.width, this.map.height, MAP_SCAN_RADIUS);

    if (LodibidonController.isMode(this.opts)) {
      this._initSystems();
      this.lodibidon = new LodibidonController(this);
      if (this.mp) {
        const me = this.mp.players.get(this.mp.uid);
        if (me?.team) this.lodibidon.playerTeam = me.team;
      }
      if (this.mp) this._setupMultiplayer();
      this._initPlayer();
      if (this.mp) this._bootstrapMultiplayerState();
      this.hud.showLodibidonMode(true);
      this.hud.setLodibidonScore({ alpha: 0, omega: 0 }, 1);
      this._bindInput();
      if (!this._isMpClient()) this._initLodibidonBots();
      if (!this._isMpClient()) {
        this.lodibidon.startRound();
        this.mp?.syncMatch(this.lodibidon.buildMatchState());
      }
    } else {
      this._initSystems();
      this.classicMatch = new ClassicMatchController(this);
      if (this.mp) this._setupMultiplayer();
      this.spawns.initPlayerSpawnSlot();
      this._initPlayer();
      if (this.mp) this._bootstrapMultiplayerState();
      this._bindInput();
      if ((this.opts.botCount ?? 0) > 0) this._initBots(this.opts.botCount);
      if (!this._isMpClient()) this.classicMatch.start();
    }

    this.hud.show();
    document.getElementById('pointer-lock-overlay').classList.add('hidden');
    this.running = true;
    this._loop();
    this.tryPointerLock();
  }

  /** Toggle map editor overlay (Backtick or Ctrl+M). */
  toggleEditorMode() {
    if (this.mapEditor.active) {
      this.mapEditor.exit();
      if (!this.editorMode) {
        this._bindInput();
        this.tryPointerLock();
      }
    } else {
      this.controls?.unlock();
      this._unbindInput();
      this.mapEditor.enter({ overlayOnly: !this.editorMode });
    }
  }

  /** Leave editor and return to main menu. */
  exitEditorToMenu() {
    this.mapEditor.exit();
    this.stop({ leaveRoom: false });
    document.getElementById('menu-overlay').style.display = '';
    document.getElementById('map-editor-panel')?.classList.add('hidden');
  }

  async _preloadMapModels() {
    setModelTools(await initMapModels());
  }

  async _startEditorSession() {
    this.hud = new HUD();
    this.hud.hide();
    this.map = new MapGenerator();
    this.map.generateFromEditorData(createEmptyMapData());
    this.map.buildScene(this.scene);
    await this.mapEditor.enter();
    document.getElementById('pointer-lock-overlay')?.classList.add('hidden');
    this.running = true;
    this._loop();
  }

  /** Request pointer lock (call from launch click or canvas mousedown). */
  tryPointerLock() {
    if (this.mapEditor?.active) return;
    if (!this.controls || !this.running) return;
    if (this._isLodibidonMatchOver() || this._isClassicMatchOver()) return;
    if (!this.alive && !this.lodibidon?.spectating) return;
    if (this.controls.isLocked) return;
    this.controls.lock();
  }

  /** @param {{ leaveRoom?: boolean }} [opts] */
  stop(opts = {}) {
    const { leaveRoom = true } = opts;
    sound.stopAmbiance();
    sound.stopTacticalSprintLoop();
    this.running = false;
    this.mapEditor?.exit();
    this.controls?.unlock();
    this._unbindInput();
    this.bots.forEach(b => this.scene?.remove(b.mesh));
    this.bots = [];
    this.syncedBots.forEach(b => b.dispose());
    this.syncedBots = [];
    this.remotes.clear();
    this.spawns.reset();
    this._lodibidonMatchOverActive = false;
    this._lodibidonLastOneVoicePlayed = false;
    this._lodibidonRoundEndSoundRound = -1;
    this.lodibidon?.dispose();
    this.lodibidon = null;
    this.classicMatch?.dispose();
    this.classicMatch = null;
    this.particles?.dispose();
    this.renderer?.dispose();
    this.scene = null;
    if (leaveRoom) void this.mp?.leave();
    this.hud?.hide();

    this._setPauseOverlayMode('pause');
    document.getElementById('pointer-lock-overlay').classList.add('hidden');
    document.getElementById('death-screen').classList.add('hidden');
    document.getElementById('lodibidon-match-over')?.classList.add('hidden');
    document.getElementById('classic-match-over')?.classList.add('hidden');
    document.getElementById('lodibidon-round-end')?.classList.add('hidden');
    document.getElementById('lodibidon-spectate')?.classList.add('hidden');
    document.getElementById('lodibidon-prep')?.classList.add('hidden');
    document.getElementById('scope-overlay').classList.add('hidden');
    document.getElementById('crosshair').classList.remove('hidden');
  }

  /** Called from in-game pause panel. */
  changeWeapon(key) {
    this.weapon.equip(key);
    this._applyADSState(false);
    this.mp?.updateWeapon(key);
  }

  /** @param {'pause'} mode */
  _setPauseOverlayMode(mode) {
    const plo = document.getElementById('pointer-lock-overlay');
    const title = document.getElementById('plo-title');
    const pauseContent = document.getElementById('plo-pause-content');
    const controls = plo?.querySelector('.plo-controls');
    if (!plo || mode !== 'pause') return;

    plo.classList.remove('plo--click');
    if (title) title.textContent = 'PAUSED';
    pauseContent?.classList.remove('hidden');
    controls?.classList.add('hidden');
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
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
    let mapId = this.mp?.mapId ?? this.mapId ?? DEFAULT_MAP_ID;
    if (!isValidMapId(mapId)) mapId = DEFAULT_MAP_ID;
    this.mapId = mapId;
    this.map = new MapGenerator(mapId).generate(mapId);
    this.map.buildScene(this.scene);
    const mapName = getMapGameplay(mapId).meta.name;
    const tag = document.getElementById('hud-map-tag');
    if (tag) tag.textContent = mapName;
  }

  _initPlayer() {
    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.controls.pointerSpeed = this.opts.sensitivity * 0.42;
    this.scene.add(this.camera);

    if (LodibidonController.isMode(this.opts)) {
      const sp = this._getLodibidonPlayerSpawn();
      this.spawns.placePlayerAtWithYaw(sp.x, sp.z, this.map.lodibidonCenter.x, this.map.lodibidonCenter.z);
    } else {
      const sp = this.spawns.getSpawnPos(this.spawns.playerSpawnSlot);
      this.spawns.placePlayerAt(sp.x, sp.z);
    }

    this._pushLocalSpawnToNetwork();

    const plo = document.getElementById('pointer-lock-overlay');
    this.renderer.domElement.addEventListener('mousedown', this._onCanvasPointerDown);

    this.controls.addEventListener('lock', () => {
      this._pointerLockEngaged = true;
      this._lockAcquiredAt = performance.now();
      plo.classList.add('hidden');
      sound.init().then(() => sound.startAmbiance('city'));
    });
    this.controls.addEventListener('unlock', () => {
      if (!this.running) return;
      if (this._isLodibidonMatchOver()) {
        plo.classList.add('hidden');
        return;
      }
      if (this._isClassicMatchOver()) {
        plo.classList.add('hidden');
        return;
      }
      if (!this.alive) return;
      if (!this._pointerLockEngaged) return;
      if (performance.now() - this._lockAcquiredAt < 400) {
        plo.classList.add('hidden');
        return;
      }
      // Tab releases pointer lock in some browsers — don't open pause/settings for that
      if (this._tabHeld) {
        plo.classList.add('hidden');
        return;
      }
      this._setPauseOverlayMode('pause');
      plo.classList.remove('hidden');
    });
  }

  _handleCanvasPointerDown(e) {
    if (e.button !== 0) return;
    if (!this.running) return;
    if (this._isLodibidonMatchOver() || this._isClassicMatchOver()) return;
    if (!this.alive && !this.lodibidon?.spectating) return;
    if (!this.controls?.isLocked) this.tryPointerLock();
  }

  _initSystems() {
    // HUD
    this.hud = new HUD(
      this.username,
      this.mode === 'multi' && this.mp ? this.mp.roomCode : '',
    );
    this.hud.initMinimapBasemap(this.map.mapGrid);
    this.hud.setHealth(this.health);
    this.hud.setScore(this.kills, this.deaths);

    // WeaponSystem — wire callbacks so it drives HUD updates
    this.weapon = new WeaponSystem(
      this.camera, this.opts.weapon, this.opts.fov, this.opts.adsMode,
    );
    this.weapon.onAmmoChanged    = () => this.hud.setAmmo(this.weapon.ammo, this.weapon.reserve);
    this.weapon.onWeaponChanged  = name => this.hud.setAmmo(this.weapon.ammo, this.weapon.reserve, name);
    this.weapon.onSlotChanged    = slot => this.hud.setWeaponSlot(slot, this.weapon.slotOccupancy());
    this.weapon.onReloadStart    = () => this.hud.showReloadBar(this.weapon.def.reloadTime);
    this.weapon.onReloadComplete = () => this.hud.hideReloadBar();
    this.hud.setAmmo(this.weapon.ammo, this.weapon.reserve, this.weapon.def.name);
    this.hud.setWeaponSlot(this.weapon.activeSlot, this.weapon.slotOccupancy());

    // Particles
    this.particles = new ParticleSystem(this.scene);
    this.weapon.onMuzzleEffects = (pos, dir) => {
      this.particles.spawnMuzzleFlash(pos, dir);
    };

    this.grenades = new GrenadeSystem(this.camera, this.scene, this.weapon, {
      onExplosionDamage: (center, source, authoritative) =>
        applyGrenadeDamage(this, center, source, authoritative),
      broadcastThrow: (data) => {
        this.mp?.sendWorldEvent({ type: 'grenade_throw', ...data });
      },
      broadcastExplode: (center) => {
        this.mp?.sendWorldEvent({
          type: 'grenade_explode',
          x: center.x, y: center.y, z: center.z,
        });
      },
      getBots:      () => (this._isMpClient() ? this.syncedBots : this.bots),
      getMap:       () => this.map,
      getParticles: () => this.particles,
    });
    this.hud.setGrenades(this.grenades.count);
  }

  /** Push spawn position to Firebase immediately so other clients see us. */
  _pushLocalSpawnToNetwork() {
    if (!this.mp || !this.mapScanner || !this.camera) return;
    this.lastSyncMs = 0;
    this._syncLocalPlayerPosition(performance.now());
    this.mp.updateHealth(this.health);
  }

  _recordDamage(targetKey, shooterUid = null) {
    const uid = shooterUid ?? this.mp?.uid;
    if (!uid) return;
    const list = this._damageLog.get(targetKey) ?? [];
    list.push({ uid, t: performance.now() });
    this._damageLog.set(targetKey, list);
  }

  /** Live enemy positions for minimap radar sweep. */
  _collectMinimapEnemies() {
    const out = [];
    const myTeam = this.lodibidon?.playerTeam;
    const sources = this._isMpClient() ? this.syncedBots : this.bots;
    for (const b of sources) {
      if (!b?.alive) continue;
      if (myTeam && b.team === myTeam) continue;
      out.push({ x: b.mesh.position.x, z: b.mesh.position.z, color: '#ff4444' });
    }
    for (const rp of this.remotePlayers.values()) {
      if (!rp.mesh.visible) continue;
      if (myTeam && rp.data.team === myTeam) continue;
      out.push({ x: rp.mesh.position.x, z: rp.mesh.position.z, color: '#4488ff' });
    }
    return out;
  }

  _consumeAssists(targetKey) {
    const list = this._damageLog.get(targetKey) ?? [];
    const now  = performance.now();
    const uids = new Set();
    for (const e of list) {
      if (now - e.t > ASSIST_WINDOW_MS) continue;
      if (e.uid === this.mp?.uid) continue;
      uids.add(e.uid);
    }
    this._damageLog.delete(targetKey);
    return [...uids];
  }

  /** @param {'alpha'|'omega'} team */
  _lodibidonTeamRoster(team, includeBots = true) {
    /** @type {{ kind:'local'|'remote'|'bot', uid?:string, botIndex?:number }[]} */
    const roster = [];
    if (this.mp) {
      for (const [uid, p] of [...this.mp.players.entries()]
        .filter(([, pl]) => pl.team === team)
        .sort(([a], [b]) => a.localeCompare(b))) {
        roster.push({ kind: uid === this.mp.uid ? 'local' : 'remote', uid });
      }
    } else if (team === this.lodibidon?.playerTeam) {
      roster.push({ kind: 'local' });
    }
    if (includeBots) {
      const botSource = this._isMpClient() ? this.syncedBots : this.bots;
      for (const bot of botSource.filter(b => b && b.team === team).sort((a, b) => a.index - b.index)) {
        roster.push({ kind: 'bot', botIndex: bot.index });
      }
    }
    return roster;
  }

  /** @param {'alpha'|'omega'} team @param {number} memberIndex */
  _lodibidonSpawnForMember(team, memberIndex) {
    const spawns = this.map.lodibidonSpawns[team];
    const slot = (memberIndex + (this._lodibidonSpawnRotation ?? 0)) % spawns.length;
    return spawns[slot];
  }

  /** @returns {{ x:number, z:number }} */
  _getLodibidonPlayerSpawn() {
    const team = this.lodibidon?.playerTeam ?? this.opts.team ?? 'alpha';
    const roster = this._lodibidonTeamRoster(team, true);
    let idx = roster.findIndex(m => m.kind === 'local');
    if (idx < 0 && this.mp) {
      idx = roster.findIndex(m => m.uid === this.mp.uid);
    }
    return this._lodibidonSpawnForMember(team, Math.max(0, idx));
  }

  /** Match-end stats grouped by team. */
  getLodibidonMatchStats() {
    /** @type {{ name:string, kills:number, deaths:number, assists:number, isSelf?:boolean }[]} */
    const alpha = [];
    /** @type {{ name:string, kills:number, deaths:number, assists:number, isSelf?:boolean }[]} */
    const omega = [];
    const push = (team, row) => {
      (team === 'alpha' ? alpha : omega).push(row);
    };

    const pt = this.lodibidon?.playerTeam ?? 'alpha';
    push(pt, {
      name: this.username,
      kills: this.kills,
      deaths: this.deaths,
      assists: 0,
      isSelf: true,
    });

    if (this.mp) {
      for (const [uid, p] of this.mp.players) {
        if (uid === this.mp.uid) continue;
        if (p.team !== 'alpha' && p.team !== 'omega') continue;
        push(p.team, {
          name: p.name ?? 'Player',
          kills: p.kills ?? 0,
          deaths: p.deaths ?? 0,
          assists: p.assists ?? 0,
        });
      }
    }

    const botList = this._isMpClient() ? this.syncedBots : this.bots;
    for (const bot of botList) {
      if (!bot?.team) continue;
      push(bot.team, {
        name: `Bot-${(bot.index ?? 0) + 1}`,
        kills: bot.kills ?? 0,
        deaths: bot.deaths ?? 0,
        assists: bot.assists ?? 0,
        isBot: true,
      });
    }

    return { alpha, omega, playerTeam: pt };
  }

  _updateLodibidonAliveHud() {
    if (!this.lodibidon) return;
    const phase = this.lodibidon.phase;
    if (phase === 'prep' || phase === 'round_end' || phase === 'match_over') {
      this.hud.setLodibidonAlive(null);
      return;
    }
    const pt = this.lodibidon.playerTeam;
    const ally = this._lodibidonTeamAliveCount(pt);
    const enemy = this._lodibidonTeamAliveCount(enemyTeam(pt));
    if (ally >= 2 && enemy >= 2) {
      this.hud.setLodibidonAlive(null);
    } else {
      this.hud.setLodibidonAlive(ally, enemy);
    }
  }

  _initLodibidonBots() {
    const baseCfg = BOT_LEVELS[this.opts.botLevel ?? 'corporal'] ?? BOT_LEVELS.corporal;
    const cfg = {
      ...baseCfg,
      hitBase: Math.min(0.94, baseCfg.hitBase + LODIBIDON_BOT_HIT_BONUS),
    };
    const center = this.map.lodibidonCenter;
    const humans = { alpha: 0, omega: 0 };

    if (this.mp) {
      for (const p of this.mp.players.values()) {
        if (p.team === 'alpha') humans.alpha++;
        else if (p.team === 'omega') humans.omega++;
      }
    } else {
      humans[this.lodibidon.playerTeam]++;
    }

    let botIdx = 0;
    for (const team of /** @type {const} */ (['alpha', 'omega'])) {
      const need = 2 - humans[team];
      const labelRole = team === this.lodibidon.playerTeam ? 'ally' : 'enemy';
      for (let i = 0; i < need; i++) {
        const memberIndex = humans[team] + i;
        const sp = this._lodibidonSpawnForMember(team, memberIndex);
        const onSound = (key, pos, opts) => this._playWorldSound(key, pos, opts);
        const onShoot = this._makeBotShootHandler(botIdx);
        const bot = new Bot(
          this.scene, sp, this.map, botIdx, cfg, onSound, 0, onShoot,
          { bodyTeam: team, labelRole },
        );
        bot.team = team;
        bot.noRespawn = true;
        bot.mesh.rotation.y = yawToward(sp.x, sp.z, center.x, center.z);
        bot.entity.spawnPos = { x: sp.x, z: sp.z };
        bot.loco.spawnPos = { x: sp.x, z: sp.z };
        bot.loco.nudgeFromSpawn();
        this.bots.push(bot);
        botIdx++;
      }
    }
  }

  /** Host sim bots or client network proxies — whichever this peer uses. */
  _lodibidonBots() {
    return this._isMpClient()
      ? this.syncedBots.filter(Boolean)
      : this.bots;
  }

  /** @param {number} index */
  _getLodibidonBot(index) {
    if (this._isMpClient()) return this.syncedBots[index] ?? null;
    return this.bots[index] ?? null;
  }

  /** @param {'alpha'|'omega'} team */
  _lodibidonTeamAliveCount(team) {
    let n = 0;
    if (team === this.lodibidon?.playerTeam && this.alive) n++;

    for (const bot of this._lodibidonBots()) {
      if (bot.alive && bot.team === team) n++;
    }

    if (this.mp) {
      for (const [uid, p] of this.mp.players) {
        if (uid === this.mp.uid) continue;
        if (p.team === team && (p.alive ?? true)) n++;
      }
    }
    return n;
  }

  _lodibidonResetRound() {
    this._lodibidonSpawnRotation = (this._lodibidonSpawnRotation ?? 0) + 1;
    const center = this.map.lodibidonCenter;
    this.alive = true;
    this.health = MAX_HEALTH;
    this.lodibidon.spectating = false;
    this.lodibidon.spectateTarget = null;
    this.weapon.resetAll();
    this.grenades?.reset();
    this.hud.setHealth(MAX_HEALTH);
    this.hud.hideDeathScreen();
    this.hud.hideLodibidonRoundEnd();
    this.mp?.setSpectating(false);
    this.mp?.updateHealth(MAX_HEALTH);

    const sp = this._getLodibidonPlayerSpawn();
    this.spawns.placePlayerAtWithYaw(sp.x, sp.z, center.x, center.z);

    for (const bot of this.bots) {
      bot.alive = true;
      bot.health = bot.maxHealth;
      bot.entity.health = bot.maxHealth;
      bot.entity.alive = true;
      bot.entity.dying = false;
      resetCharacterDeath(bot.entity.rig, bot.entity.mesh);
      resetCharacterPose(bot.entity.rig);
      bot.mesh.visible = true;
      const team = bot.team;
      const roster = this._lodibidonTeamRoster(team, true);
      const memberIdx = roster.findIndex(m => m.kind === 'bot' && m.botIndex === bot.index);
      const spawn = this._lodibidonSpawnForMember(team, Math.max(0, memberIdx));
      bot.mesh.position.set(spawn.x, 0, spawn.z);
      bot.mesh.rotation.y = yawToward(spawn.x, spawn.z, center.x, center.z);
      bot.entity.spawnPos = { x: spawn.x, z: spawn.z };
      bot.loco.spawnPos = { x: spawn.x, z: spawn.z };
      bot.loco.nudgeFromSpawn();
      bot.loco.stuckTime = 0;
      bot.brain.reset();
    }

    this.hud.setLodibidonAlive(null);
    this._lodibidonLastOneVoicePlayed = false;

    // Host advances phase/timer; clients mirror via applyMatchState only.
    if (this._isMpClient()) {
      setTimeout(() => { if (this.running && this.alive) this.tryPointerLock(); }, 150);
      return;
    }

    this.lodibidon.startRound();
    this.mp?.syncMatch(this.lodibidon.buildMatchState());
    setTimeout(() => { if (this.running && this.alive) this.tryPointerLock(); }, 150);
  }

  _getBotCombatTarget(bot) {
    if (!this._isLodibidon()) {
      /** @type {{ x:number, z:number, isPlayer?: boolean, playerUid?: string }[]} */
      const enemies = [];

      if (this.alive) {
        enemies.push({
          x: this.camera.position.x,
          z: this.camera.position.z,
          isPlayer: true,
        });
      }

      for (const [uid, rp] of this.remotePlayers) {
        if (!(rp.data.alive ?? true)) continue;
        enemies.push({
          x: rp.mesh.position.x,
          z: rp.mesh.position.z,
          isPlayer: true,
          playerUid: uid,
        });
      }

      if (!enemies.length) return null;

      const bx = bot.mesh.position.x;
      const bz = bot.mesh.position.z;
      let best = enemies[0];
      let bestD = Infinity;
      for (const e of enemies) {
        const d = (e.x - bx) ** 2 + (e.z - bz) ** 2;
        if (d < bestD) { bestD = d; best = e; }
      }
      return best;
    }

    const phase = this.lodibidon.phase;
    if (phase === 'prep' || phase === 'round_end' || phase === 'match_over') {
      return null;
    }

    /** @type {{ x:number, z:number, bot?: import('./bots/host-bot.js').Bot, isPlayer?: boolean }[]} */
    const enemies = [];

    if (this.alive && bot.team !== this.lodibidon.playerTeam) {
      enemies.push({
        x: this.camera.position.x,
        z: this.camera.position.z,
        isPlayer: true,
      });
    }

    for (const b of this.bots) {
      if (b !== bot && b.alive && b.team !== bot.team) {
        enemies.push({
          x: b.mesh.position.x,
          z: b.mesh.position.z,
          bot: b,
        });
      }
    }

    for (const [uid, rp] of this.remotePlayers) {
      if (!(rp.data.alive ?? true)) continue;
      if (rp.data.team && rp.data.team !== bot.team) {
        enemies.push({
          x: rp.mesh.position.x,
          z: rp.mesh.position.z,
          isPlayer: true,
          playerUid: uid,
        });
      }
    }

    if (!enemies.length) return null;

    let best = enemies[0];
    let bestD = Infinity;
    const bx = bot.mesh.position.x;
    const bz = bot.mesh.position.z;
    for (const e of enemies) {
      const d = (e.x - bx) ** 2 + (e.z - bz) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  _lodibidonLabelOpts(entityTeam) {
    if (!this._isLodibidon()) return {};
    const isAlly = entityTeam === this.lodibidon.playerTeam;
    return {
      alwaysShow: isAlly,
      skipLos:    isAlly,
    };
  }

  _applyBotHit(attacker, damage, target) {
    if (!target) return;
    if (target.isPlayer) {
      if (this._isLodibidon() && attacker.team === this.lodibidon.playerTeam) return;
      const killerName = `Bot-${attacker.index + 1}`;
      if (target.playerUid && this.mp) {
        this.mp.sendHit(target.playerUid, damage, {
          killerName,
          botIndex: attacker.index,
        });
        return;
      }
      this.takeDamage(damage, killerName);
      return;
    }
    if (target.bot && target.bot.alive) {
      const killed = target.bot.takeDamage(damage);
      if (killed) this._onBotEliminated(target.bot, false, attacker);
    }
  }

  /** @param {'alpha'|'omega'} team */
  _lodibidonKillerTeam(killerName) {
    const bot = this._botFromKillName(killerName);
    if (bot?.team) return bot.team;
    if (this.mp) {
      for (const [, p] of this.mp.players) {
        if (p.name === killerName && (p.team === 'alpha' || p.team === 'omega')) return p.team;
      }
    }
    return enemyTeam(this.lodibidon.playerTeam);
  }

  _lodibidonVictimTeam(victimName, victimUid = null) {
    const bot = this._botFromKillName(victimName);
    if (bot?.team) return bot.team;
    if (victimUid && this.mp) {
      const p = this.mp.players.get(victimUid);
      if (p?.team === 'alpha' || p?.team === 'omega') return p.team;
    }
    for (const rp of this.remotePlayers.values()) {
      if (rp.data.name === victimName && (rp.data.team === 'alpha' || rp.data.team === 'omega')) {
        return rp.data.team;
      }
    }
    return enemyTeam(this.lodibidon.playerTeam);
  }

  /**
   * @param {'alpha'|'omega'|null} killerTeam
   * @param {'alpha'|'omega'} victimTeam
   */
  _lodibidonOnElimination(killerTeam, victimTeam, opts = {}) {
    if (!this._isLodibidon() || !victimTeam) return;
    const pt = this.lodibidon.playerTeam;
    if (!opts.skipTeamSting) {
      if (killerTeam && killerTeam !== victimTeam) {
        sound.playLodibidonTeamKill(killerTeam === pt);
      } else if (!killerTeam) {
        sound.playLodibidonTeamKill(victimTeam !== pt);
      }
    }
    this._checkLodibidonLastOneStanding();
  }

  _checkLodibidonLastOneStanding() {
    if (!this.lodibidon || this._lodibidonLastOneVoicePlayed) return;
    if (this.lodibidon.phase === 'prep' || this.lodibidon.phase === 'round_end'
        || this.lodibidon.phase === 'match_over') return;
    const pt = this.lodibidon.playerTeam;
    if (this._lodibidonTeamAliveCount(pt) === 1 && this.alive) {
      this._lodibidonLastOneVoicePlayed = true;
      sound.playLastOneStanding();
    }
  }

  _playLodibidonRoundEndSound(round) {
    if (this._lodibidonRoundEndSoundRound === round) return;
    this._lodibidonRoundEndSoundRound = round;
    this.hud?.cancelMedal();
    sound.playLodibidonRoundEnd();
  }

  /** Skip kill confirm when round is over or this kill ends the round (elimination). */
  _lodibidonShouldSkipKillConfirm(victimTeam = null) {
    if (!this.lodibidon) return false;
    const phase = this.lodibidon.phase;
    if (phase === 'round_end' || phase === 'match_over') return true;
    if (victimTeam && this._lodibidonTeamAliveCount(victimTeam) === 0) return true;
    return false;
  }

  _isLodibidon() { return !!this.lodibidon; }

  _isLodibidonMatchOver() {
    return this.lodibidon?.phase === 'match_over' || this._lodibidonMatchOverActive;
  }

  _isClassicMatchOver() {
    return this.classicMatch?.isOver() || this._classicMatchOverActive;
  }

  /** Unlock pointer and show final FFA standings. */
  _enterClassicMatchOver() {
    if (this._classicMatchOverActive) return;
    this._classicMatchOverActive = true;
    this.mouseDown = false;
    this.keys.clear();
    this.controls?.unlock();
    document.getElementById('pointer-lock-overlay')?.classList.add('hidden');
    document.getElementById('death-screen')?.classList.add('hidden');
    this.hud?.cancelMedal();
    sound.stopVoiceAndMedals();
    sound.playClassicMatchEnd();

    const rows = this._getLeaderboardRows().rows ?? [];
    const winner = rows[0]?.name ?? '—';
    this.hud.showClassicMatchOver(rows, winner);
  }

  /** Unlock pointer, hide pause panel — match-end scoreboard needs mouse. */
  _enterLodibidonMatchOver() {
    if (this._lodibidonMatchOverActive) return;
    this._lodibidonMatchOverActive = true;
    this.mouseDown = false;
    this.keys.clear();
    this.controls?.unlock();
    document.getElementById('pointer-lock-overlay')?.classList.add('hidden');
    this.hud?.hideLodibidonRoundEnd();
    this.hud?.cancelMedal();
    sound.stopVoiceAndMedals();
    sound.playLodibidonMatchEnd();
  }

  /** World-space muzzle flash from a character standing at x/z facing rotY. */
  _playWorldMuzzleFlash(x, z, rotY, y = 1.12) {
    if (!this.particles) return;
    this._muzzleDir.set(Math.sin(rotY), 0, Math.cos(rotY));
    this._muzzlePos.set(x, y, z).addScaledVector(this._muzzleDir, 0.62);
    this.particles.spawnMuzzleFlash(this._muzzlePos, this._muzzleDir);
  }

  _playCharacterMuzzleFlash(mesh) {
    if (!mesh) return;
    this._playWorldMuzzleFlash(mesh.position.x, mesh.position.z, mesh.rotation.y);
  }

  _makeBotShootHandler(botIdx) {
    return () => {
      const b = this.bots[botIdx];
      if (!b?.alive) return;
      this._playCharacterMuzzleFlash(b.mesh);
      if (!this.mp) return;
      this.mp.sendWorldEvent({
        type:     'bot_shot',
        botIndex: botIdx,
        x:        b.mesh.position.x,
        z:        b.mesh.position.z,
        rotY:     b.mesh.rotation.y,
      });
    };
  }

  _isMultiplayer() { return this.mode === 'multi' && !!this.mp; }
  _isMpHost()      { return this._isMultiplayer() && this.mp.isHost; }
  _isMpClient()    { return this._isMultiplayer() && !this.mp.isHost; }

  _canShowLeaderboard() {
    if (this.mp) return true;
    return this.bots.length > 0;
  }

  /** @param {string} name — e.g. `Bot-2` */
  _botFromKillName(name) {
    if (!name?.startsWith('Bot-')) return null;
    const idx = parseInt(name.replace('Bot-', ''), 10) - 1;
    if (Number.isNaN(idx) || idx < 0) return null;
    return this._getLodibidonBot(idx);
  }

  /**
   * @param {import('./bots/host-bot.js').Bot} bot
   * @param {boolean} [isHeadshot]
   * @param {'player'|import('./bots/host-bot.js').Bot|null} [killer='player']
   * @param {{ killerTeam?: string|null, excludeUid?: string|null }} [mpOpts]
   */
  _onBotEliminated(bot, isHeadshot = false, killer = 'player', mpOpts = {}) {
    if (!bot) return;
    bot.deaths++;
    const victimName = `Bot-${bot.index + 1}`;

    if (killer && typeof killer === 'object') {
      killer.kills = (killer.kills ?? 0) + 1;
      this.hud.addKillFeed(`Bot-${killer.index + 1}`, victimName);
      if (this._isLodibidon() && killer.team && bot.team) {
        this._lodibidonOnElimination(killer.team, bot.team);
        this._broadcastLodElim(killer.team, bot.team);
      }
      return;
    }

    if (killer === 'player') {
      this._onKill(victimName, isHeadshot);
      if (this._isLodibidon() && bot.team) {
        this._broadcastLodElim(this.lodibidon.playerTeam, bot.team, this.mp?.uid ?? null);
      }
      return;
    }

    if (this._isLodibidon() && bot.team) {
      this._lodibidonOnElimination(null, bot.team);
      this._broadcastLodElim(mpOpts.killerTeam ?? null, bot.team, mpOpts.excludeUid ?? null);
    }
  }

  /** Tell MP clients about a bot elimination (host already played locally). */
  _broadcastLodElim(killerTeam, victimTeam, excludeUid = null) {
    if (!this._isMpHost() || !this._isLodibidon()) return;
    this.mp.sendWorldEvent({
      type:       'lod_elim',
      killerTeam,
      victimTeam,
      excludeUid,
    });
  }

  _sortLeaderboardRows(rows) {
    return [...rows].sort((a, b) => {
      const ra = a.kills / Math.max(1, a.deaths);
      const rb = b.kills / Math.max(1, b.deaths);
      return b.kills - a.kills || rb - ra;
    });
  }

  _getLeaderboardRows() {
    if (this._isLodibidon()) {
      const stats = this.getLodibidonMatchStats();
      return {
        teamMode:   true,
        playerTeam: stats.playerTeam,
        alpha:      this._sortLeaderboardRows(stats.alpha),
        omega:      this._sortLeaderboardRows(stats.omega),
      };
    }

    const rows = this.mp
      ? this.mp.getLeaderboardRows()
      : [{
          name:    this.username,
          kills:   this.kills,
          deaths:  this.deaths,
          assists: 0,
          ratio:   this.kills / Math.max(1, this.deaths),
          isSelf:  true,
        }];

    const botList = this._isMpClient() ? this.syncedBots : this.bots;
    for (const bot of botList) {
      if (!bot) continue;
      const idx = bot.index ?? 0;
      const k = bot.kills ?? 0;
      const d = bot.deaths ?? 0;
      rows.push({
        name:    `Bot-${idx + 1}`,
        kills:   k,
        deaths:  d,
        assists: bot.assists ?? 0,
        ratio:   k / Math.max(1, d),
        isSelf:  false,
        isBot:   true,
      });
    }

    return { teamMode: false, rows: this._sortLeaderboardRows(rows) };
  }

  _initBots(count) {
    if (this._isMpClient()) {
      for (let i = 0; i < count; i++) {
        const sb = this._makeSyncedBot(i);
        sb.mesh.visible = false;
        this.syncedBots[i] = sb;
      }
      return;
    }

    const cfg  = BOT_LEVELS[this.opts.botLevel ?? 'corporal'] ?? BOT_LEVELS.corporal;
    const half = this.spawns.spawnHalf();
    for (let i = 0; i < count; i++) {
      const slot = this.spawns.claimLeastCrowdedSpawn(half, half + count);
      const sp        = this.spawns.getSpawnPos(slot);
      const onSound   = (key, pos, opts) => this._playWorldSound(key, pos, opts);
      const onShoot   = this._makeBotShootHandler(i);
      this.bots.push(new Bot(this.scene, sp, this.map, i, cfg, onSound, slot, onShoot));
    }
  }

  _applyBotsSnapshot(data) {
    for (const [key, state] of Object.entries(data)) {
      const idx = Number(key);
      if (Number.isNaN(idx)) continue;
      if (!this.syncedBots[idx]) {
        this.syncedBots[idx] = this._makeSyncedBot(idx);
      }
      this.syncedBots[idx].applyState(state);
    }
    this._syncSyncedBotPlayerTeam();
  }

  _makeSyncedBot(index) {
    return new SyncedBot(this.scene, this.map, index, {
      playerTeam: this.lodibidon?.playerTeam ?? null,
    });
  }

  _syncSyncedBotPlayerTeam() {
    const team = this.lodibidon?.playerTeam ?? null;
    for (const sb of this.syncedBots) {
      sb?.setPlayerTeam(team);
    }
  }

  _syncBotsToFirebase(nowMs) {
    if (!this._isMpHost() || nowMs - this.lastBotSyncMs < BOT_SYNC_INTERVAL) return;
    this.lastBotSyncMs = nowMs;
    const payload = {};
    this.bots.forEach((bot, i) => {
      payload[String(i)] = bot.getSyncState();
    });
    this.mp.syncBots(payload);
  }

  _handleWorldEvent(evt) {
    if (evt.type === 'bot_kill') {
      if (evt.shooter === this.mp?.uid) {
        this._onKill(`Bot-${evt.botIndex + 1}`, false);
      }
      return;
    }

    if (evt.shooter === this.mp?.uid) {
      if (evt.type === 'shot' || evt.type === 'bot_shot' || evt.type === 'grenade_throw') {
        return;
      }
    }

    switch (evt.type) {
      case 'shot': {
        const snd = { assault_rifle: 'ar_shoot', ak47: 'ar_shoot', shotgun: 'sg_shoot', sniper: 'sn_shoot', pistol: 'ar_shoot' }[evt.weapon] ?? 'ar_shoot';
        this._playWorldSound(snd, { x: evt.x, y: evt.y ?? 1.2, z: evt.z }, { volume: 0.58, maxDist: 42 });
        this._playWorldMuzzleFlash(evt.x, evt.z, evt.rotY ?? 0, evt.y ?? 1.2);
        break;
      }
      case 'bot_shot':
        this._playWorldSound('ar_shoot', { x: evt.x, y: 1.2, z: evt.z }, { volume: 0.65, maxDist: 38 });
        this._playWorldMuzzleFlash(evt.x, evt.z, evt.rotY ?? 0);
        break;
      case 'bot_hit':
        if (this._isMpHost()) {
          const bot = this.bots[evt.botIndex];
          if (bot?.alive) {
            this._recordDamage(`bot:${evt.botIndex}`, evt.shooter);
            const killed = bot.takeDamage(evt.damage);
            if (killed) {
              const killer = evt.shooter === this.mp.uid ? 'player' : null;
              const shooterTeam = this.mp.players.get(evt.shooter)?.team ?? null;
              this._onBotEliminated(bot, false, killer, {
                killerTeam: killer ? undefined : shooterTeam,
                excludeUid: evt.shooter,
              });
              if (evt.shooter !== this.mp.uid) {
                this.mp.sendWorldEvent({
                  type:     'bot_kill',
                  botIndex: evt.botIndex,
                  shooter:  evt.shooter,
                });
              }
            }
          }
        }
        break;
      case 'lod_elim':
        if (this._isMpClient() && this._isLodibidon() && evt.excludeUid !== this.mp.uid) {
          this._lodibidonOnElimination(evt.killerTeam ?? null, evt.victimTeam);
        }
        break;
      case 'grenade_throw':
        if (evt.shooter !== this.mp.uid) {
          this.grenades.spawnRemoteThrow(evt);
        }
        break;
      case 'grenade_explode':
        if (evt.shooter !== this.mp.uid) {
          const killer = this.mp.players.get(evt.shooter)?.name ?? 'Grenade';
          this.grenades.handleRemoteExplode(
            new THREE.Vector3(evt.x, evt.y ?? 0.2, evt.z),
            killer,
          );
        }
        break;
      case 'wall_weapon_taken':
      case 'weapon_pickup_removed':
        this.weaponPickups?.remove(evt.id);
        this.pickups.onWeaponPickupRemoved(evt.id);
        break;
      case 'weapon_ground_spawn':
        this.pickups.spawnGroundPickupFromNetwork(evt);
        break;
      case 'mag_pickup_removed':
        this.magPickups?.remove(evt.id);
        this.pickups.onMagPickupRemoved(evt.id);
        break;
      case 'mag_ground_spawn':
        this.pickups.spawnGroundMagFromNetwork(evt);
        break;
      default:
        break;
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

  /** Push local x/y/z (+ rot) to Firebase on a fixed interval. */
  _syncLocalPlayerPosition(nowMs) {
    if (!this.mp || !this.mapScanner) return;
    if (nowMs - this.lastSyncMs < SYNC_INTERVAL) return;
    this.lastSyncMs = nowMs;

    const pos = this.camera.position;
    this.camera.getWorldDirection(this._camDir);
    const dir = this._camDir;
    const { gx, gz } = this.mapScanner.worldToCell(pos.x, pos.z);
    this._lastSyncGx = gx;
    this._lastSyncGz = gz;
    this.mp.updatePosition(pos.x, pos.y, pos.z, Math.atan2(dir.x, dir.z), gx, gz);
  }

  _setupMultiplayer() {
    this.remotes.bindMultiplayer();

    this.mp.onBotsUpdate = data => {
      if (this._isMpClient()) this._applyBotsSnapshot(data);
    };

    this.mp.onWorldEvent = evt => this._handleWorldEvent(evt);

    if (this._isLodibidon()) {
      this.mp.onMatchUpdate = data => {
        const prevRound = this.lodibidon.roundNumber;
        this.lodibidon.applyMatchState(data);
        if (data.round > prevRound && data.phase === 'prep') {
          this._lodibidonResetRound();
        }
      };
    } else if (this.classicMatch) {
      this.mp.onClassicUpdate = data => this.classicMatch.applyState(data);
    }
  }

  /** Seed remotes + match state already on the room when we join mid-start. */
  _bootstrapMultiplayerState() {
    if (!this.mp) return;

    for (const [uid, data] of this.mp.players) {
      if (uid === this.mp.uid) continue;
      this.mp.onPlayerUpdate?.(uid, data);
    }

    if (this.classicMatch && this.mp.roomRef) {
      this.mp.roomRef.child('classic').once('value', snap => {
        const val = snap.val();
        if (val) this.classicMatch.applyState(val);
      });
    }

    this._pushLocalSpawnToNetwork();
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
    if (this.mapEditor?.active) {
      this.mapEditor.update(delta);
      return;
    }

    if (this.lodibidon) {
      if (this._isMpClient()) {
        this.lodibidon._updateSpectate();
        this.lodibidon.syncHudTimers();
      } else {
        this.lodibidon.tick(delta, nowMs);
        if (this._isMpHost() && nowMs - this._lastMatchSyncMs > 150) {
          this._lastMatchSyncMs = nowMs;
          this.mp.syncMatch(this.lodibidon.buildMatchState());
        }
      }
      if (this.lodibidon.phase === 'match_over') {
        this._enterLodibidonMatchOver();
        this._updateBots(delta, nowMs);
        this.particles.update(delta);
        this.remotes.update(delta);
        this.mapScanner?.scan(this.camera.position.x, this.camera.position.z);
        this._syncLocalPlayerPosition(nowMs);
        return;
      }
    }

    if (this.classicMatch) {
      this.classicMatch.tick(nowMs);
      if (this._isClassicMatchOver()) {
        this._enterClassicMatchOver();
        this._updateBots(delta, nowMs);
        this.particles.update(delta);
        this.remotes.update(delta);
        this.mapScanner?.scan(this.camera.position.x, this.camera.position.z);
        this._syncLocalPlayerPosition(nowMs);
        return;
      }
    }

    if (this.lodibidon?.spectating) {
      this._updateBots(delta, nowMs);
      this._syncBotsToFirebase(nowMs);
      this.remotes.update(delta);
      this.particles.update(delta);
      this._updateMinimapAndHud(nowMs);
      this.mapScanner?.scan(this.camera.position.x, this.camera.position.z);
      return;
    }

    if (!this.alive) {
      this._updateBots(delta, nowMs);
      this.remotes.update(delta);
      this.particles.update(delta);
      this.mapScanner?.scan(this.camera.position.x, this.camera.position.z);
      return;
    }

    const canAct = !this.lodibidon || this.lodibidon.canAct();

    const canActClassic = !this.classicMatch || this.classicMatch.canAct();

    if (canActClassic && canAct && this.mouseDown && this.weapon.def.automatic && this.controls.isLocked) {
      this._tryShoot(nowMs);
    }

    if (canActClassic && canAct) {
      this.movement.updateMovement(delta);
      this.movement.updatePhysics(delta);
    }

    if (!this.lodibidon) this._updateRegen(delta, nowMs);
    this._updateHitShake(delta);

    // Weapon system — receives isMoving for bob, mouseDown for recoil recovery gate
    this.weapon.setHitShake(this._hitShake);
    const sprinting = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && this.isMoving;
    this.weapon.update(delta, this.isMoving, this.mouseDown, sprinting);

    this._updateBots(delta, nowMs);
    this._syncBotsToFirebase(nowMs);
    this.remotes.update(delta);
    if (!this._isLodibidon()) this.pickups.updateInteractZones(delta);
    if (this.grenades) {
      this.grenades.update(delta);
      this.hud.setGrenades(this.grenades.count);
      this.hud.showGrenadePrime(
        this.grenades.isPrimed,
        this.grenades.fuseLeft,
        this.controls.isLocked,
        this.grenades.throwCharge,
      );
    }
    this.particles.update(delta);

    this.mapScanner?.scan(this.camera.position.x, this.camera.position.z);
    this._syncLocalPlayerPosition(nowMs);

    if (this._tabHeld && this._canShowLeaderboard()) {
      this.hud.showLeaderboard(this._getLeaderboardRows());
    }

    // Damage vignette fade-out
    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer -= delta;
      if (this.damageFlashTimer <= 0) this.hud.hideDamageVignette();
    }

    this._updateMinimapAndHud(nowMs);
  }

  _updateMinimapAndHud(nowMs) {
    this.camera.getWorldDirection(this._camDir);
    const dir = this._camDir;
    this.hud.updateMinimap(
      { x: this.camera.position.x, z: this.camera.position.z, dirX: dir.x, dirZ: dir.z },
      nowMs,
      this._collectMinimapEnemies(),
    );
    if (this.lodibidon) this._updateLodibidonAliveHud();
  }

  // ═══════════════════════════════════════════════════════
  //  MOVEMENT & PHYSICS
  // ═══════════════════════════════════════════════════════

  _tryAmmoChestResupply() {
    if (!this.alive || !this.controls.isLocked || !this._nearAmmoChest) return;
    if (performance.now() < this._ammoChestReadyAt) return;
    const ammoFull     = !this.weapon.needsResupply();
    const grenadesFull = (this.grenades?.count ?? 0) >= GRENADE_MAX;
    if (ammoFull && grenadesFull) return;

    if (!ammoFull) this.weapon.refillAmmo();
    if (!grenadesFull) {
      this.grenades?.refillToMax();
      this.hud.setGrenades(this.grenades.count);
    }
    this._ammoChestReadyAt = performance.now() + AMMO_CHEST_COOLDOWN_MS;
    sound.play('ui_click', { volume: 0.55, pitch: 1.15 });
  }

  // ═══════════════════════════════════════════════════════
  //  SHOOTING
  // ═══════════════════════════════════════════════════════

  _tryShoot(nowMs) {
    if (!this.alive || !this.controls.isLocked || this.weapon.reloading) return;
    if (this.lodibidon && !this.lodibidon.canShoot()) return;
    if (this.classicMatch && !this.classicMatch.canAct()) return;
    if (this.grenades?.isPrimed) return;

    if (this.weapon.ammo <= 0) {
      if (this.weapon.reserve > 0) this.weapon.reload();
      return;
    }

    if (!this.weapon.canFire(nowMs)) return;

    for (let p = 0; p < this.weapon.def.pellets; p++) this.shots.firePellet();
    this.weapon.consumeShot(nowMs);
    if (this.mp) {
      const pos = this.camera.position;
      this.mp.sendWorldEvent({
        type: 'shot',
        x: pos.x,
        y: pos.y,
        z: pos.z,
        rotY: this.camera.rotation.y,
        weapon: this.weapon.key,
      });
    }
    if (this.weapon.ammo <= 0 && this.weapon.reserve > 0) this.weapon.reload();
  }

  // ═══════════════════════════════════════════════════════
  //  COMBAT
  // ═══════════════════════════════════════════════════════

  takeDamage(amount, killerName = 'Enemy') {
    if (!this.alive || this._isClassicMatchOver()) return;
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
  _onKill(victimName, isHeadshot = false, victimUid = null) {
    this._killStreak++;
    this.kills++;
    this.hud.showKillScore(isHeadshot);
    this.hud.showMedal(this._killStreak);
    if (this._isLodibidon()) {
      const vt = this._lodibidonVictimTeam(victimName, victimUid);
      if (!this._lodibidonShouldSkipKillConfirm(vt)) {
        sound.playLodibidonKillConfirm();
      }
      this._lodibidonOnElimination(this.lodibidon.playerTeam, vt, { skipTeamSting: true });
    } else {
      sound.playClassicKillConfirm(this._killStreak);
    }
    sound.playKillVoice(0.38, 300);
    this.hud.setScore(this.kills, this.deaths);
    this.hud.addKillFeed(this.username, victimName);

    if (this.mp) {
      let assistKey = null;
      if (victimUid) assistKey = `player:${victimUid}`;
      else if (victimName.startsWith('Bot-')) {
        const idx = parseInt(victimName.replace('Bot-', ''), 10) - 1;
        if (!Number.isNaN(idx)) assistKey = `bot:${idx}`;
      }
      if (assistKey) this.mp.grantAssists(this._consumeAssists(assistKey));
      this.mp.updateStats(this.kills, this.deaths);
    }
  }

  _die(killerName) {
    if (this._isLodibidon()) {
      this._lodibidonOnElimination(
        this._lodibidonKillerTeam(killerName),
        this.lodibidon.playerTeam,
      );
      this.lodibidon.onLocalDeath(killerName);
      return;
    }

    this.alive       = false;
    this.deaths++;
    this._killStreak = 0;
    const killerBot = this._botFromKillName(killerName);
    if (killerBot) killerBot.kills++;
    this.mp?.updateStats(this.kills, this.deaths);

    sound.play('die', { volume: 1.0 });
    if (killerName.startsWith('Bot-')) sound.playKillVoice(0.32, 300);
    this.controls.unlock();
    this.grenades?.reset();
    this.weapon.setADS(false);
    this._applyADSState(false);
    this.hud.addKillFeed(killerName, this.username);
    this.hud.setScore(this.kills, this.deaths);
    this.hud.showDeathScreen(killerName);

    if (this._isClassicMatchOver()) return;

    let countdown = RESPAWN_TIME;
    this.hud.setRespawnCountdown(countdown);
    const iv = setInterval(() => {
      this.hud.setRespawnCountdown(--countdown);
      if (countdown <= 0) { clearInterval(iv); this._respawn(); }
    }, 1000);
  }

  _respawn() {
    this.health = MAX_HEALTH;
    this.alive  = true;
    this.weapon.resetAll();   // resets ammo via equip, fires callbacks
    this.grenades?.reset();
    this.hud.setGrenades(this.grenades?.count ?? 0);

    const sp = this.spawns.claimRespawnSlot();
    this.spawns.placePlayerAt(sp.x, sp.z);

    this.hud.setHealth(MAX_HEALTH);
    this.hud.setScore(this.kills, this.deaths);
    this.hud.hideDeathScreen();
    this.mp?.updateHealth(100);
    this._pushLocalSpawnToNetwork();
    setTimeout(() => this.tryPointerLock(), 100);
  }

  // ═══════════════════════════════════════════════════════
  //  REGEN
  // ═══════════════════════════════════════════════════════

  _updateRegen(delta, nowMs) {
    if (!this.alive || this.health >= MAX_HEALTH) return;
    if (nowMs - this.lastDamageMs < REGEN_DELAY) return;
    this.health = Math.min(MAX_HEALTH, this.health + REGEN_RATE * delta);
    this.hud.setHealth(this.health);
    this.mp?.updateHealth(Math.round(this.health));
  }

  // ═══════════════════════════════════════════════════════
  //  BOTS & REMOTE PLAYERS
  // ═══════════════════════════════════════════════════════

  _updateBots(delta, nowMs) {
    const botCanAct = !this.lodibidon || this.lodibidon.canAct();

    if (this._isMpClient()) {
      this.syncedBots.forEach(sb => {
        if (sb) {
          sb.updateVisual(delta, this.camera, (key, pos, opts) => this._playWorldSound(key, pos, opts));
          if (sb.alive && !sb.dying) {
            updateCharacterOverheadUI(sb.mesh, this.camera, this.map, {
              healthBar: sb.healthBar,
              healthRatio: sb.health / sb.maxHealth,
              visible: true,
              ...this._lodibidonLabelOpts(sb.team),
            });
          }
        }
      });
      return;
    }

    this.bots.forEach(bot => {
      if (bot.entity?.dying) {
        bot.entity.updateDeath(delta);
        return;
      }
      if (!bot.alive) return;
      const target = this._getBotCombatTarget(bot);
      bot.update(delta, nowMs, target, (dmg, tgt) => this._applyBotHit(bot, dmg, tgt), botCanAct);
      bot.updateHealthBar(this.camera, this.map, this._lodibidonLabelOpts(bot.team));
    });
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
    if (!this.controls.isLocked || !this.alive || this.grenades?.isPrimed) return;
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
    document.addEventListener('keydown',    this._onKeyDown, true);
    document.addEventListener('keyup',      this._onKeyUp, true);
    document.addEventListener('mousedown',  this._onMouseDn);
    document.addEventListener('mouseup',    this._onMouseUp);
    document.addEventListener('wheel',      this._onWheel, { passive: false });
    document.addEventListener('contextmenu', this._onCtxMenu);
  }

  _unbindInput() {
    document.removeEventListener('keydown',    this._onKeyDown, true);
    document.removeEventListener('keyup',      this._onKeyUp, true);
    document.removeEventListener('mousedown',  this._onMouseDn);
    document.removeEventListener('mouseup',    this._onMouseUp);
    document.removeEventListener('wheel',      this._onWheel, { passive: false });
    document.removeEventListener('contextmenu', this._onCtxMenu);
    this.renderer?.domElement?.removeEventListener('mousedown', this._onCanvasPointerDown);
    window.removeEventListener('resize',       this._onResize);
  }

  _handleKeyDown(e) {
    if (e.code === 'Backquote' && this.running && !e.repeat) {
      e.preventDefault();
      this.toggleEditorMode();
      return;
    }

    // Tab = match leaderboard (multi and solo bot lobbies). Block default Tab behavior.
    if (e.code === 'Tab' && this.running && this.alive && this.controls?.isLocked) {
      e.preventDefault();
      e.stopPropagation();
      if (this._canShowLeaderboard()) {
        this._tabHeld = true;
        this.hud.showLeaderboard(this._getLeaderboardRows());
      }
      return;
    }

    this.keys.add(e.code);
    if (!this.controls.isLocked || !this.alive) return;
    if (e.code === 'KeyR') this.weapon.reload();
    if (e.code === 'KeyF') this.pickups.tryInteractF();
    if (e.code === 'KeyG' && !e.repeat) this.pickups.tryDropWeapon();
    if (e.code === 'KeyV' && !e.repeat) this.pickups.tryDropMag();
    if (e.code === 'KeyE' && !e.repeat) this.grenades?.tryPrime();
    if (e.code === 'Digit1' || e.code === 'Numpad1') {
      e.preventDefault();
      if (this.weapon.hasSlot('primary')) this._switchWeaponSlot('primary');
    }
    if (e.code === 'Digit2' || e.code === 'Numpad2') {
      e.preventDefault();
      if (this.weapon.hasSlot('side')) this._switchWeaponSlot('side');
    }
  }

  _handleKeyUp(e) {
    if (e.code === 'Tab') {
      if (this._tabHeld) {
        e.preventDefault();
        e.stopPropagation();
      }
      this._tabHeld = false;
      this.hud.hideLeaderboard();
      document.getElementById('pointer-lock-overlay')?.classList.add('hidden');
      if (this.running && this.alive && !this.controls?.isLocked) {
        this.tryPointerLock();
      }
      return;
    }

    this.keys.delete(e.code);
    if (e.code === 'KeyE') this.grenades?.releaseThrow();
  }

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

  _handleWheel(e) {
    if (!this.running || !this.alive || !this.controls?.isLocked) return;
    e.preventDefault();
    const now = performance.now();
    if (now - this._lastScrollWeaponSwapMs < 500) return;
    this._lastScrollWeaponSwapMs = now;
    const order = ['primary', 'side'];
    const idx = order.indexOf(this.weapon.activeSlot);
    const alt = order[(idx + 1) % 2];
    if (this.weapon.hasSlot(alt)) this._switchWeaponSlot(alt);
  }

  /** @param {'primary'|'side'} slot */
  _switchWeaponSlot(slot) {
    if (!this.weapon.hasSlot(slot)) return;
    this.weapon.switchToSlot(slot);
    this._applyADSState(false);
  }

  _handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
