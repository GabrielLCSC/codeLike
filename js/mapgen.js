// ═══════════════════════════════════════════════════════════
//  WARFRONT — City map  (triple-lane, CoD-style)
//
//  Collision + minimap: maps/map-core.js + maps/city.grid.js
//  Visual meshes: built here from the same city.data.js constants
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP_W, MAP_H, CELL_SIZE, WALL_HEIGHT } from './config.js';
import { createMapGrid } from './maps/index.js';
import {
  GX_L1, GX_L2, GX_M1, GX_M2, GX_R1, GX_R2,
  GZ_SA1, GZ_SA2, GZ_LE, GZ_SB2,
  W_LW_X, W_LW_W, W_RW_X, W_RW_W,
  W_LANE_Z, W_LANE_D, W_MID_X, W_MID_W, W_L_LX, W_R_LX,
  CITY_PILLARS, CITY_COVERS, CITY_DUMPSTERS, CITY_LAMPS,
  CITY_SPAWN_POINTS, CITY_AMMO_CHESTS, CITY_LANES,
  LODIBIDON_CENTER, LODIBIDON_ALPHA_SPAWNS, LODIBIDON_OMEGA_SPAWNS,
} from './maps/city.data.js';

const CS = CELL_SIZE;
const WH = WALL_HEIGHT;
const wx = c => c * CS;
const wz = r => r * CS;

export class MapGenerator {
  constructor() {
    this.width  = MAP_W;
    this.height = MAP_H;
    /** @type {import('./maps/map-core.js').MapGrid|null} */
    this.mapGrid = null;
    /** @type {Uint8Array[]} grid[x][z] — alias of mapGrid.grid */
    this.grid   = [];
    this.rooms  = [];
    this.spawnPoints  = [];
    this.ammoChests   = [];
    this.lanes        = [];
    this.wallMeshes   = [];
    this.staticMeshes = [];
  }

  generate() {
    this.mapGrid = createMapGrid('city');
    this.grid     = this.mapGrid.grid;
    this.spawnPoints = [...CITY_SPAWN_POINTS];
    this.ammoChests  = [...CITY_AMMO_CHESTS];
    this.lanes       = [...CITY_LANES];
    this.lodibidonCenter = { ...LODIBIDON_CENTER };
    this.lodibidonSpawns = {
      alpha: LODIBIDON_ALPHA_SPAWNS.map(s => ({ ...s })),
      omega: LODIBIDON_OMEGA_SPAWNS.map(s => ({ ...s })),
    };
    this.rooms       = [];
    this.wallMeshes  = [];
    this.staticMeshes = [];
    return this;
  }

  /** Minimap texture from the same grid as collision. */
  getMinimapImageData() {
    return this.mapGrid.buildMinimapImageData();
  }

  // ═══════════════════════════════════════════════════════
  //  SCENE (visuals — decorative meshes have no extra collision)
  // ═══════════════════════════════════════════════════════
  buildScene(scene) {
    scene.background = new THREE.Color(0x7a9fc2);
    scene.fog        = new THREE.FogExp2(0x7a9fc2, 0.018);

    const M = {
      asphalt:  new THREE.MeshLambertMaterial({ color: 0x1e1e22 }),
      concrete: new THREE.MeshLambertMaterial({ color: 0x6a6a72 }),
      building: new THREE.MeshLambertMaterial({ color: 0x4e4e56 }),
      intFloor: new THREE.MeshLambertMaterial({ color: 0x38363c }),
      roof:     new THREE.MeshLambertMaterial({ color: 0x2a2a30 }),
      cover:    new THREE.MeshLambertMaterial({ color: 0x58504a }),
      rust:     new THREE.MeshLambertMaterial({ color: 0x3c1e10 }),
      stripe:   new THREE.MeshLambertMaterial({ color: 0x3a3830 }),
    };

    const batches = Object.fromEntries(Object.keys(M).map(k => [k, []]));
    const box = (key, w, h, d, cx, y, cz) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(cx, y + h * 0.5, cz));
      batches[key].push(g);
    };

    const mapW  = MAP_W * CS;
    const mapD  = MAP_H * CS;
    const mapCX = mapW * 0.5;
    const mapCZ = mapD * 0.5;

    box('asphalt', mapW, 0.15, mapD, mapCX, 0, mapCZ);
    box('intFloor', W_MID_W, 0.08, W_LANE_D, W_MID_X, 0.15, W_LANE_Z);

    const BT = CS * 2;
    const BH = WH + 4.5;
    box('concrete', BT,   BH, mapD, BT * 0.5,        0, mapCZ);
    box('concrete', BT,   BH, mapD, mapW - BT * 0.5, 0, mapCZ);
    box('concrete', mapW, BH, BT,   mapCX, 0, BT * 0.5);
    box('concrete', mapW, BH, BT,   mapCX, 0, mapD - BT * 0.5);

    box('building', W_LW_W, WH, W_LANE_D, W_LW_X, 0, W_LANE_Z);
    box('building', W_RW_W, WH, W_LANE_D, W_RW_X, 0, W_LANE_Z);

    const roofX = (wx(GX_L2) + wx(GX_R1)) * 0.5;
    const roofW = wx(GX_R1) - wx(GX_L2);
    box('roof', roofW, 0.35, W_LANE_D, roofX, WH, W_LANE_Z);

    const PT = 0.25;
    const PH = 0.55;
    box('building', roofW,   PH, PT, roofX, WH + 0.35, wz(GZ_SA2) - PT * 0.5);
    box('building', roofW,   PH, PT, roofX, WH + 0.35, wz(GZ_LE)  + PT * 0.5);
    box('building', PT, PH, W_LANE_D, wx(GX_L2) + PT * 0.5, WH + 0.35, W_LANE_Z);
    box('building', PT, PH, W_LANE_D, wx(GX_R1) - PT * 0.5, WH + 0.35, W_LANE_Z);

    box('roof', W_MID_W - 0.05, 0.12, W_LANE_D - 0.05, W_MID_X, WH - 0.12, W_LANE_Z);

    const headerH = WH * 0.28;
    const headerT = CS * 0.5;
    box('building', W_MID_W, headerH, headerT, W_MID_X, WH - headerH, wz(GZ_SA2) - headerT * 0.5);
    box('building', W_MID_W, headerH, headerT, W_MID_X, WH - headerH, wz(GZ_LE)  + headerT * 0.5);

    for (const [gc, gr] of CITY_PILLARS) {
      box('building', CS * 0.7, WH, CS * 0.7, (gc + 0.5) * CS, 0, (gr + 0.5) * CS);
    }

    for (const [gc, gr] of CITY_COVERS) {
      box('cover', CS * 1.1, 1.0, CS * 0.4, (gc + 0.5) * CS, 0, (gr + 0.5) * CS);
    }

    for (const [gc, gr] of CITY_DUMPSTERS) {
      box('rust', CS * 0.9, 1.25, CS * 0.55, (gc + 0.5) * CS, 0, (gr + 0.5) * CS);
    }

    const markW = 0.18;
    const markH = 0.02;
    const seg   = W_LANE_D * 0.45;
    box('stripe', markW, markH, seg, W_L_LX, 0.16, wz(GZ_SA2) + W_LANE_D * 0.27);
    box('stripe', markW, markH, seg, W_L_LX, 0.16, wz(GZ_SA2) + W_LANE_D * 0.73);
    box('stripe', markW, markH, seg, W_R_LX, 0.16, wz(GZ_SA2) + W_LANE_D * 0.27);
    box('stripe', markW, markH, seg, W_R_LX, 0.16, wz(GZ_SA2) + W_LANE_D * 0.73);

    const lpH = WH + 0.8;
    const lpS = 0.10;
    for (const [gc, gr] of CITY_LAMPS) {
      box('concrete', lpS, lpH, lpS, (gc + 0.5) * CS, 0, (gr + 0.5) * CS);
    }

    for (const [key, geos] of Object.entries(batches)) {
      if (geos.length === 0) continue;
      const merged = mergeGeometries(geos, false);
      geos.forEach(g => g.dispose());
      if (!merged) continue;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, M[key]);
      mesh.receiveShadow = (key !== 'stripe');
      mesh.castShadow    = (key === 'building' || key === 'concrete' || key === 'cover' || key === 'rust');
      scene.add(mesh);
      this.staticMeshes.push(mesh);
      if (key === 'building' || key === 'concrete' || key === 'cover' || key === 'rust') {
        this.wallMeshes.push(mesh);
      }
    }

    this._buildAmmoChests(scene);
    this._buildLighting(scene);
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
    // Static fill — no per-fragment point-light cost (was 11+ dynamic lights).
    scene.add(new THREE.AmbientLight(0xb8c8dc, 0.95));

    const sun = new THREE.DirectionalLight(0xfff0dd, 1.25);
    sun.position.set(40, 60, 20);
    sun.castShadow = false;
    scene.add(sun);

    scene.add(new THREE.HemisphereLight(0x8caabb, 0x4a5538, 0.62));

    const midZ = wz(GZ_SA2) + W_LANE_D * 0.5;
    const midLane = new THREE.PointLight(0xff9933, 2.4, 28);
    midLane.position.set(W_MID_X, WH - 0.55, midZ);
    scene.add(midLane);
  }

  // ═══════════════════════════════════════════════════════
  //  COLLISION — delegates to MapGrid (same data as minimap / bots)
  // ═══════════════════════════════════════════════════════
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
