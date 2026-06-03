// ═══════════════════════════════════════════════════════════
//  WARFRONT — WeaponSystem
//  Owns: weapon state (ammo/reload), 3-D model, all animation
//  (recoil, head-bob, reload arc, camera pitch) and ADS.
//
//  Shooting raycasting stays in Game (needs full scene access).
//  Game calls consumeShot() after confirming a hit opportunity.
// ═══════════════════════════════════════════════════════════

import * as THREE  from 'three';
import { WEAPONS } from './config.js';
import { sound }   from './sound.js';

// ── Gun part tables ──────────────────────────────────────────
// Each entry: [ 'body'|'barrel', [w,h,d], [x,y,z] ]
const GUN_PARTS = {
  assault_rifle: [
    ['body',   [0.068, 0.068, 0.38], [0,       0,      0     ]], // receiver
    ['barrel', [0.030, 0.030, 0.22], [0,  0.018, -0.30 ]],       // barrel
    ['body',   [0.040, 0.130, 0.06], [0, -0.098,  0.04 ]],       // magazine
    ['body',   [0.058, 0.058, 0.14], [0,       0,  0.26 ]],      // stock
    ['barrel', [0.018, 0.018, 0.08], [0,  0.050,  0.01 ]],       // carry handle
  ],
  shotgun: [
    ['body',   [0.090, 0.075, 0.36], [0,      0,     0     ]],
    ['barrel', [0.055, 0.040, 0.26], [0, 0.018, -0.31]],
    ['body',   [0.085, 0.050, 0.09], [0,      0,  0.16]],
    ['body',   [0.060, 0.065, 0.18], [0,      0,  0.27]],
  ],
  sniper: [
    ['body',   [0.052, 0.052, 0.50], [0,       0,     0    ]],
    ['barrel', [0.020, 0.020, 0.30], [0,  0.010, -0.40]],
    ['barrel', [0.030, 0.030, 0.18], [0,  0.048,  0.00]],
    ['body',   [0.044, 0.046, 0.18], [0,       0,  0.34]],
    ['body',   [0.034, 0.120, 0.05], [0, -0.086,  0.12]],
  ],
};

// Rest position of the weapon group in camera space
const REST_POS = new THREE.Vector3(0.22, -0.28, -0.46);

export class WeaponSystem {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {string}  initialKey  — key in WEAPONS
   * @param {number}  baseFov     — hip-fire FOV
   * @param {string}  [adsMode]   — 'toggle' | 'hold'
   */
  constructor(camera, initialKey, baseFov, adsMode = 'toggle') {
    this._camera  = camera;
    this._baseFov = baseFov;
    this._adsMode = adsMode;

    // ── Weapon state ─────────────────────────────────────
    this.key      = initialKey;
    this.def      = WEAPONS[initialKey];
    this.ammo     = this.def.magSize;
    this.reserve  = this.def.reserve;
    this.reloading = false;
    this.isADS    = false;
    this.targetFov = baseFov;

    this._lastShotMs  = -9999;
    this._reloadTimer = null;

    // ── Animation state ───────────────────────────────────
    this._bobPhase     = 0;
    this._recoilZ      = 0;
    this._recoilRotX   = 0;
    this._sprayRecoil  = 0;   // accumulated camera-pitch to recover (radians)
    this._reloadAnimT  = 0;
    this._reloadAnimOn = false;
    this._hitShake     = 0;   // set each frame by Game via setHitShake()

    // ── 3-D objects ────────────────────────────────────────
    /** @type {THREE.Group} */  this.group  = null;
    /** @type {THREE.Group} */  this._flash = null;
    this._flashOff = null;

    // ── Callbacks (assigned by Game after construction) ────
    /** Called when ammo/reserve changes. */
    this.onAmmoChanged    = null;
    /** Called at the start of a reload (show reload bar). */
    this.onReloadStart    = null;
    /** Called when reload finishes (hide reload bar, refresh ammo). */
    this.onReloadComplete = null;
    /** Called after equip() with the new weapon name. */
    this.onWeaponChanged  = null;

    this._buildModel(initialKey);
  }

  // ── Read-only queries ──────────────────────────────────────

  get fireInterval() { return 60000 / this.def.fireRate; }

  /** Effective bullet spread (reduced in ADS, widened when shaking). */
  get effectiveSpread() {
    return (this.isADS ? this.def.spread * 0.25 : this.def.spread)
      + this._hitShake * 0.10;
  }

  /** True when the weapon can fire right now. */
  canFire(nowMs) {
    return !this.reloading
        && this.ammo > 0
        && nowMs - this._lastShotMs >= this.fireInterval;
  }

  /** True when mag + reserve are empty and the click-interval has elapsed. */
  isEmptyClickReady(nowMs) {
    return this.ammo <= 0
        && this.reserve === 0
        && !this.reloading
        && nowMs - this._lastShotMs >= this.fireInterval;
  }

  // ── Actions ────────────────────────────────────────────────

  /**
   * Record that one shot has been fired.
   * Game calls this after confirming the shot (raycasting done externally).
   */
  consumeShot(nowMs) {
    this._lastShotMs = nowMs;
    this.ammo--;

    // Model recoil — accumulates up to 3× per-shot value
    this._recoilZ    = Math.min(this._recoilZ    + this.def.recoilZ,    this.def.recoilZ    * 3);
    this._recoilRotX = Math.min(this._recoilRotX + this.def.recoilRotX, this.def.recoilRotX * 3);

    // Camera pitch — pure-X Euler manipulation to avoid yaw bleed
    const kick = this.def.recoilRotX * 0.09;
    const re   = new THREE.Euler().setFromQuaternion(this._camera.quaternion, 'YXZ');
    re.x = Math.min(Math.PI / 2 - 0.05, re.x + kick);
    this._camera.quaternion.setFromEuler(re);
    this._sprayRecoil += kick;

    sound.playShoot(this.key, { isADS: this.isADS });
    this._showFlash();
    this.onAmmoChanged?.();
  }

  /** Dry-fire click (rate-limited by fireInterval). */
  clickEmpty(nowMs) {
    this._lastShotMs = nowMs;
    sound.play('empty_click', { volume: 0.6 });
  }

  reload() {
    if (this.reloading || this.ammo === this.def.magSize || this.reserve === 0) return;
    this.reloading     = true;
    this._reloadAnimT  = 0;
    this._reloadAnimOn = true;

    this.onReloadStart?.();
    sound.play('reload', { volume: 0.8 });

    this._reloadTimer = setTimeout(() => {
      const taken   = Math.min(this.def.magSize - this.ammo, this.reserve);
      this.ammo    += taken;
      this.reserve -= taken;
      this.reloading     = false;
      this._reloadAnimOn = false;
      this.onReloadComplete?.();
      this.onAmmoChanged?.();
    }, this.def.reloadTime);
  }

  /** Swap weapon: rebuilds model, resets ammo to a fresh mag. */
  equip(key) {
    if (!WEAPONS[key]) return;
    clearTimeout(this._reloadTimer);
    this.key       = key;
    this.def       = WEAPONS[key];
    this.ammo      = this.def.magSize;
    this.reserve   = this.def.reserve;
    this.reloading     = false;
    this._reloadAnimOn = false;
    this.setADS(false);

    this._buildModel(key);
    this.onReloadComplete?.();   // ensures reload bar is hidden
    this.onAmmoChanged?.();
    this.onWeaponChanged?.(this.def.name);
  }

  toggleADS() { this.setADS(!this.isADS); }

  setADS(on) {
    this.isADS     = on;
    this.targetFov = on ? this._baseFov / this.def.zoom : this._baseFov;
  }

  /** Game must call this each frame so weapon can widen spread when player is hit. */
  setHitShake(s) { this._hitShake = s; }

  // ── Per-frame update ───────────────────────────────────────

  /**
   * @param {number}  delta    — seconds since last frame
   * @param {boolean} moving   — player is moving (drives head-bob speed)
   * @param {boolean} isFiring — mouse is held; suppresses camera pitch recovery
   */
  update(delta, moving, isFiring) {
    // FOV lerp (ADS)
    if (Math.abs(this._camera.fov - this.targetFov) > 0.3) {
      this._camera.fov = THREE.MathUtils.lerp(this._camera.fov, this.targetFov, 0.18);
      this._camera.updateProjectionMatrix();
    }

    // Model recoil decay
    this._recoilZ    *= 0.88;
    this._recoilRotX *= 0.88;

    // Camera pitch recovery (only between bursts)
    if (!isFiring && this._sprayRecoil > 0.0005) {
      const recover = Math.min(this._sprayRecoil, delta * 0.1);
      const re = new THREE.Euler().setFromQuaternion(this._camera.quaternion, 'YXZ');
      re.x = Math.max(-Math.PI / 2 + 0.05, re.x - recover);
      this._camera.quaternion.setFromEuler(re);
      this._sprayRecoil = Math.max(0, this._sprayRecoil - recover);
    }

    // Head bob
    this._bobPhase += delta * (moving ? 7.5 : 2.0);
    const bobAmt = moving ? 1 : 0.3;
    const bobX   = Math.sin(this._bobPhase)         * 0.010 * bobAmt;
    const bobY   = Math.abs(Math.cos(this._bobPhase * 0.5)) * 0.007 * bobAmt;

    // Reload animation (sinusoidal drop + tilt, peaks at mid-reload)
    let reloadDrop = 0, reloadTilt = 0;
    if (this._reloadAnimOn) {
      this._reloadAnimT = Math.min(1, this._reloadAnimT + delta / (this.def.reloadTime / 1000));
      const t = this._reloadAnimT;
      reloadDrop = Math.sin(t * Math.PI) * 0.22;
      reloadTilt = Math.sin(t * Math.PI) * 0.45;
    }

    // Apply transforms
    if (this.group) {
      this.group.position.set(
        REST_POS.x + bobX,
        REST_POS.y - bobY - reloadDrop,
        REST_POS.z - this._recoilZ,
      );
      this.group.rotation.x = this._recoilRotX;  // positive = barrel kicks up
      this.group.rotation.z = reloadTilt;
    }
  }

  // ── Private ────────────────────────────────────────────────

  _buildModel(key) {
    // Dispose old model's GPU resources before replacing
    if (this.group) {
      this._camera.remove(this.group);
      this.group.traverse(child => {
        if (!child.isMesh) return;
        child.geometry?.dispose();
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material?.dispose();
      });
      this.group = null;
    }

    const wDef  = WEAPONS[key];
    const bMat  = new THREE.MeshLambertMaterial({ color: wDef.bodyColor });
    const dMat  = new THREE.MeshLambertMaterial({ color: wDef.barrelColor });
    const parts = GUN_PARTS[key] ?? GUN_PARTS.assault_rifle;

    const group = new THREE.Group();
    parts.forEach(([type, dims, pos]) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dims), type === 'barrel' ? dMat : bMat);
      mesh.position.set(...pos);
      group.add(mesh);
    });

    // Muzzle flash (sphere + point light, hidden until fired)
    this._flash = new THREE.Group();
    this._flash.add(
      Object.assign(
        new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0xffdd44 }),
        )
      ),
      new THREE.PointLight(0xffaa00, 4, 2.5),
    );
    this._flash.position.set(0, 0, -0.62);
    this._flash.visible = false;
    group.add(this._flash);

    group.position.copy(REST_POS);
    this._camera.add(group);
    this.group = group;
  }

  _showFlash() {
    this._flash.visible = true;
    clearTimeout(this._flashOff);
    this._flashOff = setTimeout(() => { this._flash.visible = false; }, 55);
  }
}
