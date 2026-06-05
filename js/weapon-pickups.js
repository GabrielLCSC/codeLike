// ═══════════════════════════════════════════════════════════
//  WARFRONT — Ground weapon pickups
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { buildWeaponWorldModel } from './weapons/gun-parts.js';
import { makeLabelTexture } from './ui/label-texture.js';

export { makeLabelTexture } from './ui/label-texture.js';

/** Display labels for dropped / map weapons. */
export const PICKUP_LABELS = {
  ak47:          'AK47',
  assault_rifle: 'AR',
  shotgun:       'SG',
  sniper:        'SR',
  pistol:        'PI',
};

/**
 * @param {string} weapon
 * @returns {string}
 */
export function pickupLabelFor(weapon) {
  return PICKUP_LABELS[weapon] ?? WEAPONS[weapon]?.name ?? weapon.toUpperCase();
}

function buildPickupVisual(weapon, label) {
  const root = new THREE.Group();

  const gun = buildWeaponWorldModel(weapon);
  root.add(gun);

  const labelTex = makeLabelTexture(label);
  const labelMat = new THREE.MeshBasicMaterial({
    map: labelTex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.22), labelMat);
  labelMesh.position.set(0, 0.32, 0);
  labelMesh.rotation.x = -Math.PI / 2;
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
  highlight.position.y = 0.04;
  highlight.visible = false;
  highlight.userData.ignoreRaycast = true;
  root.add(highlight);

  const glow = new THREE.PointLight(0x00ff88, 0, 3.5);
  glow.position.set(0, 0.2, 0);
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
 *   kind: 'map'|'ground',
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
    /** @type {Set<string>} */
    this._highlightIds = new Set();
    this._pulse = 0;
  }

  /** @param {Array<{ id: string, weapon: string, label?: string, x: number, z: number, rotY?: number }>} defs */
  initMapPickups(defs) {
    for (const d of defs ?? []) {
      this._addPickup({
        id:     d.id,
        weapon: d.weapon,
        label:  d.label ?? pickupLabelFor(d.weapon),
        x:      d.x,
        y:      0.02,
        z:      d.z,
        rotY:   d.rotY ?? Math.random() * Math.PI * 2,
        kind:   'map',
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
      y:       0.02,
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
    this._highlightIds.delete(id);
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

  /**
   * Highlight every pickup visible from the player (any distance, blocked by walls).
   * @param {number} px
   * @param {number} pz
   * @param {{ hasLOS: (x1: number, z1: number, x2: number, z2: number) => boolean }|null} map
   */
  updateHighlights(px, pz, map) {
    const next = new Set();
    for (const p of this._pickups.values()) {
      if (p.taken) continue;
      if (!map || map.hasLOS(px, pz, p.x, p.z)) next.add(p.id);
    }
    if (next.size === this._highlightIds.size) {
      let same = true;
      for (const id of next) {
        if (!this._highlightIds.has(id)) { same = false; break; }
      }
      if (same) return;
    }
    for (const p of this._pickups.values()) {
      const show = next.has(p.id);
      if (p.group.userData.highlight) p.group.userData.highlight.visible = show;
      if (p.group.userData.glow) p.group.userData.glow.intensity = show ? 1.4 : 0;
    }
    this._highlightIds = next;
  }

  /** @param {number} dt */
  updatePulse(dt) {
    if (this._highlightIds.size === 0) return;
    this._pulse += dt * 5;
    const s = 1 + Math.sin(this._pulse) * 0.08;
    const opacity = 0.45 + Math.sin(this._pulse * 1.4) * 0.22;
    const glowI = 1.2 + Math.sin(this._pulse * 1.4) * 0.5;
    for (const id of this._highlightIds) {
      const p = this._pickups.get(id);
      if (!p?.group.userData.highlight) continue;
      p.group.userData.highlight.scale.set(s, s, 1);
      p.group.userData.highlight.material.opacity = opacity;
      if (p.group.userData.glow) p.group.userData.glow.intensity = glowI;
    }
  }

  /** @param {string} id @returns {WeaponPickup|undefined} */
  get(id) { return this._pickups.get(id); }

  resetMapPickups() {
    for (const p of this._pickups.values()) {
      if (p.kind !== 'map') continue;
      p.taken = false;
      p.group.visible = true;
    }
    this._highlightIds.clear();
  }

  clearGround() {
    for (const [id, p] of this._pickups) {
      if (p.kind !== 'ground') continue;
      this.scene.remove(p.group);
      this._pickups.delete(id);
      this._highlightIds.delete(id);
    }
  }

  /** @private */
  _addPickup(def) {
    const group = buildPickupVisual(def.weapon, def.label);
    group.position.set(def.x, def.y, def.z);
    group.rotation.y = def.rotY;
    this.scene.add(group);
    /** @type {WeaponPickup} */
    const entry = { ...def, taken: false, group };
    this._pickups.set(def.id, entry);
  }
}
