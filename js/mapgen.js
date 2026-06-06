// ═══════════════════════════════════════════════════════════
//  WARFRONT — Map scene builder (grid + Three.js visuals)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP_W, MAP_H, CELL_SIZE, WALL_HEIGHT } from './config.js';
import { createMapGrid, getMapGameplay, DEFAULT_MAP_ID } from './maps/index.js';
import { buildTriLaneScene } from './maps/tri-lane-scene.js';
import { buildCustomMapScene } from './maps/custom-map-scene.js';
import { mapDataToGameplay, CUSTOM_MAP_BORDER_CELLS } from './maps/map-schema.js';
import { registerCustomMap } from './maps/index.js';
import { resolveMapTheme } from './maps/map-theme.js';
import { CollisionWorld } from './collision/collision-world.js';
import { bakeWalkGridFromCollision } from './collision/bake-walk-grid.js';
import { buildCustomMapColliderRoot } from './collision/asset-colliders.js';

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
    /** @type {import('./collision/collision-world.js').CollisionWorld|null} */
    this.collisionWorld = null;
    /** @type {THREE.Group|null} */
    this._colliderRoot = null;
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

  buildScene(scene, opts = {}) {
    const mergeFn = (s, batches, M) => this._mergeBatches(s, batches, M);
    if (this.gameplay.meta?.scene === 'custom') {
      buildCustomMapScene(scene, this.gameplay, mergeFn, {
        skipPlacedAssets: !!opts.editorMode,
      });
    } else {
      buildTriLaneScene(scene, this.gameplay, mergeFn);
    }
    this._buildAmmoChests(scene);
    this._buildLighting(scene);
  }

  /**
   * Build mesh colliders + rebake walk grid for custom maps (Blender COL assets).
   * Call after buildScene. Built-in tri-lane maps keep grid-only collision.
   * @param {THREE.Scene} scene
   * @param {{ editorAssets?: import('./maps/map-schema.js').MapAsset[] }} [opts]
   */
  finalizeMeshCollision(scene, opts = {}) {
    this._clearColliderRoot(scene);

    const isCustom = this.gameplay?.meta?.scene === 'custom';
    if (!isCustom) {
      this.collisionWorld = new CollisionWorld();
      return;
    }

    const assets = opts.editorAssets ?? this.gameplay.customAssets ?? [];
    this._colliderRoot = buildCustomMapColliderRoot(
      assets,
      { width: this.width, height: this.height },
      CS,
      CUSTOM_MAP_BORDER_CELLS,
    );
    scene.add(this._colliderRoot);

    this.collisionWorld = new CollisionWorld();
    this.collisionWorld.addRoot(this._colliderRoot);

    this._colliderRoot.traverse(c => {
      if (c.isMesh && c.userData.isMeshCollider) {
        this.staticMeshes.push(c);
      }
    });

    this.mapGrid = bakeWalkGridFromCollision(
      this.collisionWorld,
      this.width,
      this.height,
      { blockPerimeter: false },
    );
    this.grid = this.mapGrid.grid;
  }

  _clearColliderRoot(scene) {
    if (!this._colliderRoot) return;
    scene.remove(this._colliderRoot);
    this._colliderRoot.traverse(c => {
      if (c.isMesh) {
        const idx = this.staticMeshes.indexOf(c);
        if (idx >= 0) this.staticMeshes.splice(idx, 1);
      }
    });
    this._colliderRoot = null;
    this.collisionWorld = null;
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
      mesh.userData.mapGenerated = true;
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

      g.userData.mapGenerated = true;
      scene.add(g);
    }
  }

  _buildLighting(scene) {
    const isCustom = this.gameplay?.meta?.scene === 'custom';
    if (isCustom) {
      const theme = resolveMapTheme({ theme: this.gameplay.theme });
      const amb = new THREE.AmbientLight(theme.ambientColor, theme.ambientInt);
      amb.userData.mapGenerated = true;
      scene.add(amb);

      const sun = new THREE.DirectionalLight(theme.sunColor, theme.sunInt);
      sun.position.set(...theme.sunPos);
      sun.userData.mapGenerated = true;
      scene.add(sun);

      const hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiInt);
      hemi.userData.mapGenerated = true;
      scene.add(hemi);

      const cx = this.lodibidonCenter?.x ?? (this.width * CS * 0.5);
      const cz = this.lodibidonCenter?.z ?? (this.height * CS * 0.5);
      const midLight = new THREE.PointLight(theme.midLightColor, theme.midLightInt, 48);
      midLight.position.set(cx, WH + 2, cz);
      midLight.userData.mapGenerated = true;
      scene.add(midLight);
      return;
    }

    const prof  = this.gameplay?.sceneProfile ?? {};
    const warm  = prof.midSpace === 'exterior';

    const amb = new THREE.AmbientLight(warm ? 0xc8c0b0 : 0xb8c8dc, warm ? 1.05 : 0.95);
    amb.userData.mapGenerated = true;
    scene.add(amb);

    const sunColor = warm ? 0xffe8c8 : 0xfff0dd;
    const sun = new THREE.DirectionalLight(sunColor, warm ? 1.4 : 1.25);
    sun.position.set(40, 60, 20);
    sun.userData.mapGenerated = true;
    scene.add(sun);

    const hemiTop = warm ? 0xc8b898 : 0x8caabb;
    const hemi = new THREE.HemisphereLight(hemiTop, 0x4a5538, warm ? 0.72 : 0.62);
    hemi.userData.mapGenerated = true;
    scene.add(hemi);

    const cx = this.lodibidonCenter?.x ?? (MAP_W * CS * 0.5);
    const cz = this.lodibidonCenter?.z ?? (MAP_H * CS * 0.5);
    const midLight = new THREE.PointLight(warm ? 0xffaa66 : 0xff9933, warm ? 2.8 : 2.4, 32);
    midLight.position.set(cx, WH - 0.55, cz);
    midLight.userData.mapGenerated = true;
    scene.add(midLight);

    if (warm) {
      const fill = new THREE.DirectionalLight(0x8899bb, 0.35);
      fill.position.set(-30, 40, -20);
      fill.userData.mapGenerated = true;
      scene.add(fill);
    }
  }

  isWall(worldX, worldZ) {
    if (this.collisionWorld?.active) {
      return this.collisionWorld.isBlocked(worldX, worldZ);
    }
    return this.mapGrid.isWall(worldX, worldZ);
  }

  isWallThin(worldX, worldZ) {
    if (this.collisionWorld?.active) {
      const r = 0.28;
      return [
        [worldX + r, worldZ],
        [worldX - r, worldZ],
        [worldX, worldZ + r],
        [worldX, worldZ - r],
      ].some(([x, z]) => this.collisionWorld.isBlocked(x, z, r));
    }
    const r = 0.28;
    return [
      [worldX + r, worldZ],
      [worldX - r, worldZ],
      [worldX, worldZ + r],
      [worldX, worldZ - r],
    ].some(([x, z]) => this.mapGrid.cellIsBlocked(x, z));
  }

  hasLOS(x1, z1, x2, z2) {
    if (this.collisionWorld?.active) {
      return this.collisionWorld.hasLOS(x1, z1, x2, z2);
    }
    return this.mapGrid.hasLOS(x1, z1, x2, z2);
  }

  _cellIsWall(worldX, worldZ) {
    return this.mapGrid.cellIsBlocked(worldX, worldZ);
  }
}
