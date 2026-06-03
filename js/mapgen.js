// ═══════════════════════════════════════════════════════════
//  WARFRONT — Procedural dungeon map generator
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { MAP_W, MAP_H, CELL_SIZE, WALL_HEIGHT, PLAYER_RADIUS } from './config.js';

export class MapGenerator {
  constructor() {
    this.width  = MAP_W;
    this.height = MAP_H;
    /** @type {Uint8Array[]} grid[x][z] — 0=wall, 1=floor */
    this.grid   = [];
    this.rooms  = [];     // { x,z,w,h }
    this.spawnPoints = []; // { x,z } world-space centres
    this.wallMeshes  = []; // THREE.Mesh[] — used for LOS raycasting
  }

  // ─── PUBLIC ──────────────────────────────────────────────
  generate() {
    this.grid = Array.from({ length: this.width }, () => new Uint8Array(this.height));
    this.rooms = [];
    this.spawnPoints = [];
    this.wallMeshes  = [];

    this._placeRooms(10);
    this._connectRooms();
    this._findSpawnPoints();
    return this;
  }

  /** Build Three.js scene geometry from the grid */
  buildScene(scene) {
    const wallMat  = new THREE.MeshLambertMaterial({ color: 0x6a6a7a });
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x3a3a45 });
    const ceilMat  = new THREE.MeshLambertMaterial({ color: 0x2a2a35 });

    const wallGeoTemplate  = new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE);
    const slabGeoTemplate  = new THREE.BoxGeometry(CELL_SIZE, 0.12, CELL_SIZE);

    for (let x = 0; x < this.width; x++) {
      for (let z = 0; z < this.height; z++) {
        const wx = x * CELL_SIZE + CELL_SIZE * 0.5;
        const wz = z * CELL_SIZE + CELL_SIZE * 0.5;

        if (this.grid[x][z] === 0) {
          // ── WALL ──
          const wall = new THREE.Mesh(wallGeoTemplate, wallMat);
          wall.position.set(wx, WALL_HEIGHT * 0.5, wz);
          wall.castShadow = true;
          wall.receiveShadow = true;
          scene.add(wall);
          this.wallMeshes.push(wall);
        } else {
          // ── FLOOR ──
          const floor = new THREE.Mesh(slabGeoTemplate, floorMat);
          floor.position.set(wx, 0, wz);
          floor.receiveShadow = true;
          scene.add(floor);

          // ── CEILING ──
          const ceil = new THREE.Mesh(slabGeoTemplate, ceilMat);
          ceil.position.set(wx, WALL_HEIGHT, wz);
          scene.add(ceil);
        }
      }
    }

    // ── LIGHTING ──

    // Strong ambient so nothing is ever pitch black
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambient);

    // Hemisphere: warm sky from above, cool bounce from below
    const hemi = new THREE.HemisphereLight(0x8899bb, 0x334422, 0.6);
    scene.add(hemi);

    // Bright point light per room
    this.rooms.forEach((r, i) => {
      const hues  = [210, 180, 50, 0, 280, 160, 30, 240, 90, 320];
      const hue   = hues[i % hues.length];
      const clr   = new THREE.Color(`hsl(${hue},40%,55%)`);
      const light = new THREE.PointLight(clr, 3.5, CELL_SIZE * 10);
      light.position.set(
        (r.x + r.w * 0.5) * CELL_SIZE,
        WALL_HEIGHT - 0.4,
        (r.z + r.h * 0.5) * CELL_SIZE
      );
      light.castShadow = false;
      scene.add(light);

      // Small fill light near floor level
      const fill = new THREE.PointLight(0xffffff, 0.8, CELL_SIZE * 5);
      fill.position.set(
        (r.x + r.w * 0.5) * CELL_SIZE,
        0.5,
        (r.z + r.h * 0.5) * CELL_SIZE
      );
      scene.add(fill);
    });
  }

  /**
   * True if the world-space point (x, z) ± PLAYER_RADIUS is inside a wall.
   * Used for player & bot collision.
   */
  isWall(worldX, worldZ) {
    const r = PLAYER_RADIUS;
    const pts = [
      [worldX,     worldZ    ],
      [worldX + r, worldZ    ],
      [worldX - r, worldZ    ],
      [worldX,     worldZ + r],
      [worldX,     worldZ - r],
    ];
    return pts.some(([x, z]) => this._cellIsWall(x, z));
  }

  /** Narrower check used for bot movement (smaller radius). */
  isWallThin(worldX, worldZ) {
    const r = 0.28;
    const pts = [
      [worldX + r, worldZ],
      [worldX - r, worldZ],
      [worldX,     worldZ + r],
      [worldX,     worldZ - r],
    ];
    return pts.some(([x, z]) => this._cellIsWall(x, z));
  }

  /**
   * Grid-based line-of-sight ray march between two world-space points.
   * Fast — no Three.js raycaster needed.
   */
  hasLOS(x1, z1, x2, z2) {
    const STEPS = 24;
    for (let i = 1; i < STEPS; i++) {
      const t = i / STEPS;
      if (this._cellIsWall(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t)) return false;
    }
    return true;
  }

  // ─── PRIVATE GENERATION ──────────────────────────────────
  _placeRooms(target) {
    for (let attempt = 0; attempt < target * 20 && this.rooms.length < target; attempt++) {
      const w = 4 + Math.floor(Math.random() * 6);
      const h = 4 + Math.floor(Math.random() * 6);
      const x = 2 + Math.floor(Math.random() * (this.width  - w - 3));
      const z = 2 + Math.floor(Math.random() * (this.height - h - 3));
      const room = { x, z, w, h };

      if (!this._overlaps(room)) {
        this._carveRoom(room);
        this.rooms.push(room);
      }
    }
  }

  _overlaps(room) {
    return this.rooms.some(r =>
      room.x < r.x + r.w + 2 && room.x + room.w + 2 > r.x &&
      room.z < r.z + r.h + 2 && room.z + room.h + 2 > r.z
    );
  }

  _carveRoom({ x, z, w, h }) {
    for (let cx = x; cx < x + w; cx++)
      for (let cz = z; cz < z + h; cz++)
        this.grid[cx][cz] = 1;
  }

  _connectRooms() {
    for (let i = 1; i < this.rooms.length; i++) {
      const a = this.rooms[i - 1];
      const b = this.rooms[i];
      const ax = Math.floor(a.x + a.w * 0.5);
      const az = Math.floor(a.z + a.h * 0.5);
      const bx = Math.floor(b.x + b.w * 0.5);
      const bz = Math.floor(b.z + b.h * 0.5);

      if (Math.random() < 0.5) {
        this._carveH(ax, bx, az);
        this._carveV(az, bz, bx);
      } else {
        this._carveV(az, bz, ax);
        this._carveH(ax, bx, bz);
      }
    }
  }

  _carveH(x1, x2, z) {
    const mn = Math.min(x1, x2); const mx = Math.max(x1, x2);
    for (let x = mn; x <= mx; x++) {
      if (x < 0 || x >= this.width) continue;
      if (z     >= 0 && z     < this.height) this.grid[x][z]     = 1;
      if (z + 1 >= 0 && z + 1 < this.height) this.grid[x][z + 1] = 1;
    }
  }

  _carveV(z1, z2, x) {
    const mn = Math.min(z1, z2); const mx = Math.max(z1, z2);
    for (let z = mn; z <= mx; z++) {
      if (z < 0 || z >= this.height) continue;
      if (x     >= 0 && x     < this.width) this.grid[x][z]     = 1;
      if (x + 1 >= 0 && x + 1 < this.width) this.grid[x + 1][z] = 1;
    }
  }

  _findSpawnPoints() {
    this.spawnPoints = this.rooms.map(r => ({
      x: (r.x + r.w * 0.5) * CELL_SIZE,
      z: (r.z + r.h * 0.5) * CELL_SIZE,
    }));
  }

  _cellIsWall(worldX, worldZ) {
    const cx = Math.floor(worldX / CELL_SIZE);
    const cz = Math.floor(worldZ / CELL_SIZE);
    if (cx < 0 || cx >= this.width || cz < 0 || cz >= this.height) return true;
    return this.grid[cx][cz] === 0;
  }
}
