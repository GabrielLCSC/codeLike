// ═══════════════════════════════════════════════════════════
//  WARFRONT — Wall + ground weapon pickups
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { WEAPONS } from './config.js';

/** Display labels for dropped / wall weapons. */
export const PICKUP_LABELS = {
  ak47:          'AK47',
  assault_rifle: 'AR',
  shotgun:       'SG',
  sniper:        'SR',
};

/**
 * @param {string} weapon
 * @returns {string}
 */
export function pickupLabelFor(weapon) {
  return PICKUP_LABELS[weapon] ?? WEAPONS[weapon]?.name ?? weapon.toUpperCase();
}

/**
 * @param {string} label
 * @returns {THREE.CanvasTexture}
 */
export function makeLabelTexture(label) {
  const canvas = document.createElement('canvas');
  canvas.width  = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 36px "Courier New", monospace';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width / 2, 40);
  const metrics = ctx.measureText(label);
  const x0 = canvas.width / 2 - metrics.width / 2;
  const x1 = canvas.width / 2 + metrics.width / 2;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0, 58);
  ctx.lineTo(x1, 58);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** AK47 wall prop — wood furniture, curved mag, protruding from bracket. */
function buildAk47WallMesh() {
  const woodMat  = new THREE.MeshLambertMaterial({ color: 0x5c4030 });
  const bodyMat  = new THREE.MeshLambertMaterial({ color: 0x2a2828 });
  const metalMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  const group = new THREE.Group();

  const addBox = (w, h, d, x, y, z, mat, rot) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(...rot);
    m.castShadow = true;
    group.add(m);
  };

  addBox(0.12, 0.20, 0.22, 0, 0, 0.08, metalMat);
  addBox(0.048, 0.044, 0.24, 0, 0.02, 0.32, bodyMat);
  addBox(0.012, 0.012, 0.28, 0, 0.034, 0.14, metalMat);
  addBox(0.036, 0.078, 0.042, 0, -0.04, 0.38, bodyMat);
  addBox(0.030, 0.068, 0.038, 0, -0.08, 0.30, bodyMat, [0.42, 0, 0.08]);
  addBox(0.038, 0.034, 0.14, 0, 0.01, 0.50, woodMat);
  addBox(0.042, 0.028, 0.10, 0, 0.03, 0.58, woodMat);
  group.rotation.x = -0.06;
  return group;
}

/** Generic ground / wall gun mesh by weapon key. */
function buildPickupGunMesh(weapon) {
  if (weapon === 'ak47') return buildAk47WallMesh();

  const def = WEAPONS[weapon] ?? WEAPONS.assault_rifle;
  const bodyMat  = new THREE.MeshLambertMaterial({ color: def.bodyColor });
  const metalMat = new THREE.MeshLambertMaterial({ color: def.barrelColor });
  const stockMat = new THREE.MeshLambertMaterial({ color: def.stockColor ?? def.bodyColor });
  const group = new THREE.Group();
  const addBox = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    group.add(m);
  };
  addBox(0.046, 0.042, 0.22, 0, 0.02, 0, bodyMat);
  addBox(0.012, 0.012, 0.26, 0, 0.036, -0.12, metalMat);
  addBox(0.032, 0.07, 0.04, 0, -0.05, 0.06, bodyMat);
  addBox(0.034, 0.028, 0.12, 0, 0, 0.14, stockMat);
  group.rotation.x = Math.PI / 2;
  return group;
}

function buildPickupVisual(weapon, label, { wall = false } = {}) {
  const root = new THREE.Group();

  if (wall) {
    const bracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.18, 0.32),
      new THREE.MeshLambertMaterial({ color: 0x333338 }),
    );
    bracket.position.set(0, 0, 0.06);
    root.add(bracket);
  }

  const gun = buildPickupGunMesh(weapon);
  if (wall) {
    gun.position.set(0, 0, 0.28);
  } else {
    gun.position.set(0, 0.08, 0);
    gun.rotation.z = Math.random() * 0.3 - 0.15;
  }
  root.add(gun);

  const labelTex = makeLabelTexture(label);
  const labelMat = new THREE.MeshBasicMaterial({
    map: labelTex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const labelMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(wall ? 0.78 : 0.62, wall ? 0.28 : 0.22),
    labelMat,
  );
  labelMesh.position.set(0, wall ? 0.48 : 0.28, wall ? 0.38 : 0);
  if (!wall) labelMesh.rotation.x = -Math.PI / 2;
  labelMesh.userData.ignoreRaycast = true;
  root.add(labelMesh);

  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00ff88,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const highlight = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 32), ringMat);
  highlight.rotation.x = -Math.PI / 2;
  highlight.position.y = wall ? 0.02 : 0.04;
  highlight.visible = false;
  highlight.userData.ignoreRaycast = true;
  root.add(highlight);

  const glow = new THREE.PointLight(0x00ff88, 0, 3.5);
  glow.position.set(0, 0.2, 0.2);
  root.add(glow);

  root.userData.highlight = highlight;
  root.userData.glow = glow;
  return root;
}

/**
 * @typedef {{
 *   id: string,
 *   weapon: string,
 *   label: string,
 *   x: number, y: number, z: number,
 *   rotY: number,
 *   kind: 'wall'|'ground',
 *   taken: boolean,
 *   ammo?: number,
 *   reserve?: number,
 *   group: THREE.Group,
 * }} WeaponPickup
 */

export class WeaponPickupManager {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    /** @type {Map<string, WeaponPickup>} */
    this._pickups = new Map();
    this._highlightId = null;
    this._pulse = 0;
  }

  /** @param {Array<{ id: string, weapon: string, label?: string, x: number, y: number, z: number, rotY: number }>} defs */
  initWallPickups(defs) {
    for (const d of defs ?? []) {
      this._addPickup({
        id:     d.id,
        weapon: d.weapon,
        label:  d.label ?? pickupLabelFor(d.weapon),
        x: d.x, y: d.y, z: d.z,
        rotY:   d.rotY,
        kind:   'wall',
      });
    }
  }

  /**
   * @param {{ id: string, weapon: string, x: number, z: number, ammo?: number, reserve?: number, rotY?: number, label?: string }} opts
   */
  spawnGround(opts) {
    this._addPickup({
      id:      opts.id,
      weapon:  opts.weapon,
      label:   opts.label ?? pickupLabelFor(opts.weapon),
      x:       opts.x,
      y:       0.12,
      z:       opts.z,
      rotY:    opts.rotY ?? Math.random() * Math.PI * 2,
      kind:    'ground',
      ammo:    opts.ammo,
      reserve: opts.reserve,
    });
  }

  /** @param {string} id */
  remove(id) {
    const p = this._pickups.get(id);
    if (!p) return;
    p.taken = true;
    p.group.visible = false;
    if (this._highlightId === id) this._highlightId = null;
  }

  /** @returns {WeaponPickup|null} */
  findNearest(px, pz, radius) {
    const r2 = radius * radius;
    let best = null;
    let bestD = Infinity;
    for (const p of this._pickups.values()) {
      if (p.taken) continue;
      const dx = px - p.x;
      const dz = pz - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= r2 && d2 < bestD) {
        bestD = d2;
        best = p;
      }
    }
    return best;
  }

  /** @param {string|null} nearId */
  setHighlight(nearId) {
    if (nearId === this._highlightId) return;
    if (this._highlightId) {
      const prev = this._pickups.get(this._highlightId);
      if (prev?.group.userData.highlight) prev.group.userData.highlight.visible = false;
      if (prev?.group.userData.glow) prev.group.userData.glow.intensity = 0;
    }
    this._highlightId = nearId;
    if (nearId) {
      const p = this._pickups.get(nearId);
      if (p?.group.userData.highlight) p.group.userData.highlight.visible = true;
      if (p?.group.userData.glow) p.group.userData.glow.intensity = 1.4;
    }
  }

  /** @param {number} dt */
  updatePulse(dt) {
    if (!this._highlightId) return;
    const p = this._pickups.get(this._highlightId);
    if (!p?.group.userData.highlight) return;
    this._pulse += dt * 5;
    const s = 1 + Math.sin(this._pulse) * 0.08;
    p.group.userData.highlight.scale.set(s, s, 1);
    const ring = p.group.userData.highlight;
    ring.material.opacity = 0.45 + Math.sin(this._pulse * 1.4) * 0.22;
    if (p.group.userData.glow) {
      p.group.userData.glow.intensity = 1.2 + Math.sin(this._pulse * 1.4) * 0.5;
    }
  }

  /** @param {string} id @returns {WeaponPickup|undefined} */
  get(id) { return this._pickups.get(id); }

  resetWallVisibility() {
    for (const p of this._pickups.values()) {
      if (p.kind !== 'wall') continue;
      p.taken = false;
      p.group.visible = true;
    }
  }

  clearGround() {
    for (const [id, p] of this._pickups) {
      if (p.kind !== 'ground') continue;
      this.scene.remove(p.group);
      this._pickups.delete(id);
    }
  }

  /** @private */
  _addPickup(def) {
    const group = buildPickupVisual(def.weapon, def.label, { wall: def.kind === 'wall' });
    group.position.set(def.x, def.y, def.z);
    group.rotation.y = def.rotY;
    this.scene.add(group);
    /** @type {WeaponPickup} */
    const entry = {
      ...def,
      taken: false,
      group,
    };
    this._pickups.set(def.id, entry);
  }
}
