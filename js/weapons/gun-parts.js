// ═══════════════════════════════════════════════════════════
//  WARFRONT — Procedural weapon mesh parts (viewmodel + world)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { WEAPONS } from '../config.js';

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

export function weaponMaterials(key) {
  const wDef = WEAPONS[key] ?? WEAPONS.assault_rifle;
  return {
    body:  new THREE.MeshLambertMaterial({ color: wDef.bodyColor }),
    metal: new THREE.MeshLambertMaterial({ color: wDef.barrelColor }),
    stock: new THREE.MeshLambertMaterial({ color: wDef.stockColor ?? wDef.bodyColor }),
    scope: new THREE.MeshLambertMaterial({ color: wDef.scopeColor ?? 0x111114 }),
  };
}

export function assembleWeaponParts(key, mats) {
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
  const gun = assembleWeaponParts(key, weaponMaterials(key));
  const root = new THREE.Group();
  gun.rotation.order = 'YXZ';
  gun.rotation.y = Math.PI / 2;
  gun.rotation.x = Math.PI / 2;
  root.add(gun);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gun);
  gun.position.y = -box.min.y + 0.04;
  return root;
}
