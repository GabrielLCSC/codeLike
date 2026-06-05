// ═══════════════════════════════════════════════════════════
//  WARFRONT — Ground magazine pickups
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { makeLabelTexture } from './weapon-pickups.js';

export const MAG_LABELS = {
  assault_rifle: 'MAG AR',
  ak47:          'MAG AK',
  shotgun:       'MAG SG',
  sniper:        'MAG SR',
  pistol:        'MAG PI',
};

const HIGHLIGHT_COLOR = 0x3399ff;
const HIGHLIGHT_GLOW  = 0x3399ff;

/** @param {string} weapon */
export function magLabelFor(weapon) {
  return MAG_LABELS[weapon] ?? `MAG ${(WEAPONS[weapon]?.name ?? weapon).slice(0, 6).toUpperCase()}`;
}

/** Magazine body size [w, h, d] per weapon type. */
const MAG_SIZES = {
  assault_rifle: [0.042, 0.088, 0.13],
  ak47:          [0.038, 0.092, 0.12],
  shotgun:       [0.052, 0.062, 0.15],
  sniper:        [0.036, 0.072, 0.11],
  pistol:        [0.03, 0.058, 0.055],
};

function buildMagMesh(weapon) {
  const def = WEAPONS[weapon] ?? WEAPONS.assault_rifle;
  const [w, h, d] = MAG_SIZES[weapon] ?? MAG_SIZES.assault_rifle;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: def.bodyColor });
  const metalMat = new THREE.MeshLambertMaterial({ color: def.barrelColor });

  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
  body.rotation.x = Math.PI / 2;
  body.position.y = w * 0.5 + 0.02;
  body.castShadow = true;
  group.add(body);

  const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, 0.01, d * 0.88), metalMat);
  cap.rotation.x = Math.PI / 2;
  cap.position.y = w + 0.028;
  group.add(cap);

  if (weapon === 'ak47' || weapon === 'assault_rifle') {
    const curve = new THREE.Mesh(new THREE.BoxGeometry(w * 0.85, h * 0.35, d * 0.7), bodyMat);
    curve.rotation.x = Math.PI / 2;
    curve.rotation.z = 0.22;
    curve.position.set(0, w * 0.35, d * 0.08);
    group.add(curve);
  }

  return group;
}

function buildMagPickupVisual(weapon, label) {
  const root = new THREE.Group();
  root.add(buildMagMesh(weapon));

  const labelTex = makeLabelTexture(label);
  const labelMat = new THREE.MeshBasicMaterial({
    map: labelTex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.2), labelMat);
  labelMesh.position.set(0, 0.26, 0);
  labelMesh.rotation.x = -Math.PI / 2;
  labelMesh.userData.ignoreRaycast = true;
  root.add(labelMesh);

  const ringMat = new THREE.MeshBasicMaterial({
    color: HIGHLIGHT_COLOR,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const highlight = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 32), ringMat);
  highlight.rotation.x = -Math.PI / 2;
  highlight.position.y = 0.04;
  highlight.visible = false;
  highlight.userData.ignoreRaycast = true;
  root.add(highlight);

  const glow = new THREE.PointLight(HIGHLIGHT_GLOW, 0, 3);
  glow.position.set(0, 0.16, 0);
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
 *   group: THREE.Group,
 * }} MagPickup
 */

export class MagPickupManager {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    /** @type {Map<string, MagPickup>} */
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
        label:  d.label ?? magLabelFor(d.weapon),
        x:      d.x,
        y:      0.02,
        z:      d.z,
        rotY:   d.rotY ?? Math.random() * Math.PI * 2,
        kind:   'map',
      });
    }
  }

  /** @param {{ id: string, weapon: string, x: number, z: number, rotY?: number, label?: string }} opts */
  spawnGround(opts) {
    this._addPickup({
      id:      opts.id,
      weapon:  opts.weapon,
      label:   opts.label ?? magLabelFor(opts.weapon),
      x:       opts.x,
      y:       0.02,
      z:       opts.z,
      rotY:    opts.rotY ?? Math.random() * Math.PI * 2,
      kind:    'ground',
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

  /**
   * @param {number} px
   * @param {number} pz
   * @param {number} radius
   * @param {(weapon: string) => boolean} canTake
   * @returns {MagPickup|null}
   */
  findNearestTakable(px, pz, radius, canTake) {
    const r2 = radius * radius;
    let best = null;
    let bestD = Infinity;
    for (const p of this._pickups.values()) {
      if (p.taken || !canTake(p.weapon)) continue;
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
   * Blue highlight for visible mags the player can use (has weapon + reserve room).
   * @param {number} px
   * @param {number} pz
   * @param {{ hasLOS: (x1: number, z1: number, x2: number, z2: number) => boolean }|null} map
   * @param {(weapon: string) => boolean} canTake
   */
  updateHighlights(px, pz, map, canTake) {
    const next = new Set();
    for (const p of this._pickups.values()) {
      if (p.taken || !canTake(p.weapon)) continue;
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
      if (p.group.userData.glow) p.group.userData.glow.intensity = show ? 1.3 : 0;
    }
    this._highlightIds = next;
  }

  /** @param {number} dt */
  updatePulse(dt) {
    if (this._highlightIds.size === 0) return;
    this._pulse += dt * 5;
    const s = 1 + Math.sin(this._pulse) * 0.08;
    const opacity = 0.45 + Math.sin(this._pulse * 1.4) * 0.22;
    const glowI = 1.1 + Math.sin(this._pulse * 1.4) * 0.45;
    for (const id of this._highlightIds) {
      const p = this._pickups.get(id);
      if (!p?.group.userData.highlight) continue;
      p.group.userData.highlight.scale.set(s, s, 1);
      p.group.userData.highlight.material.opacity = opacity;
      if (p.group.userData.glow) p.group.userData.glow.intensity = glowI;
    }
  }

  /** @param {string} id @returns {MagPickup|undefined} */
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
    const group = buildMagPickupVisual(def.weapon, def.label);
    group.position.set(def.x, def.y, def.z);
    group.rotation.y = def.rotY;
    this.scene.add(group);
    /** @type {MagPickup} */
    const entry = { ...def, taken: false, group };
    this._pickups.set(def.id, entry);
  }
}
