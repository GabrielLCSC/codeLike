// ═══════════════════════════════════════════════════════════
//  WARFRONT — Build mesh colliders for placed map assets
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { CELL_SIZE, WALL_HEIGHT } from '../config.js';
import { getAssetDef, orientedFootprint } from '../maps/asset-catalog.js';
import {
  cloneMapModelWithColliders,
  modelUsesMeshCollider,
} from '../maps/model-loader.js';
import { createPerimeterColliders } from './collision-world.js';

const CS = CELL_SIZE;
const WH = WALL_HEIGHT;
const _invis = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });

/**
 * @param {number} w
 * @param {number} h
 * @param {number} d
 */
function boxCollider(w, h, d) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), _invis);
  mesh.userData.isMeshCollider = true;
  mesh.position.y = h * 0.5;
  return mesh;
}

/** Footprint fallback when a GLB has no COL mesh. */
function footprintBoxCollider(asset, def) {
  const [fw, fh] = orientedFootprint(def.footprint, asset.rotY ?? 0);
  const w = fw * CS * 0.92;
  const d = fh * CS * 0.92;
  const tall = asset.type === 'wall' || asset.type === 'pillar'
    || def.gridKind === 'pillar' || def.gridKind === 'wall';
  const h = tall ? WH : (asset.type === 'container' ? WH * 0.92 : 1.1);
  return boxCollider(w, h, d);
}

/** Procedural asset dimensions (matches editor-meshes visuals). */
function proceduralCollider(asset, def) {
  const [fw, fh] = orientedFootprint(def.footprint, asset.rotY ?? 0);

  if (asset.type === 'wall' || asset.type === 'pillar') {
    return boxCollider(CS * 0.92, WH, CS * 0.92);
  }
  if (asset.type === 'dumpster') {
    return boxCollider(CS * 1.85, 0.95, CS * 0.88);
  }
  if (asset.type === 'container') {
    return boxCollider(fw * CS * 0.96, WH * 0.92, fh * CS * 0.96);
  }
  if (asset.type === 'barrier') {
    return boxCollider(CS * 0.82, 0.55, CS * 0.38);
  }
  if (asset.type === 'sandbags') {
    return boxCollider(CS * 0.78, 0.42, CS * 0.56);
  }
  if (asset.type === 'lamp') return null;

  const multi = fw > 1 || fh > 1;
  if (multi) {
    return boxCollider(fw * CS * 0.92, 1.1, fh * CS * 0.92);
  }
  return boxCollider(CS * 0.85, 1.1, CS * 0.85);
}

/**
 * @param {THREE.Object3D} group
 * @param {import('../maps/map-schema.js').MapAsset} asset
 * @param {import('../maps/asset-catalog.js').AssetToolDef} def
 */
function applyAssetTransform(group, asset, def) {
  const yOff = def.yOffset ?? 0;
  let y = asset.y ?? 0;
  if (asset.type === 'wall' || asset.type === 'pillar') y = 0;
  else if (asset.type === 'model') y = (asset.y ?? 0) + yOff;
  else if (asset.type === 'dumpster' || asset.type === 'container'
      || asset.type === 'barrier' || asset.type === 'sandbags' || asset.type === 'lamp') y = 0;
  else if (asset.type !== 'model') y = asset.y ?? 0.55;

  group.position.set(asset.x, y, asset.z);
  if (asset.rotY) group.rotation.y = asset.rotY;
}

/**
 * Build a collider group for one placed asset (invisible meshes).
 * @param {import('../maps/map-schema.js').MapAsset} asset
 * @returns {THREE.Group|null}
 */
export function buildAssetColliderGroup(asset) {
  if (asset.type.startsWith('spawn_') || asset.type === 'ammo_chest') return null;

  const def = getAssetDef(asset);
  if (!def?.blocks) return null;

  const group = new THREE.Group();
  group.name = `collider-${asset.id}`;

  if (asset.type === 'model' && asset.modelId) {
    const inst = cloneMapModelWithColliders(asset.modelId);
    if (!inst) return null;

    if (modelUsesMeshCollider(asset.modelId) && inst.colliderGroup.children.length) {
      group.add(inst.colliderGroup);
    } else {
      group.add(footprintBoxCollider(asset, def));
    }
  } else {
    const col = proceduralCollider(asset, def);
    if (!col) return null;
    group.add(col);
  }

  applyAssetTransform(group, asset, def);
  return group;
}

/**
 * Build full collider hierarchy for a custom map.
 * @param {import('../maps/map-schema.js').MapAsset[]} assets
 * @param {{ width: number, height: number }} mapSize
 * @param {number} cellSize
 * @param {number} borderCells
 */
export function buildCustomMapColliderRoot(assets, mapSize, cellSize, borderCells) {
  const root = new THREE.Group();
  root.name = 'map-colliders';

  const perimeter = createPerimeterColliders(
    mapSize.width,
    mapSize.height,
    cellSize,
    borderCells,
  );
  root.add(perimeter);

  for (const asset of assets) {
    const col = buildAssetColliderGroup(asset);
    if (col) root.add(col);
  }

  return root;
}
