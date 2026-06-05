// ═══════════════════════════════════════════════════════════
//  WARFRONT — Map scene builder (grid + Three.js visuals)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP_W, MAP_H, CELL_SIZE, WALL_HEIGHT } from './config.js';
import { createMapGrid, getMapGameplay, DEFAULT_MAP_ID } from './maps/index.js';
import { buildTriLaneScene } from './maps/tri-lane-scene.js';
import { buildCustomMapScene } from './maps/custom-map-scene.js';
import { mapDataToGameplay } from './maps/map-schema.js';
import { registerCustomMap } from './maps/index.js';

const CS = CELL_SIZE;
const WH = WALL_HEIGHT;

export class MapGenerator {
  /**
   * @param {string} [mapId]
   */
  constructor(mapId = DEFAULT_MAP_ID) {
    this.mapId = mapId;
    this.width  = MAP_W;
    this.height = MAP_H;
    /** @type {import('./maps/map-core.js').MapGrid|null} */
    this.mapGrid = null;
    /** @type {Uint8Array[]} grid[x][z] */
    this.grid   = [];
    this.rooms  = [];
    this.spawnPoints  = [];
    this.ammoChests   = [];
    this.groundWeapons = [];
    this.groundMags    = [];
    this.lanes        = [];
    this.wallMeshes   = [];
    this.staticMeshes = [];
    /** @type {import('./maps/index.js').MapGameplay|null} */
    this.gameplay = null;
    this.lodibidonCenter = { x: 0, z: 0 };
    this.lodibidonSpawns = { alpha: [], omega: [] };
  }

  /** @param {string} [mapId] */
  generate(mapId = this.mapId) {
    this.mapId = mapId;
    this.gameplay = getMapGameplay(mapId);
    return this._applyGameplay();
  }

  /** @param {import('./maps/map-schema.js').CustomMapData} mapData */
  generateFromEditorData(mapData) {
    registerCustomMap(mapData);
    this.mapId = mapData.meta.id;
    this.gameplay = mapDataToGameplay(mapData);
    return this._applyGameplay();
  }

  _applyGameplay() {
    const gp = this.gameplay;
    this.width  = gp.meta.width ?? MAP_W;
    this.height = gp.meta.height ?? MAP_H;
    this.mapGrid = createMapGrid(this.mapId);
    this.grid     = this.mapGrid.grid;
    this.spawnPoints = gp.spawnPoints.map(s => ({ ...s }));
    this.ammoChests  = gp.ammoChests.map(c => ({ ...c }));
    this.groundWeapons = (gp.groundWeapons ?? []).map(w => ({ ...w }));
    this.groundMags    = (gp.groundMags ?? []).map(m => ({ ...m }));
    this.lanes       = [...(gp.lanes ?? [])];
    this.lodibidonCenter = { ...gp.lodibidonCenter };
    this.lodibidonSpawns = {
      alpha: gp.lodibidonSpawns.alpha.map(s => ({ ...s })),
      omega: gp.lodibidonSpawns.omega.map(s => ({ ...s })),
    };
    this.rooms       = [];
    this.wallMeshes  = [];
    this.staticMeshes = [];
    return this;
  }

  getMinimapImageData() {
    return this.mapGrid.buildMinimapImageData();
  }

  buildScene(scene) {
    const mergeFn = (s, batches, M) => this._mergeBatches(s, batches, M);
    if (this.gameplay.meta?.scene === 'custom') {
      buildCustomMapScene(scene, this.gameplay, mergeFn);
    } else {
      buildTriLaneScene(scene, this.gameplay, mergeFn);
    }
    this._buildAmmoChests(scene);
    this._buildLighting(scene);
  }

  _mergeBatches(scene, batches, M) {
    const castKeys = new Set(['building', 'concrete', 'cover', 'rust', 'accent']);
    for (const [key, geos] of Object.entries(batches)) {
      if (geos.length === 0) continue;
      const merged = mergeGeometries(geos, false);
      geos.forEach(g => g.dispose());
      if (!merged) continue;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, M[key]);
      mesh.receiveShadow = (key !== 'stripe');
      mesh.castShadow    = castKeys.has(key);
      scene.add(mesh);
      this.staticMeshes.push(mesh);
      if (castKeys.has(key)) this.wallMeshes.push(mesh);
    }
  }

  _buildAmmoChests(scene) {
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3d4a32 });
    const lidMat  = new THREE.MeshLambertMaterial({ color: 0x4a5a3a });
    const bandMat = new THREE.MeshLambertMaterial({
      color: 0xc4a035,
      emissive: 0x665522,
      emissiveIntensity: 0.45,
    });
    const markMat = new THREE.MeshLambertMaterial({ color: 0x1a1a18 });

    for (const { x, z } of this.ammoChests) {
      const g = new THREE.Group();
      g.position.set(x, 0, z);

      const base = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.72, 0.95), bodyMat);
      base.position.y = 0.36;
      base.castShadow = true;
      g.add(base);

      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.14, 0.98), lidMat);
      lid.position.y = 0.79;
      lid.castShadow = true;
      g.add(lid);

      const band = new THREE.Mesh(new THREE.BoxGeometry(1.40, 0.10, 1.02), bandMat);
      band.position.y = 0.52;
      g.add(band);

      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.04), markMat);
      mark.position.set(0, 0.58, 0.50);
      g.add(mark);

      scene.add(g);
    }
  }

  _buildLighting(scene) {
    const theme = this.gameplay?.theme ?? {};
    const prof  = this.gameplay?.sceneProfile ?? {};
    const warm  = prof.midSpace === 'exterior';

    scene.add(new THREE.AmbientLight(warm ? 0xc8c0b0 : 0xb8c8dc, warm ? 1.05 : 0.95));

    const sunColor = warm ? 0xffe8c8 : 0xfff0dd;
    const sun = new THREE.DirectionalLight(sunColor, warm ? 1.4 : 1.25);
    sun.position.set(40, 60, 20);
    scene.add(sun);

    const hemiTop = warm ? 0xc8b898 : 0x8caabb;
    scene.add(new THREE.HemisphereLight(hemiTop, 0x4a5538, warm ? 0.72 : 0.62));

    const cx = this.lodibidonCenter?.x ?? (MAP_W * CS * 0.5);
    const cz = this.lodibidonCenter?.z ?? (MAP_H * CS * 0.5);
    const midLight = new THREE.PointLight(warm ? 0xffaa66 : 0xff9933, warm ? 2.8 : 2.4, 32);
    midLight.position.set(cx, WH - 0.55, cz);
    scene.add(midLight);

    if (warm) {
      const fill = new THREE.DirectionalLight(0x8899bb, 0.35);
      fill.position.set(-30, 40, -20);
      scene.add(fill);
    }
  }

  isWall(worldX, worldZ) {
    return this.mapGrid.isWall(worldX, worldZ);
  }

  isWallThin(worldX, worldZ) {
    const r = 0.28;
    return [
      [worldX + r, worldZ],
      [worldX - r, worldZ],
      [worldX, worldZ + r],
      [worldX, worldZ - r],
    ].some(([x, z]) => this.mapGrid.cellIsBlocked(x, z));
  }

  hasLOS(x1, z1, x2, z2) {
    return this.mapGrid.hasLOS(x1, z1, x2, z2);
  }

  _cellIsWall(worldX, worldZ) {
    return this.mapGrid.cellIsBlocked(worldX, worldZ);
  }
}
