// ═══════════════════════════════════════════════════════════
//  WARFRONT — WeaponSystem
//  Owns: weapon state (ammo/reload), 3-D model, all animation
//  (recoil, head-bob, reload arc, camera pitch) and ADS.
//
//  Shooting raycasting stays in Game (needs full scene access).
//  Game calls consumeShot() after confirming a hit opportunity.
// ═══════════════════════════════════════════════════════════

import * as THREE  from 'three';
import { WEAPONS, SIDE_WEAPON_KEY, DROPPABLE_WEAPONS } from './config.js';
import { sound }   from './sound.js';

// ── Weapon part tables ───────────────────────────────────────
// Each entry: [shape, matKey, params, [x,y,z], [rx,ry,rz]?]
//   shape  'box' → BoxGeometry(...params)
//          'cyl' → CylinderGeometry(...params), auto-rotated x=π/2 (along Z) unless overridden
//   matKey 'body' | 'metal' | 'stock' | 'scope'
const GUN_PARTS = {

  // ── M4A1-style assault rifle ────────────────────────────
  assault_rifle: [
    // Receiver
    ['box', 'body',  [0.058, 0.050, 0.280],     [ 0,      0.000,  0.000]],
    // Upper receiver rail host
    ['box', 'metal', [0.050, 0.018, 0.250],     [ 0,      0.036,  0.000]],
    // Picatinny top rail
    ['box', 'metal', [0.048, 0.007, 0.215],     [ 0,      0.046, -0.007]],
    // Barrel (cylinder, tapers at breech)
    ['cyl', 'metal', [0.010, 0.013, 0.265, 8],  [ 0,      0.036, -0.193]],
    // Gas block collar
    ['cyl', 'metal', [0.015, 0.017, 0.020, 6],  [ 0,      0.036, -0.315]],
    // Flash hider
    ['box', 'metal', [0.016, 0.016, 0.030],     [ 0,      0.036, -0.341]],
    // M-LOK handguard body
    ['box', 'body',  [0.048, 0.044, 0.150],     [ 0,      0.028, -0.128]],
    // Handguard top rail
    ['box', 'metal', [0.048, 0.006, 0.150],     [ 0,      0.051, -0.128]],
    // Handguard side slot (left)
    ['box', 'metal', [0.007, 0.036, 0.150],     [-0.028,  0.028, -0.128]],
    // Magazine body
    ['box', 'body',  [0.032, 0.086, 0.050],     [ 0,     -0.075,  0.025]],
    // Mag base (angled forward)
    ['box', 'body',  [0.032, 0.025, 0.045],     [ 0,     -0.116,  0.044], [0.22, 0, 0]],
    // Pistol grip
    ['box', 'body',  [0.030, 0.080, 0.048],     [ 0,     -0.070,  0.100]],
    // Trigger guard
    ['box', 'metal', [0.030, 0.008, 0.044],     [ 0,     -0.043,  0.075]],
    // Buffer tube
    ['cyl', 'metal', [0.015, 0.015, 0.080, 8],  [ 0,     -0.003,  0.190]],
    // Stock body (M4 collapsible)
    ['box', 'stock', [0.036, 0.030, 0.125],     [ 0,     -0.003,  0.255]],
    // Butt pad
    ['box', 'stock', [0.044, 0.048, 0.018],     [ 0,     -0.003,  0.316]],
    // Stock top spine
    ['box', 'stock', [0.036, 0.010, 0.095],     [ 0,      0.019,  0.254]],
    // Charging handle
    ['box', 'metal', [0.038, 0.012, 0.016],     [ 0,      0.033,  0.058]],
    // Ejection port cover
    ['box', 'metal', [0.006, 0.020, 0.045],     [ 0.030,  0.000, -0.005]],
    // Front sight post
    ['box', 'metal', [0.007, 0.022, 0.007],     [ 0,      0.055, -0.328]],
  ],

  // ── AK47 — wood furniture, curved mag, stamped receiver ─
  ak47: [
    ['box', 'body',  [0.052, 0.048, 0.290],     [ 0,      0.000,  0.000]],
    ['box', 'metal', [0.048, 0.014, 0.270],     [ 0,      0.032,  0.000]],
    ['cyl', 'metal', [0.011, 0.014, 0.280, 8],  [ 0,      0.030, -0.200]],
    ['box', 'metal', [0.018, 0.018, 0.032],     [ 0,      0.030, -0.356]],
    ['box', 'stock', [0.042, 0.038, 0.160],     [ 0,      0.006,  0.248]],
    ['box', 'stock', [0.048, 0.052, 0.022],     [ 0,      0.006,  0.328]],
    ['box', 'body',  [0.044, 0.040, 0.155],     [ 0,      0.010, -0.125]],
    ['box', 'body',  [0.034, 0.082, 0.046],     [ 0,     -0.068,  0.095]],
    ['box', 'body',  [0.030, 0.072, 0.040],     [ 0,     -0.088,  0.040], [0.38, 0, 0.06]],
    ['box', 'body',  [0.028, 0.058, 0.036],     [ 0,     -0.118,  0.058], [0.52, 0, 0.10]],
    ['box', 'metal', [0.030, 0.008, 0.044],     [ 0,     -0.042,  0.072]],
    ['box', 'metal', [0.008, 0.024, 0.050],     [ 0.028,  0.002, -0.010]],
    ['box', 'metal', [0.007, 0.020, 0.007],     [ 0,      0.048, -0.340]],
  ],

  // ── Mossberg 500-style pump-action shotgun ──────────────
  shotgun: [
    // Receiver (fatter, more square)
    ['box', 'body',  [0.070, 0.060, 0.300],     [ 0,      0.000,  0.020]],
    // Action side plate (right)
    ['box', 'metal', [0.010, 0.042, 0.260],     [ 0.037,  0.000,  0.020]],
    // Barrel (wide bore)
    ['cyl', 'metal', [0.018, 0.020, 0.265, 8],  [ 0,      0.018, -0.175]],
    // Muzzle crown (slightly flared)
    ['cyl', 'metal', [0.022, 0.018, 0.018, 8],  [ 0,      0.018, -0.322]],
    // Under-barrel magazine tube
    ['cyl', 'metal', [0.012, 0.012, 0.245, 8],  [ 0,     -0.005, -0.160]],
    // Tube cap / end piece
    ['cyl', 'metal', [0.015, 0.012, 0.012, 8],  [ 0,     -0.005, -0.296]],
    // Pump forend body
    ['box', 'body',  [0.054, 0.044, 0.095],     [ 0,      0.001, -0.168]],
    // Pump forend top
    ['box', 'body',  [0.050, 0.008, 0.095],     [ 0,      0.024, -0.168]],
    // Pump action bar (left)
    ['box', 'metal', [0.005, 0.005, 0.195],     [-0.016,  0.006, -0.070]],
    // Pump action bar (right)
    ['box', 'metal', [0.005, 0.005, 0.195],     [ 0.016,  0.006, -0.070]],
    // Pistol grip
    ['box', 'body',  [0.034, 0.070, 0.052],     [ 0,     -0.055,  0.112]],
    // Stock (wood-style)
    ['box', 'stock', [0.044, 0.040, 0.155],     [ 0,     -0.002,  0.235]],
    // Stock comb (raised ridge)
    ['box', 'stock', [0.038, 0.018, 0.115],     [ 0,      0.026,  0.225]],
    // Butt plate
    ['box', 'stock', [0.055, 0.058, 0.020],     [ 0,     -0.002,  0.308]],
    // Safety button
    ['box', 'metal', [0.011, 0.009, 0.014],     [ 0,      0.032,  0.102]],
    // Trigger guard
    ['box', 'metal', [0.034, 0.008, 0.050],     [ 0,     -0.032,  0.088]],
    // Ejection port
    ['box', 'metal', [0.008, 0.028, 0.058],     [ 0.038,  0.004,  0.036]],
  ],

  // ── AWP/L96-style bolt-action sniper ────────────────────
  sniper: [
    // Receiver / action block
    ['box', 'body',  [0.046, 0.048, 0.300],      [ 0,      0.000,  0.058]],
    // Barrel (very long, tapers toward muzzle)
    ['cyl', 'metal', [0.009, 0.014, 0.370, 8],   [ 0,      0.032, -0.250]],
    // Muzzle brake
    ['box', 'metal', [0.018, 0.018, 0.038],      [ 0,      0.032, -0.454]],
    // Muzzle brake vents (top / bottom slot)
    ['box', 'metal', [0.024, 0.007, 0.038],      [ 0,      0.036, -0.454]],
    ['box', 'metal', [0.024, 0.007, 0.038],      [ 0,      0.028, -0.454]],
    // Scope tube (main body)
    ['cyl', 'scope', [0.022, 0.022, 0.235, 12],  [ 0,      0.085,  0.015]],
    // Objective bell (widens at front)
    ['cyl', 'scope', [0.030, 0.022, 0.040, 12],  [ 0,      0.085, -0.123]],
    // Eyepiece (widens at rear)
    ['cyl', 'scope', [0.027, 0.022, 0.030, 12],  [ 0,      0.085,  0.145]],
    // Elevation turret (top)
    ['box', 'scope', [0.014, 0.024, 0.018],      [ 0,      0.110,  0.012]],
    // Windage turret (right side)
    ['box', 'scope', [0.024, 0.014, 0.018],      [ 0.034,  0.098,  0.012]],
    // Scope mount ring (front)
    ['box', 'metal', [0.028, 0.018, 0.018],      [ 0,      0.064, -0.040]],
    // Scope mount ring (rear)
    ['box', 'metal', [0.028, 0.018, 0.018],      [ 0,      0.064,  0.058]],
    // Bolt handle shaft
    ['box', 'metal', [0.008, 0.008, 0.026],      [ 0.036,  0.022,  0.085]],
    // Bolt knob
    ['box', 'metal', [0.018, 0.018, 0.018],      [ 0.046,  0.022,  0.097]],
    // Magazine (small, 5-round)
    ['box', 'body',  [0.034, 0.065, 0.040],      [ 0,     -0.052,  0.080]],
    // Pistol grip (thumbhole-style)
    ['box', 'body',  [0.028, 0.082, 0.042],      [ 0,     -0.063,  0.130]],
    // Trigger guard
    ['box', 'metal', [0.028, 0.008, 0.048],      [ 0,     -0.038,  0.106]],
    // Chassis / forend under barrel
    ['box', 'body',  [0.040, 0.030, 0.200],      [ 0,     -0.002, -0.130]],
    // Stock (thick tactical)
    ['box', 'stock', [0.036, 0.042, 0.190],      [ 0,     -0.005,  0.265]],
    // Cheek piece (left side)
    ['box', 'stock', [0.012, 0.028, 0.130],      [-0.024,  0.024,  0.254]],
    // Butt pad
    ['box', 'stock', [0.044, 0.065, 0.022],      [ 0,     -0.005,  0.356]],
    // Bipod leg (left)
    ['box', 'metal', [0.006, 0.060, 0.006],      [-0.020, -0.048, -0.280]],
    // Bipod leg (right)
    ['box', 'metal', [0.006, 0.060, 0.006],      [ 0.020, -0.048, -0.280]],
    // Bipod crossbar
    ['box', 'metal', [0.044, 0.008, 0.006],      [ 0,     -0.020, -0.280]],
  ],

  // ── Compact sidearm (always equipped in slot 2) ─────────
  pistol: [
    // Slide
    ['box', 'body',  [0.036, 0.038, 0.110],     [ 0,      0.014, -0.028]],
    // Barrel
    ['cyl', 'metal', [0.007, 0.008, 0.048, 8],  [ 0,      0.018, -0.092]],
    // Front sight
    ['box', 'metal', [0.008, 0.012, 0.008],     [ 0,      0.036, -0.072]],
    // Rear sight
    ['box', 'metal', [0.010, 0.010, 0.008],     [ 0,      0.034,  0.018]],
    // Grip
    ['box', 'body',  [0.030, 0.082, 0.032],     [ 0,     -0.048,  0.028]],
    // Trigger guard
    ['box', 'metal', [0.028, 0.007, 0.040],     [ 0,     -0.018,  0.004]],
    // Magazine
    ['box', 'body',  [0.022, 0.055, 0.028],     [ 0,     -0.038,  0.038]],
  ],
};

// Muzzle flash position (bore axis) for each weapon, in group-local space
const FLASH_OFFSET = {
  assault_rifle: new THREE.Vector3(0,  0.036, -0.356),
  ak47:          new THREE.Vector3(0,  0.030, -0.368),
  shotgun:       new THREE.Vector3(0,  0.018, -0.331),
  sniper:        new THREE.Vector3(0,  0.032, -0.473),
  pistol:        new THREE.Vector3(0,  0.022, -0.128),
};

function _weaponMaterials(key) {
  const wDef = WEAPONS[key] ?? WEAPONS.assault_rifle;
  return {
    body:  new THREE.MeshLambertMaterial({ color: wDef.bodyColor }),
    metal: new THREE.MeshLambertMaterial({ color: wDef.barrelColor }),
    stock: new THREE.MeshLambertMaterial({ color: wDef.stockColor ?? wDef.bodyColor }),
    scope: new THREE.MeshLambertMaterial({ color: wDef.scopeColor ?? 0x111114 }),
  };
}

function _assembleWeaponParts(key, mats) {
  const group = new THREE.Group();
  const parts = GUN_PARTS[key] ?? GUN_PARTS.assault_rifle;
  parts.forEach(([shape, matKey, params, pos, rot]) => {
    let geo;
    if (shape === 'box') {
      geo = new THREE.BoxGeometry(...params);
    } else {
      geo = new THREE.CylinderGeometry(...params);
    }
    const mesh = new THREE.Mesh(geo, mats[matKey] ?? mats.body);
    mesh.position.set(...pos);
    if (rot) {
      mesh.rotation.set(...rot);
    } else if (shape === 'cyl') {
      mesh.rotation.x = Math.PI / 2;
    }
    mesh.castShadow = true;
    group.add(mesh);
  });
  return group;
}

/** Same gun geometry as the first-person viewmodel, oriented flat for ground pickups. */
export function buildWeaponWorldModel(key) {
  const gun = _assembleWeaponParts(key, _weaponMaterials(key));
  const root = new THREE.Group();
  // Viewmodel barrel points -Z; lay flat on XZ with barrel horizontal.
  gun.rotation.order = 'YXZ';
  gun.rotation.y = Math.PI / 2;
  gun.rotation.x = Math.PI / 2;
  root.add(gun);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gun);
  gun.position.y = -box.min.y + 0.04;
  return root;
}

const THROW_DURATION = 0.42;

// Rest position of the weapon group in camera space (combat — crosshair unchanged)
const REST_POS = new THREE.Vector3(0.22, -0.28, -0.46);

// Tactical sprint: high-ready on the right, barrel up (viewmodel only)
const SPRINT_POS = new THREE.Vector3(0.36, -0.04, -0.34);
const SPRINT_ROT = { x: 1.28, y: 0.08, z: 0.28 };

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

    // ── Dual independent weapon slots ────────────────────
    this._activeSlot = 'primary';
    this._initDefaultSlots(initialKey);

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
    this._sprintBlend  = 0;   // 0 = combat pose, 1 = tactical sprint pose
    this._walkPhase    = 0;
    this._sprintPhase  = 0;
    this._viewSuppressed = false;
    this._throwAnimOn    = false;
    this._throwAnimT     = 0;
    /** @type {(() => void)|null} */
    this._throwCallback  = null;
    /** @type {{ key: string, ammo: number, reserve: number }|null} */
    this._throwPending   = null;

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
    /** Called after slot swap: 'primary' | 'side'. */
    this.onSlotChanged    = null;
    /** Called after each shot: (muzzleWorldPos, muzzleWorldDir) => void */
    this.onMuzzleEffects = null;

    this._buildModel(this.key);
  }

  // ── Active slot accessors ──────────────────────────────────

  get key()     { return this._slotKeys[this._activeSlot]; }
  get def()     { return WEAPONS[this.key] ?? WEAPONS.pistol; }
  get ammo()    { return this.hasSlot(this._activeSlot) ? this._states[this._activeSlot].ammo : 0; }
  set ammo(v)   { if (this.hasSlot(this._activeSlot)) this._states[this._activeSlot].ammo = v; }
  get reserve() { return this.hasSlot(this._activeSlot) ? this._states[this._activeSlot].reserve : 0; }
  set reserve(v){ if (this.hasSlot(this._activeSlot)) this._states[this._activeSlot].reserve = v; }
  get primaryKey() { return this._slotKeys.primary; }
  get activeSlot() { return this._activeSlot; }
  get hasPrimary() { return this._slotKeys.primary != null; }
  get hasSide()    { return this._slotKeys.side != null; }
  get isThrowing() { return this._throwAnimOn; }

  /** @param {'primary'|'side'} slot */
  hasSlot(slot) { return this._slotKeys[slot] != null; }

  /** True if either slot currently holds this weapon type. */
  hasWeaponType(weaponKey) {
    return this._slotKeys.primary === weaponKey || this._slotKeys.side === weaponKey;
  }

  /** True if a mag pickup can be applied (have weapon + reserve not full). */
  canUseMagPickup(weaponKey) {
    if (!WEAPONS[weaponKey] || !this.hasWeaponType(weaponKey)) return false;
    for (const slot of ['primary', 'side']) {
      if (this._slotKeys[slot] !== weaponKey) continue;
      const d  = WEAPONS[weaponKey];
      const st = this._states[slot];
      if (st.reserve < d.reserve) return true;
    }
    return false;
  }

  /**
   * Add one magazine worth of reserve to every slot carrying this weapon.
   * @returns {boolean}
   */
  applyMagPickup(weaponKey) {
    if (!this.canUseMagPickup(weaponKey)) return false;
    const magSize = WEAPONS[weaponKey].magSize;
    let changed = false;
    for (const slot of ['primary', 'side']) {
      if (this._slotKeys[slot] !== weaponKey) continue;
      const d  = WEAPONS[weaponKey];
      const st = this._states[slot];
      const before = st.reserve;
      st.reserve = Math.min(d.reserve, st.reserve + magSize);
      if (st.reserve !== before) changed = true;
    }
    if (changed) this.onAmmoChanged?.();
    return changed;
  }

  /** Active weapon has enough reserve to drop one full magazine. */
  canDropMag() {
    const key = this.key;
    if (!key || !WEAPONS[key]) return false;
    return this.reserve >= WEAPONS[key].magSize;
  }

  /**
   * Remove one mag from active slot reserve for dropping in the world.
   * @returns {{ weapon: string }|null}
   */
  dropMagReserve() {
    if (!this.canDropMag()) return null;
    const key = this.key;
    this._states[this._activeSlot].reserve -= WEAPONS[key].magSize;
    this.onAmmoChanged?.();
    return { weapon: key };
  }

  slotOccupancy() {
    return {
      primary: this.hasSlot('primary'),
      side:    this.hasSlot('side'),
    };
  }

  /** @param {string} initialKey */
  _initDefaultSlots(initialKey) {
    const loadout = WEAPONS[initialKey] ? initialKey : 'assault_rifle';
    this._loadoutKey = loadout;
    /** @type {{ primary: string|null, side: string|null }} */
    this._slotKeys = { primary: loadout, side: null };
    this._states = {
      primary: this._freshSlotState(loadout),
      side:    this._freshSlotState(SIDE_WEAPON_KEY),
    };
    this._ensureSidearm();
  }

  /** Slot 2 always starts with the default sidearm (pistol). */
  _ensureSidearm() {
    this._slotKeys.side = SIDE_WEAPON_KEY;
    if (!this._states.side || this._states.side.key !== SIDE_WEAPON_KEY) {
      this._states.side = this._freshSlotState(SIDE_WEAPON_KEY);
    }
  }

  _freshSlotState(key) {
    const d = WEAPONS[key];
    return { key, ammo: d.magSize, reserve: d.reserve };
  }

  _cancelReload() {
    clearTimeout(this._reloadTimer);
    this.reloading     = false;
    this._reloadAnimOn = false;
  }

  /** True if any slot is below full ammo/reserve. */
  needsResupply() {
    for (const slot of ['primary', 'side']) {
      if (!this._slotKeys[slot]) continue;
      const st = this._states[slot];
      const d  = WEAPONS[st.key];
      if (st.ammo < d.magSize || st.reserve < d.reserve) return true;
    }
    return false;
  }

  /** Swap between slot 1 and slot 2. */
  switchToSlot(slot) {
    if (slot !== 'primary' && slot !== 'side') return;
    if (!this._slotKeys[slot]) return;
    if (slot === this._activeSlot) return;
    if (this._throwAnimOn) return;
    this._cancelReload();
    this._activeSlot = slot;
    this.setADS(false);
    this._sprintBlend = 0;
    this._buildModel(this.key);
    this.onReloadComplete?.();
    this.onAmmoChanged?.();
    this.onWeaponChanged?.(this.def.name);
    this.onSlotChanged?.(slot);
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
    return this.hasSlot(this._activeSlot)
        && !this._throwAnimOn
        && !this.reloading
        && this.ammo > 0
        && nowMs - this._lastShotMs >= this.fireInterval;
  }

  /** True when dry-fire click should play (no fire-rate gate). */
  isEmpty() {
    return this.ammo <= 0 && this.reserve === 0 && !this.reloading;
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
    this._emitMuzzleEffects();
    this.onAmmoChanged?.();
  }

  /** Dry-fire click — always audible per trigger attempt (not gated by fire rate). */
  clickEmpty() {
    sound.play('empty_click', { volume: 0.6 });
  }

  /** Full mag + full reserve for every slot (ammo chest / resupply). */
  refillAmmo() {
    this._cancelReload();
    for (const slot of ['primary', 'side']) {
      if (this._slotKeys[slot]) {
        this._states[slot] = this._freshSlotState(this._slotKeys[slot]);
      }
    }
    this.onReloadComplete?.();
    this.onAmmoChanged?.();
  }

  reload() {
    if (this._throwAnimOn || this.reloading || this.ammo === this.def.magSize || this.reserve === 0) return;
    this.reloading     = true;
    this._reloadAnimT  = 0;
    this._reloadAnimOn = true;

    this.onReloadStart?.();
    sound.playReload(this.key, { volume: 0.8 });

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

  /** Swap loadout weapon in slot 1 (lobby selection). */
  equip(key) {
    if (!WEAPONS[key]) return;
    this._cancelReload();
    this._loadoutKey = key;
    this._slotKeys.primary = key;
    this._states.primary = this._freshSlotState(key);
    this._ensureSidearm();
    if (this._activeSlot === 'primary') {
      this.setADS(false);
      this._sprintBlend = 0;
      this._buildModel(key);
      this.onReloadComplete?.();
      this.onAmmoChanged?.();
      this.onWeaponChanged?.(this.def.name);
    }
  }

  /**
   * Pick up a world weapon — fills the first empty slot, otherwise replaces the active slot.
   * @returns {'primary'|'side'|null}
   */
  pickupWeapon(key, ammoState = null) {
    if (!WEAPONS[key]) return null;
    const slot = this._findEmptySlot() ?? this._activeSlot;
    this._cancelReload();
    this._slotKeys[slot] = key;
    this._states[slot] = ammoState ?? this._freshSlotState(key);
    this._activeSlot = slot;
    this.setADS(false);
    this._sprintBlend = 0;
    this._buildModel(key);
    this.onReloadComplete?.();
    this.onAmmoChanged?.();
    this.onWeaponChanged?.(this.def.name);
    this.onSlotChanged?.(slot);
    return slot;
  }

  /** @returns {'primary'|'side'|null} */
  _findEmptySlot() {
    if (!this.hasSlot('primary')) return 'primary';
    if (!this.hasSlot('side')) return 'side';
    return null;
  }

  /** @deprecated use pickupWeapon */
  pickupPrimary(key, ammoState = null) {
    return this.pickupWeapon(key, ammoState);
  }

  /**
   * Drop weapon from the active slot.
   * @returns {{ key: string, ammo: number, reserve: number }|null}
   */
  dropPrimary() {
    return this._dropFromSlot(this._activeSlot);
  }

  /** @param {'primary'|'side'} slot */
  _dropFromSlot(slot) {
    const key = this._slotKeys[slot];
    if (!key || !DROPPABLE_WEAPONS.has(key)) return null;
    const state = {
      key,
      ammo:    this._states[slot].ammo,
      reserve: this._states[slot].reserve,
    };
    this._cancelReload();
    this._slotKeys[slot] = null;
    if (slot === this._activeSlot) {
      const other = slot === 'primary' ? 'side' : 'primary';
      if (this._slotKeys[other]) {
        this._activeSlot = other;
        this.setADS(false);
        this._sprintBlend = 0;
        this._buildModel(this.key);
        this.onReloadComplete?.();
        this.onAmmoChanged?.();
        this.onWeaponChanged?.(this.def.name);
        this.onSlotChanged?.(this._activeSlot);
      } else if (this.group) {
        this.group.visible = false;
      }
    }
    return state;
  }

  /**
   * Play throw animation, then invoke callback with dropped weapon state.
   * @param {(state: { key: string, ammo: number, reserve: number }) => void} onComplete
   * @returns {boolean}
   */
  beginThrow(onComplete) {
    if (this._throwAnimOn) return false;
    const slot = this._activeSlot;
    const key  = this._slotKeys[slot];
    if (!key || !DROPPABLE_WEAPONS.has(key)) return false;
    this._cancelReload();
    this._throwPending = {
      key,
      ammo:    this._states[slot].ammo,
      reserve: this._states[slot].reserve,
    };
    this._throwAnimT    = 0;
    this._throwAnimOn   = true;
    this._throwCallback = onComplete;
    return true;
  }

  /** @returns {{ key: string, ammo: number, reserve: number }|null} */
  getPrimaryState() {
    if (!this._slotKeys.primary) return null;
    return {
      key:     this._slotKeys.primary,
      ammo:    this._states.primary.ammo,
      reserve: this._states.primary.reserve,
    };
  }

  /** Reset both slots to loadout + sidearm (respawn / round reset). */
  resetAll() {
    this._cancelReload();
    this._throwAnimOn   = false;
    this._throwPending  = null;
    this._throwCallback = null;
    this._activeSlot = 'primary';
    this._initDefaultSlots(this._loadoutKey);
    this.setADS(false);
    this._sprintBlend = 0;
    this._buildModel(this.key);
    if (this.group) this.group.visible = !this._viewSuppressed;
    this.onReloadComplete?.();
    this.onAmmoChanged?.();
    this.onWeaponChanged?.(this.def.name);
    this.onSlotChanged?.(this._activeSlot);
  }

  toggleADS() { this.setADS(!this.isADS); }

  setADS(on) {
    this.isADS     = on;
    this.targetFov = on ? this._baseFov / this.def.zoom : this._baseFov;
  }

  /** Game must call this each frame so weapon can widen spread when player is hit. */
  setHitShake(s) { this._hitShake = s; }

  /** True when the viewmodel is in tactical high-ready sprint pose. */
  get isTacticalSprint() { return this._sprintBlend > 0.5; }

  /** Hide FP weapon while holding a grenade. */
  setViewSuppressed(on) {
    this._viewSuppressed = on;
    if (this.group) this.group.visible = !on;
  }

  // ── Per-frame update ───────────────────────────────────────

  /**
   * @param {number}  delta      — seconds since last frame
   * @param {boolean} moving     — player is moving
   * @param {boolean} isFiring   — mouse held / spraying
   * @param {boolean} sprinting  — tactical sprint (Shift + move)
   */
  update(delta, moving, isFiring, sprinting = false) {
    // FOV lerp (ADS)
    if (Math.abs(this._camera.fov - this.targetFov) > 0.3) {
      this._camera.fov = THREE.MathUtils.lerp(this._camera.fov, this.targetFov, 0.18);
      this._camera.updateProjectionMatrix();
    }

    if (this._throwAnimOn) {
      this._throwAnimT += delta;
      const t = Math.min(this._throwAnimT / THROW_DURATION, 1);
      const e = 1 - (1 - t) * (1 - t);
      if (this.group) {
        this.group.position.set(
          REST_POS.x + e * 0.38,
          REST_POS.y + Math.sin(t * Math.PI) * 0.22 - e * 0.08,
          REST_POS.z - e * 0.72,
        );
        this.group.rotation.set(-e * 2.1, e * 0.65, e * 0.42);
        this.group.visible = !this._viewSuppressed;
      }
      if (t >= 1) {
        const pending = this._throwPending;
        const cb      = this._throwCallback;
        this._throwAnimOn   = false;
        this._throwPending  = null;
        this._throwCallback = null;
        const slot = this._activeSlot;
        this._slotKeys[slot] = null;
        const other = slot === 'primary' ? 'side' : 'primary';
        if (this.group) {
          this.group.position.copy(REST_POS);
          this.group.rotation.set(0, 0, 0);
        }
        if (this._slotKeys[other]) {
          this._activeSlot = other;
          this._buildModel(this.key);
          this.onReloadComplete?.();
          this.onAmmoChanged?.();
          this.onWeaponChanged?.(this.def.name);
          this.onSlotChanged?.(this._activeSlot);
        } else if (this.group) {
          this.group.visible = false;
        }
        cb?.(pending);
      }
      return;
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

    const inCombatPose = isFiring || this.isADS || this._reloadAnimOn;

    // Tactical sprint pose (viewmodel — does not move camera / crosshair)
    const wantSprint = sprinting && moving && !inCombatPose;
    if (wantSprint) {
      this._sprintBlend = Math.min(1, this._sprintBlend + delta * 9);
    } else {
      this._sprintBlend = Math.max(0, this._sprintBlend - delta * 12);
    }

    this._sprintPhase += delta * 11;
    const shake = this._sprintBlend * 0.014;
    const shX   = Math.sin(this._sprintPhase * 1.3) * shake;
    const shY   = Math.sin(this._sprintPhase * 1.7) * shake;
    const shZ   = Math.cos(this._sprintPhase * 1.1) * shake * 0.6;

    // Head bob (combat)
    this._bobPhase += delta * (moving ? 7.5 : 2.0);
    const bobAmt = moving ? 1 : 0.3;
    const bobX   = Math.sin(this._bobPhase) * 0.010 * bobAmt;
    const bobY   = Math.abs(Math.cos(this._bobPhase * 0.5)) * 0.007 * bobAmt;

    // Walk-only gun bob on Y (combat pose, not sprinting)
    let walkGunY = 0;
    if (moving && this._sprintBlend < 0.2 && !inCombatPose) {
      this._walkPhase += delta * 5.8;
      walkGunY = Math.sin(this._walkPhase) * 0.032;
    }

    // Reload animation (sinusoidal drop + tilt, peaks at mid-reload)
    let reloadDrop = 0, reloadTilt = 0;
    if (this._reloadAnimOn) {
      this._reloadAnimT = Math.min(1, this._reloadAnimT + delta / (this.def.reloadTime / 1000));
      const t = this._reloadAnimT;
      reloadDrop = Math.sin(t * Math.PI) * 0.22;
      reloadTilt = Math.sin(t * Math.PI) * 0.45;
    }

    const sb = this._sprintBlend;
    const cx = REST_POS.x + bobX;
    const cy = REST_POS.y - bobY - reloadDrop + walkGunY;
    const cz = REST_POS.z - this._recoilZ;

    if (this.group && !this._viewSuppressed) {
      this.group.position.set(
        THREE.MathUtils.lerp(cx, SPRINT_POS.x + shX, sb),
        THREE.MathUtils.lerp(cy, SPRINT_POS.y + shY, sb),
        THREE.MathUtils.lerp(cz, SPRINT_POS.z + shZ, sb),
      );
      this.group.rotation.x = THREE.MathUtils.lerp(
        this._recoilRotX,
        SPRINT_ROT.x + shY * 2,
        sb,
      );
      this.group.rotation.y = THREE.MathUtils.lerp(0, SPRINT_ROT.y, sb);
      this.group.rotation.z = THREE.MathUtils.lerp(reloadTilt, SPRINT_ROT.z + shX * 3, sb);
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

    const wDef = WEAPONS[key];
    const MATS = _weaponMaterials(key);
    const group = _assembleWeaponParts(key, MATS);

    // Muzzle flash positioned at the bore axis tip for this weapon
    const flashPos = FLASH_OFFSET[key] ?? FLASH_OFFSET.assault_rifle;
    this._flash = this._buildMuzzleFlash(key);
    this._flash.position.copy(flashPos);
    this._flash.visible = false;
    group.add(this._flash);

    group.position.copy(REST_POS);
    group.visible = !this._viewSuppressed;
    this._camera.add(group);
    this.group = group;
  }

  _buildMuzzleFlash(weaponKey) {
    const g = new THREE.Group();
    const ar = weaponKey === 'assault_rifle';
    const s  = ar ? 1.22 : 1;
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffee, transparent: true, opacity: 1, depthWrite: false,
    });
    const hotMat = new THREE.MeshBasicMaterial({
      color: 0xffaa33, transparent: true, opacity: ar ? 1 : 0.95, depthWrite: false,
    });
    const flareMat = new THREE.MeshBasicMaterial({
      color: 0xff6600, transparent: true, opacity: ar ? 0.88 : 0.75, depthWrite: false,
    });

    g.add(new THREE.Mesh(
      new THREE.BoxGeometry(0.018 * s, 0.018 * s, 0.04 * s),
      coreMat,
    ));

    const petals = [
      [0.055, 0.012, 0.008, 0, 0, 0],
      [0.055, 0.012, 0.008, 0, Math.PI / 2, 0],
      [0.04, 0.008, 0.006, 0, 0, Math.PI / 4],
      [0.04, 0.008, 0.006, 0, 0, -Math.PI / 4],
      [0.032, 0.006, 0.05, Math.PI / 2, 0, 0],
      [0.028, 0.005, 0.038, 0, Math.PI / 3, Math.PI / 6],
    ];
    petals.forEach(([w, h, d, rx, ry, rz]) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w * s, h * s, d * s),
        flareMat.clone(),
      );
      m.rotation.set(rx, ry, rz);
      g.add(m);
    });

    const side = new THREE.Mesh(
      new THREE.BoxGeometry(0.09 * s, 0.025 * s, 0.012 * s),
      hotMat,
    );
    side.rotation.z = Math.PI / 2;
    g.add(side);

    const light = new THREE.PointLight(0xff9922, ar ? 7.2 : 5, ar ? 3.6 : 2.8);
    g.add(light);
    g.userData.muzzleLight = light;
    g.userData.arBloom = ar;
    return g;
  }

  _showFlash() {
    if (!this._flash) return;
    const ar = this._flash.userData.arBloom;
    const ads = this.isADS;
    const bloom = ar ? (ads ? 1.18 : 1.28) : 1;
    const light = this._flash.userData.muzzleLight;
    if (light) {
      light.intensity = (ar ? 7.2 : 5) * bloom;
      light.distance  = ar ? (ads ? 3.8 : 4.0) : 2.8;
    }
    this._flash.visible = true;
    this._flash.rotation.z = Math.random() * Math.PI * 2;
    this._flash.scale.setScalar(bloom);
    clearTimeout(this._flashOff);
    this._flashOff = setTimeout(() => {
      this._flash.visible = false;
      this._flash.scale.setScalar(1);
      if (light) {
        light.intensity = ar ? 7.2 : 5;
        light.distance  = ar ? 3.6 : 2.8;
      }
    }, ar ? 56 : 48);
  }

  _emitMuzzleEffects() {
    if (!this._flash || !this.onMuzzleEffects) return;
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3(0, 0, -1);
    this._flash.getWorldPosition(pos);
    this._flash.getWorldDirection(dir);
    this.onMuzzleEffects(pos, dir);
  }
}
