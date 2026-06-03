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
    this.wallMeshes   = []; // wall boxes only — kept for any future LOS use
    this.staticMeshes = []; // ALL static geometry (walls + floors + ceilings) — for bullet impacts
  }

  // ─── PUBLIC ──────────────────────────────────────────────
  generate() {
    this.grid = Array.from({ length: this.width }, () => new Uint8Array(this.height));
    this.rooms        = [];
    this.spawnPoints  = [];
    this.wallMeshes   = [];
    this.staticMeshes = [];

    this._buildFixedMap();
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
          this.staticMeshes.push(wall);
        } else {
          // ── FLOOR ──
          const floor = new THREE.Mesh(slabGeoTemplate, floorMat);
          floor.position.set(wx, 0, wz);
          floor.receiveShadow = true;
          scene.add(floor);
          this.staticMeshes.push(floor);

          // ── CEILING ──
          const ceil = new THREE.Mesh(slabGeoTemplate, ceilMat);
          ceil.position.set(wx, WALL_HEIGHT, wz);
          scene.add(ceil);
          this.staticMeshes.push(ceil);
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

  // ─── FIXED MAP ───────────────────────────────────────────
  //
  //   NW ──── N ──── NE
  //   |       |       |
  //   W ───  MID  ─── E
  //   |       |       |
  //   SW ──── S ──── SE
  //
  _buildFixedMap() {
    // ── Rooms { x, z, w, h } ──
    const rooms = [
      { x: 18, z: 18, w: 8,  h: 8  }, // 0 — Central (mid)
      { x: 16, z:  2, w: 12, h: 8  }, // 1 — North
      { x: 16, z: 34, w: 12, h: 8  }, // 2 — South
      { x:  2, z: 16, w: 8,  h: 12 }, // 3 — West
      { x: 34, z: 16, w: 8,  h: 12 }, // 4 — East
      { x:  2, z:  2, w: 8,  h: 8  }, // 5 — NW
      { x: 34, z:  2, w: 8,  h: 8  }, // 6 — NE
      { x:  2, z: 34, w: 8,  h: 8  }, // 7 — SW
      { x: 34, z: 34, w: 8,  h: 8  }, // 8 — SE
    ];

    rooms.forEach(r => { this._carveRect(r); this.rooms.push(r); });

    // ── Corridors (3 cells wide for comfortable movement) ──
    // Central ↔ cardinal rooms
    this._carveRect({ x: 20, z: 10, w: 4, h: 8  }); // N  ↔ Mid
    this._carveRect({ x: 20, z: 26, w: 4, h: 8  }); // Mid ↔ S
    this._carveRect({ x: 10, z: 20, w: 8, h: 4  }); // W  ↔ Mid
    this._carveRect({ x: 26, z: 20, w: 8, h: 4  }); // Mid ↔ E

    // Corner rooms ↔ cardinal rooms
    this._carveRect({ x:  9, z:  4, w: 7,  h: 3 }); // NW ↔ N  (horizontal)
    this._carveRect({ x: 28, z:  4, w: 6,  h: 3 }); // N  ↔ NE
    this._carveRect({ x:  9, z: 37, w: 7,  h: 3 }); // SW ↔ S
    this._carveRect({ x: 28, z: 37, w: 6,  h: 3 }); // S  ↔ SE
    this._carveRect({ x:  4, z:  9, w: 3,  h: 7 }); // NW ↔ W  (vertical)
    this._carveRect({ x:  4, z: 28, w: 3,  h: 6 }); // W  ↔ SW
    this._carveRect({ x: 37, z:  9, w: 3,  h: 7 }); // NE ↔ E
    this._carveRect({ x: 37, z: 28, w: 3,  h: 6 }); // E  ↔ SE

    // ── Spawn points (one per room) ──
    this.spawnPoints = rooms.map(r => ({
      x: (r.x + r.w * 0.5) * CELL_SIZE,
      z: (r.z + r.h * 0.5) * CELL_SIZE,
    }));
  }

  _carveRect({ x, z, w, h }) {
    for (let cx = x; cx < x + w; cx++)
      for (let cz = z; cz < z + h; cz++)
        if (cx >= 0 && cx < this.width && cz >= 0 && cz < this.height)
          this.grid[cx][cz] = 1;
  }

  _cellIsWall(worldX, worldZ) {
    const cx = Math.floor(worldX / CELL_SIZE);
    const cz = Math.floor(worldZ / CELL_SIZE);
    if (cx < 0 || cx >= this.width || cz < 0 || cz >= this.height) return true;
    return this.grid[cx][cz] === 0;
  }
}
