// ═══════════════════════════════════════════════════════════
//  WARFRONT — City map  (triple-lane, CoD-style)
//
//  Rendering strategy:
//    All boxes sharing the same material are merged into a single
//    BufferGeometry with mergeGeometries(), giving one draw call
//    per material (~8 total) instead of one per cell (~1 900).
//    Three.js frustum-culls each merged mesh against its bounding
//    sphere, which is tighter than culling individual cell boxes.
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MAP_W, MAP_H, CELL_SIZE, WALL_HEIGHT, PLAYER_RADIUS } from './config.js';

const CS = CELL_SIZE;   // 2.2 world units per grid cell
const WH = WALL_HEIGHT; // 3.2 world units

// ── Grid cell boundaries ─────────────────────────────────────
// X axis (columns)
const GX_L1 = 2;   // left lane  — left edge
const GX_L2 = 13;  // left lane  — right edge  (building left wall starts)
const GX_M1 = 16;  // building interior — left
const GX_M2 = 28;  // building interior — right (building right wall starts)
const GX_R1 = 31;  // right lane — left edge
const GX_R2 = 42;  // right lane — right edge

// Z axis (rows)
const GZ_SA1 = 2;   // spawn A — start
const GZ_SA2 = 9;   // spawn A — end / lanes start
const GZ_LE  = 35;  // lanes end / spawn B start
const GZ_SB2 = 41;  // spawn B — end

// Helpers: grid cell → world-space center of that column / row
const wx = (c) => c * CS;
const wz = (r) => r * CS;

// Pre-computed world-space values
const W_LW_X   = (wx(GX_L2) + wx(GX_M1)) * 0.5;  // left building wall centre X
const W_LW_W   = wx(GX_M1)  - wx(GX_L2);           // left building wall width
const W_RW_X   = (wx(GX_M2) + wx(GX_R1)) * 0.5;  // right building wall centre X
const W_RW_W   = wx(GX_R1)  - wx(GX_M2);           // right building wall width
const W_LANE_Z = (wz(GZ_SA2) + wz(GZ_LE))  * 0.5; // lane centre Z
const W_LANE_D = wz(GZ_LE)   - wz(GZ_SA2);         // lane depth
const W_MID_X  = (wx(GX_M1) + wx(GX_M2)) * 0.5;  // building interior centre X
const W_MID_W  = wx(GX_M2)  - wx(GX_M1);           // building interior width
const W_L_LX   = (wx(GX_L1) + wx(GX_L2)) * 0.5;  // left lane centre X
const W_R_LX   = (wx(GX_R1) + wx(GX_R2)) * 0.5;  // right lane centre X

export class MapGenerator {
  constructor() {
    this.width  = MAP_W;   // 44
    this.height = MAP_H;   // 44
    /** @type {Uint8Array[]} grid[x][z] — 0=solid 1=open */
    this.grid   = [];
    this.rooms  = [];
    this.spawnPoints  = [];
    this.ammoChests   = [];
    /** @type {{ id:string, centerX:number, zMin:number, zMax:number, halfWidth:number }[]} */
    this.lanes        = [];
    this.wallMeshes   = [];
    this.staticMeshes = [];

    // Used by buildScene() — filled by _buildFixedMap()
    this._pillarCells = [];
    this._coverCells  = [];
    this._dumpCells   = [];
  }

  generate() {
    this.grid = Array.from({ length: this.width }, () => new Uint8Array(this.height));
    this.rooms        = [];
    this.spawnPoints  = [];
    this.ammoChests   = [];
    /** @type {{ id:string, centerX:number, zMin:number, zMax:number, halfWidth:number }[]} */
    this.lanes        = [];
    this.wallMeshes   = [];
    this.staticMeshes = [];
    this._pillarCells = [];
    this._coverCells  = [];
    this._dumpCells   = [];
    this._buildFixedMap();
    this._initLanes();
    return this;
  }

  /** Walkable lane centres for bot pathing (left / interior / right). */
  _initLanes() {
    this.lanes = [
      {
        id: 'left',
        centerX: W_L_LX,
        zMin: wz(GZ_SA2),
        zMax: wz(GZ_LE),
        halfWidth: (wx(GX_L2) - wx(GX_L1)) * 0.22,
      },
      {
        id: 'mid',
        centerX: W_MID_X,
        zMin: wz(GZ_SA2),
        zMax: wz(GZ_LE),
        halfWidth: (wx(GX_M2) - wx(GX_M1)) * 0.22,
      },
      {
        id: 'right',
        centerX: W_R_LX,
        zMin: wz(GZ_SA2),
        zMax: wz(GZ_LE),
        halfWidth: (wx(GX_R2) - wx(GX_R1)) * 0.22,
      },
    ];
  }

  // ═══════════════════════════════════════════════════════
  //  SCENE
  // ═══════════════════════════════════════════════════════
  buildScene(scene) {
    // Sky + mild distance haze
    scene.background = new THREE.Color(0x7a9fc2);
    scene.fog        = new THREE.FogExp2(0x7a9fc2, 0.018);

    // ── Materials ───────────────────────────────────────
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

    // Accumulate an axis-aligned box: cx/cz = world centre, y = bottom of box
    const box = (key, w, h, d, cx, y, cz) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(cx, y + h * 0.5, cz));
      batches[key].push(g);
    };

    const mapW  = MAP_W * CS;   // 96.8
    const mapD  = MAP_H * CS;   // 96.8
    const mapCX = mapW * 0.5;
    const mapCZ = mapD * 0.5;

    // ── GROUND ─────────────────────────────────────────
    box('asphalt', mapW, 0.15, mapD, mapCX, 0, mapCZ);

    // Interior concrete floor (slightly raised so it reads differently)
    box('intFloor', W_MID_W, 0.08, W_LANE_D, W_MID_X, 0.15, W_LANE_Z);

    // ── OUTER BOUNDARY WALLS (tall — city block silhouette) ─
    const BT = CS * 2;       // 2-cell thickness
    const BH = WH + 4.5;     // extra tall
    box('concrete', BT,   BH, mapD, BT * 0.5,        0, mapCZ);          // left
    box('concrete', BT,   BH, mapD, mapW - BT * 0.5, 0, mapCZ);          // right
    box('concrete', mapW, BH, BT,   mapCX, 0, BT * 0.5);                  // back
    box('concrete', mapW, BH, BT,   mapCX, 0, mapD - BT * 0.5);           // front

    // ── BUILDING SIDE WALLS (separate left/right lane from interior) ─
    box('building', W_LW_W, WH, W_LANE_D, W_LW_X, 0, W_LANE_Z);
    box('building', W_RW_W, WH, W_LANE_D, W_RW_X, 0, W_LANE_Z);

    // ── BUILDING ROOF + PARAPET ─────────────────────────
    const roofX = (wx(GX_L2) + wx(GX_R1)) * 0.5;
    const roofW = wx(GX_R1) - wx(GX_L2);
    box('roof', roofW, 0.35, W_LANE_D, roofX, WH, W_LANE_Z);

    // Parapet
    const PT = 0.25;
    const PH = 0.55;
    box('building', roofW,   PH, PT, roofX, WH + 0.35, wz(GZ_SA2) - PT * 0.5);
    box('building', roofW,   PH, PT, roofX, WH + 0.35, wz(GZ_LE)  + PT * 0.5);
    box('building', PT, PH, W_LANE_D, wx(GX_L2) + PT * 0.5, WH + 0.35, W_LANE_Z);
    box('building', PT, PH, W_LANE_D, wx(GX_R1) - PT * 0.5, WH + 0.35, W_LANE_Z);

    // ── INTERIOR CEILING ────────────────────────────────
    box('roof', W_MID_W - 0.05, 0.12, W_LANE_D - 0.05, W_MID_X, WH - 0.12, W_LANE_Z);

    // ── BUILDING ENTRANCE HEADER BEAMS ──────────────────
    // Gives the opening a doorway/archway feel without blocking movement
    const headerH = WH * 0.28;
    const headerT = CS * 0.5;
    box('building', W_MID_W, headerH, headerT, W_MID_X, WH - headerH, wz(GZ_SA2) - headerT * 0.5);
    box('building', W_MID_W, headerH, headerT, W_MID_X, WH - headerH, wz(GZ_LE)  + headerT * 0.5);

    // ── INTERIOR PILLARS ───────────────────────────────
    for (const [gc, gr] of this._pillarCells) {
      box('building', CS * 0.7, WH, CS * 0.7, (gc + 0.5) * CS, 0, (gr + 0.5) * CS);
    }

    // ── LANE COVER (concrete barriers) ──────────────────
    for (const [gc, gr] of this._coverCells) {
      box('cover', CS * 1.1, 1.0, CS * 0.4, (gc + 0.5) * CS, 0, (gr + 0.5) * CS);
    }

    // ── DUMPSTERS ───────────────────────────────────────
    for (const [gc, gr] of this._dumpCells) {
      box('rust', CS * 0.9, 1.25, CS * 0.55, (gc + 0.5) * CS, 0, (gr + 0.5) * CS);
    }

    // ── ROAD MARKINGS (thin decorative strips) ──────────
    const markW = 0.18;
    const markH = 0.02;
    const seg   = W_LANE_D * 0.45;
    box('stripe', markW, markH, seg, W_L_LX, 0.16, wz(GZ_SA2) + W_LANE_D * 0.27);
    box('stripe', markW, markH, seg, W_L_LX, 0.16, wz(GZ_SA2) + W_LANE_D * 0.73);
    box('stripe', markW, markH, seg, W_R_LX, 0.16, wz(GZ_SA2) + W_LANE_D * 0.27);
    box('stripe', markW, markH, seg, W_R_LX, 0.16, wz(GZ_SA2) + W_LANE_D * 0.73);

    // ── LAMP POSTS (thin vertical metal pillars) ─────────
    const lpH = WH + 0.8;
    const lpS = 0.10;
    for (const t of [0.22, 0.5, 0.78]) {
      const lz = wz(GZ_SA2) + W_LANE_D * t;
      box('concrete', lpS, lpH, lpS, wx(GX_L1) + CS * 0.6, 0, lz);
      box('concrete', lpS, lpH, lpS, wx(GX_L2) - CS * 0.6, 0, lz);
      box('concrete', lpS, lpH, lpS, wx(GX_R1) + CS * 0.6, 0, lz);
      box('concrete', lpS, lpH, lpS, wx(GX_R2) - CS * 0.6, 0, lz);
    }

    // ── FLUSH: MERGE & ADD TO SCENE ────────────────────
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
      if (key === 'building' || key === 'concrete') this.wallMeshes.push(mesh);
    }

    this._buildAmmoChests(scene);
    this._buildLighting(scene);
  }

  /** Ammo crates in mid-lanes (away from spawn zones so bots don't pile up). */
  _buildAmmoChests(scene) {
    const laneMidZ = W_LANE_Z;

    this.ammoChests = [
      { x: W_L_LX, z: laneMidZ },
      { x: W_R_LX, z: laneMidZ },
    ];

    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3d4a32 });
    const lidMat  = new THREE.MeshLambertMaterial({ color: 0x4a5a3a });
    const bandMat = new THREE.MeshLambertMaterial({ color: 0xc4a035 });
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

      const glow = new THREE.PointLight(0xffcc66, 1.2, 6);
      glow.position.set(0, 1.0, 0);
      g.add(glow);

      scene.add(g);
    }
  }

  // ═══════════════════════════════════════════════════════
  //  LIGHTING
  // ═══════════════════════════════════════════════════════
  _buildLighting(scene) {
    // Sky ambient
    scene.add(new THREE.AmbientLight(0xb0c4d8, 0.8));

    // Warm sun from upper-right, angled so it casts shadows into the lanes
    const sun = new THREE.DirectionalLight(0xfff0dd, 1.1);
    sun.position.set(40, 60, 20);
    sun.castShadow = false; // shadow map disabled for performance
    scene.add(sun);

    // Hemisphere sky / ground bounce
    scene.add(new THREE.HemisphereLight(0x88aabb, 0x445533, 0.5));

    // ── Building interior — warm sodium ─────────────────
    for (const t of [0.22, 0.5, 0.78]) {
      const l = new THREE.PointLight(0xff9933, 3.2, 24);
      l.position.set(W_MID_X, WH - 0.55, wz(GZ_SA2) + W_LANE_D * t);
      scene.add(l);
    }

    // ── Lane street lamps — cool white ──────────────────
    for (const t of [0.2, 0.5, 0.8]) {
      const lz = wz(GZ_SA2) + W_LANE_D * t;
      const ll = new THREE.PointLight(0xddeeff, 2.0, 20);
      ll.position.set(W_L_LX, WH - 0.2, lz);
      scene.add(ll);
      const rl = new THREE.PointLight(0xddeeff, 2.0, 20);
      rl.position.set(W_R_LX, WH - 0.2, lz);
      scene.add(rl);
    }

    // ── Spawn area fill lights ───────────────────────────
    const mapCX = (MAP_W * CS) * 0.5;
    const saZ   = (wz(GZ_SA1) + wz(GZ_SA2)) * 0.5;
    const sbZ   = (wz(GZ_LE)  + wz(GZ_SB2)) * 0.5;
    const addSpawn = (z) => {
      const l = new THREE.PointLight(0xccddff, 2.8, 55);
      l.position.set(mapCX, WH - 0.5, z);
      scene.add(l);
    };
    addSpawn(saZ);
    addSpawn(sbZ);
  }

  // ═══════════════════════════════════════════════════════
  //  COLLISION  (grid-based, unchanged API)
  // ═══════════════════════════════════════════════════════
  isWall(worldX, worldZ) {
    const r = PLAYER_RADIUS;
    return [
      [worldX,     worldZ    ],
      [worldX + r, worldZ    ],
      [worldX - r, worldZ    ],
      [worldX,     worldZ + r],
      [worldX,     worldZ - r],
    ].some(([x, z]) => this._cellIsWall(x, z));
  }

  isWallThin(worldX, worldZ) {
    const r = 0.28;
    return [
      [worldX + r, worldZ    ],
      [worldX - r, worldZ    ],
      [worldX,     worldZ + r],
      [worldX,     worldZ - r],
    ].some(([x, z]) => this._cellIsWall(x, z));
  }

  hasLOS(x1, z1, x2, z2) {
    const STEPS = 24;
    for (let i = 1; i < STEPS; i++) {
      const t = i / STEPS;
      if (this._cellIsWall(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t)) return false;
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════
  //  GRID BUILD
  // ═══════════════════════════════════════════════════════
  _buildFixedMap() {
    const span = (x, z, w, h) => this._carveRect({ x, z, w, h });

    // ── Open areas ──────────────────────────────────────
    span(GX_L1, GZ_SA1, GX_R2 - GX_L1, GZ_SA2 - GZ_SA1);  // spawn A (full width)
    span(GX_L1, GZ_SA2, GX_L2 - GX_L1, GZ_LE  - GZ_SA2);  // left lane
    span(GX_M1, GZ_SA2, GX_M2 - GX_M1, GZ_LE  - GZ_SA2);  // building interior
    span(GX_R1, GZ_SA2, GX_R2 - GX_R1, GZ_LE  - GZ_SA2);  // right lane
    span(GX_L1, GZ_LE,  GX_R2 - GX_L1, GZ_SB2 - GZ_LE);   // spawn B (full width)

    // ── Interior pillars (re-solidify 1 cell each) ──────
    // Two columns: just inside each building wall; four rows along depth
    const pillarGX = [GX_M1 + 1, GX_M2 - 2];
    const pillarGZ = [
      GZ_SA2 + 4,
      GZ_SA2 + 9,
      GZ_SA2 + 17,
      GZ_SA2 + 22,
    ];
    for (const col of pillarGX) {
      for (const row of pillarGZ) {
        if (col >= 0 && col < this.width && row >= 0 && row < this.height) {
          this.grid[col][row] = 0;
          this._pillarCells.push([col, row]);
        }
      }
    }

    // ── Lane cover barriers (re-solidify 1 cell each) ───
    const coverDefs = [
      // Left lane
      [5, 13], [5, 22], [5, 30],
      [9, 17], [9, 26],
      // Right lane (mirror)
      [37, 13], [37, 22], [37, 30],
      [33, 17], [33, 26],
      // Spawn A covers
      [6, 5], [22, 5], [36, 5],
      // Spawn B covers
      [6, 38], [22, 38], [36, 38],
    ];
    for (const [col, row] of coverDefs) {
      if (col >= 0 && col < this.width && row >= 0 && row < this.height
          && this.grid[col][row] === 1) {
        this.grid[col][row] = 0;
        this._coverCells.push([col, row]);
      }
    }

    // ── Dumpsters (visual only — no grid collision) ──────
    this._dumpCells = [
      [3, 15], [3, 28],
      [40, 15], [40, 28],
    ];

    // ── Spawn points ────────────────────────────────────
    this.spawnPoints = [
      // Spawn A — left, mid, right
      { x: wx(6),  z: wz(4)  },
      { x: wx(10), z: wz(4)  },
      { x: wx(22), z: wz(5)  },
      { x: wx(33), z: wz(4)  },
      { x: wx(37), z: wz(4)  },
      // Spawn B — mirrored
      { x: wx(6),  z: wz(38) },
      { x: wx(10), z: wz(38) },
      { x: wx(22), z: wz(38) },
      { x: wx(33), z: wz(38) },
      { x: wx(37), z: wz(38) },
    ];

    this.rooms = [];
  }

  _carveRect({ x, z, w, h }) {
    for (let cx = x; cx < x + w; cx++)
      for (let cz = z; cz < z + h; cz++)
        if (cx >= 0 && cx < this.width && cz >= 0 && cz < this.height)
          this.grid[cx][cz] = 1;
  }

  _cellIsWall(worldX, worldZ) {
    const cx = Math.floor(worldX / CS);
    const cz = Math.floor(worldZ / CS);
    if (cx < 0 || cx >= this.width || cz < 0 || cz >= this.height) return true;
    return this.grid[cx][cz] === 0;
  }
}
