// ═══════════════════════════════════════════════════════════
//  WARFRONT — Procedural + GLB meshes for map editor assets
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { CELL_SIZE, WALL_HEIGHT } from '../config.js';
import { getAssetDef, orientedFootprint } from './asset-catalog.js';
import { cloneMapModel } from './model-loader.js';

const CS = CELL_SIZE;
const WH = WALL_HEIGHT;

const ASSET_COLORS = {
  wall:        0x4a5568,
  cover:       0x6b5344,
  crate:       0x8b6914,
  pillar:      0x3d4450,
  barrier:     0x7a7a82,
  sandbags:    0x6a5c48,
  dumpster:    0x3d4a32,
  container:   0x4a5568,
  lamp:        0x8899aa,
  spawn_pvp:   0x44cc66,
  spawn_pve:   0xffaa44,
  spawn_alpha: 0x4488ff,
  spawn_omega: 0xff4444,
  ammo_chest:  0xc4a035,
};

function boxMesh(w, h, d, color, x = 0, y = 0, z = 0) {
  const mat = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildBarrier() {
  const g = new THREE.Group();
  g.add(boxMesh(CS * 0.82, 0.55, CS * 0.38, 0x7a7a82, 0, 0.28, 0));
  const top = boxMesh(CS * 0.78, 0.22, CS * 0.34, 0x686870, 0, 0.62, 0.04);
  top.rotation.y = 0.08;
  g.add(top);
  return g;
}

function buildSandbags() {
  const g = new THREE.Group();
  const c = 0x6a5c48;
  g.add(boxMesh(CS * 0.38, 0.28, CS * 0.28, c, -CS * 0.18, 0.14, 0));
  g.add(boxMesh(CS * 0.38, 0.28, CS * 0.28, c, CS * 0.18, 0.14, 0));
  g.add(boxMesh(CS * 0.36, 0.24, CS * 0.26, 0x5a4e3c, 0, 0.38, 0));
  return g;
}

function buildDumpster() {
  const g = new THREE.Group();
  const body = boxMesh(CS * 1.85, 0.95, CS * 0.88, 0x3d4a32, 0, 0.48, 0);
  g.add(body);
  g.add(boxMesh(CS * 1.88, 0.12, CS * 0.9, 0x4a5a3a, 0, 0.99, 0));
  g.add(boxMesh(CS * 1.9, 0.08, CS * 0.92, 0xc4a035, 0, 0.72, 0));
  return g;
}

function buildContainer() {
  const g = new THREE.Group();
  const [fw, fh] = [3, 2];
  const w = fw * CS * 0.96;
  const d = fh * CS * 0.96;
  g.add(boxMesh(w, WH * 0.92, d, 0x4a5568, 0, WH * 0.46, 0));
  g.add(boxMesh(w * 0.98, 0.12, d * 0.98, 0x3d4450, 0, WH * 0.92 + 0.06, 0));
  const stripe = boxMesh(0.08, WH * 0.75, d * 0.95, 0xc4a035, -w * 0.42, WH * 0.45, 0);
  g.add(stripe);
  return g;
}

function buildLamp() {
  const g = new THREE.Group();
  g.add(boxMesh(0.14, 3.2, 0.14, 0x555560, 0, 1.6, 0));
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 10, 10),
    new THREE.MeshLambertMaterial({
      color: 0xffcc88,
      emissive: 0xff9933,
      emissiveIntensity: 0.6,
    }),
  );
  bulb.position.y = 3.25;
  g.add(bulb);
  return g;
}

function buildBasicBox(type) {
  const color = ASSET_COLORS[type] ?? 0x888888;
  if (type === 'wall' || type === 'pillar') {
    return new THREE.Mesh(
      new THREE.BoxGeometry(CS * 0.92, WH, CS * 0.92),
      new THREE.MeshLambertMaterial({ color }),
    );
  }
  if (type === 'ammo_chest') {
    return new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.8, 0.9),
      new THREE.MeshLambertMaterial({ color }),
    );
  }
  return new THREE.Mesh(
    new THREE.BoxGeometry(CS * 0.85, 1.1, CS * 0.85),
    new THREE.MeshLambertMaterial({ color }),
  );
}

const PROCEDURAL_BUILDERS = {
  barrier:   buildBarrier,
  sandbags:  buildSandbags,
  dumpster:  buildDumpster,
  container: buildContainer,
  lamp:      buildLamp,
};

/**
 * Build a scene object for a placed map asset.
 * @param {import('./map-schema.js').MapAsset} asset
 * @param {{ editor?: boolean }} [opts]
 * @returns {THREE.Object3D|null}
 */
export function buildMapAssetObject(asset, opts = {}) {
  const def = getAssetDef(asset);
  if (!def) return null;

  if (asset.type.startsWith('spawn_') || asset.type === 'ammo_chest') {
    return null;
  }

  let obj;

  if (asset.type === 'model' && asset.modelId) {
    obj = cloneMapModel(asset.modelId);
    if (!obj) return null;
    const yOff = def.yOffset ?? 0;
    if (yOff) obj.position.y += yOff;
  } else if (PROCEDURAL_BUILDERS[asset.type]) {
    obj = PROCEDURAL_BUILDERS[asset.type]();
  } else {
    obj = buildBasicBox(asset.type);
  }

  const [fw, fh] = orientedFootprint(def.footprint, asset.rotY ?? 0);
  const isMulti = fw > 1 || fh > 1;
  const centerX = asset.x;
  const centerZ = asset.z;

  if (asset.type === 'wall' || asset.type === 'pillar') {
    obj.position.set(centerX, WH * 0.5, centerZ);
  } else if (asset.type === 'model') {
    obj.position.set(centerX, asset.y ?? 0, centerZ);
  } else if (asset.type === 'container') {
    obj.position.set(centerX, 0, centerZ);
  } else if (asset.type === 'dumpster') {
    obj.position.set(centerX, 0, centerZ);
  } else if (asset.type === 'lamp') {
    obj.position.set(centerX, 0, centerZ);
  } else if (isMulti) {
    obj.position.set(centerX, 0, centerZ);
  } else if (PROCEDURAL_BUILDERS[asset.type]) {
    obj.position.set(centerX, 0, centerZ);
  } else {
    obj.position.set(centerX, 0.55, centerZ);
  }

  if (asset.rotY) obj.rotation.y = asset.rotY;

  if (opts.editor && !def.blocks) {
    obj.traverse(c => {
      if (c.isMesh && c.material) {
        c.material = c.material.clone();
        c.material.transparent = true;
        c.material.opacity = 0.85;
      }
    });
  }

  obj.traverse(c => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });

  obj.userData.editorAssetId = asset.id;
  return obj;
}

export { ASSET_COLORS };
