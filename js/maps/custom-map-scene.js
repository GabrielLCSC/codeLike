// ═══════════════════════════════════════════════════════════
//  WARFRONT — Three.js scene for custom / editor maps
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { CELL_SIZE, WALL_HEIGHT } from '../config.js';
import { CUSTOM_MAP_BORDER_CELLS } from './map-schema.js';
import { buildMapAssetObject, ASSET_COLORS } from './editor-meshes.js';
import { applySceneTheme, resolveMapTheme } from './map-theme.js';

const CS = CELL_SIZE;
const WH = WALL_HEIGHT;

/**
 * @param {THREE.Scene} scene
 * @param {import('./index.js').MapGameplay} gp
 * @param {(scene: THREE.Scene, batches: object, materials: object) => void} mergeFn
 * @param {{ skipPlacedAssets?: boolean }} [opts]
 */
export function buildCustomMapScene(scene, gp, mergeFn, opts = {}) {
  if (!scene) return;
  const theme = resolveMapTheme({ theme: gp.theme });
  applySceneTheme(scene, theme);

  const pal   = gp.sceneProfile?.palette ?? {};
  const w = gp.meta.width ?? 44;
  const h = gp.meta.height ?? 44;
  const mapW = w * CS;
  const mapD = h * CS;
  const cx = mapW * 0.5;
  const cz = mapD * 0.5;

  const M = {
    asphalt:  new THREE.MeshLambertMaterial({ color: pal.asphalt ?? 0x1e1e22 }),
    concrete: new THREE.MeshLambertMaterial({ color: pal.concrete ?? 0x6a6a72 }),
    building: new THREE.MeshLambertMaterial({ color: pal.building ?? 0x4e4e56 }),
    cover:    new THREE.MeshLambertMaterial({ color: pal.cover ?? 0x58504a }),
    accent:   new THREE.MeshLambertMaterial({ color: 0xc4a035 }),
  };

  const batches = Object.fromEntries(Object.keys(M).map(k => [k, []]));
  const box = (key, bw, bh, bd, px, py, pz) => {
    const g = new THREE.BoxGeometry(bw, bh, bd);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(px, py + bh * 0.5, pz));
    batches[key].push(g);
  };

  box('asphalt', mapW, 0.15, mapD, cx, 0, cz);

  const BT = CS * CUSTOM_MAP_BORDER_CELLS;
  const BH = WH + 3;
  box('concrete', BT, BH, mapD, BT * 0.5, 0, cz);
  box('concrete', BT, BH, mapD, mapW - BT * 0.5, 0, cz);
  box('concrete', mapW, BH, BT, cx, 0, BT * 0.5);
  box('concrete', mapW, BH, BT, cx, 0, mapD - BT * 0.5);

  mergeFn(scene, batches, M);

  if (opts.skipPlacedAssets) return;

  const assets = gp.customAssets ?? [];
  for (const a of assets) {
    if (a.type.startsWith('spawn_')) continue;
    const obj = buildMapAssetObject(a);
    if (obj) {
      obj.userData.customMapAsset = true;
      scene.add(obj);
    }
  }
}

/** Editor / debug markers for spawn points (non-colliding). */
export function buildSpawnMarkers(scene, assets) {
  const group = new THREE.Group();
  group.name = 'spawn-markers';

  for (const a of assets) {
    if (!a.type.startsWith('spawn_') && a.type !== 'ammo_chest') continue;
    const color = ASSET_COLORS[a.type] ?? 0xffffff;
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const geo = a.type === 'ammo_chest'
      ? new THREE.BoxGeometry(0.9, 0.5, 0.7)
      : new THREE.CylinderGeometry(0.35, 0.35, 0.12, 12);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(a.x, a.type === 'ammo_chest' ? 0.35 : 0.2, a.z);
    m.rotation.x = a.type === 'ammo_chest' ? 0 : 0;
    m.userData.editorAssetId = a.id;
    m.userData.ignoreRaycast = true;
    group.add(m);
  }

  scene.add(group);
  return group;
}

export { ASSET_COLORS };
