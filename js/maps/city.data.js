// ═══════════════════════════════════════════════════════════
//  WARFRONT — City map definition (data only)
//  Add new maps by copying this pattern: *.data.js + *.grid.js
// ═══════════════════════════════════════════════════════════

import { MAP_W, MAP_H, CELL_SIZE } from '../config.js';

const CS = CELL_SIZE;
const wx = c => c * CS;
const wz = r => r * CS;

// Grid column / row boundaries
export const GX_L1 = 2;
export const GX_L2 = 13;
export const GX_M1 = 16;
export const GX_M2 = 28;
export const GX_R1 = 31;
export const GX_R2 = 42;

export const GZ_SA1 = 2;
export const GZ_SA2 = 9;
export const GZ_LE  = 35;
export const GZ_SB2 = 41;

export const W_LW_X   = (wx(GX_L2) + wx(GX_M1)) * 0.5;
export const W_LW_W   = wx(GX_M1) - wx(GX_L2);
export const W_RW_X   = (wx(GX_M2) + wx(GX_R1)) * 0.5;
export const W_RW_W   = wx(GX_R1) - wx(GX_M2);
export const W_LANE_Z = (wz(GZ_SA2) + wz(GZ_LE)) * 0.5;
export const W_LANE_D = wz(GZ_LE) - wz(GZ_SA2);
export const W_MID_X  = (wx(GX_M1) + wx(GX_M2)) * 0.5;
export const W_MID_W  = wx(GX_M2) - wx(GX_M1);
export const W_L_LX   = (wx(GX_L1) + wx(GX_L2)) * 0.5;
export const W_R_LX   = (wx(GX_R1) + wx(GX_R2)) * 0.5;

/** Walkable zones carved into the grid first. */
export const CITY_OPEN_RECTS = [
  { x: GX_L1, z: GZ_SA1, w: GX_R2 - GX_L1, h: GZ_SA2 - GZ_SA1, kind: 'floor' },
  { x: GX_L1, z: GZ_SA2, w: GX_L2 - GX_L1, h: GZ_LE - GZ_SA2, kind: 'floor' },
  { x: GX_M1, z: GZ_SA2, w: GX_M2 - GX_M1, h: GZ_LE - GZ_SA2, kind: 'floor' },
  { x: GX_R1, z: GZ_SA2, w: GX_R2 - GX_R1, h: GZ_LE - GZ_SA2, kind: 'floor' },
  { x: GX_L1, z: GZ_LE,  w: GX_R2 - GX_L1, h: GZ_SB2 - GZ_LE, kind: 'floor' },
];

/** Interior pillars — blocked, minimap "pillar". */
export const CITY_PILLARS = (() => {
  const cols = [GX_M1 + 1, GX_M2 - 2];
  const rows = [GZ_SA2 + 4, GZ_SA2 + 9, GZ_SA2 + 17, GZ_SA2 + 22];
  const out = [];
  for (const gx of cols) for (const gz of rows) out.push([gx, gz]);
  return out;
})();

/** Lane + spawn cover barriers — blocked, minimap "cover". */
export const CITY_COVERS = [
  [5, 13], [5, 22], [5, 30],
  [9, 17], [9, 26],
  [37, 13], [37, 22], [37, 30],
  [33, 17], [33, 26],
  [6, 5], [22, 5], [36, 5],
  [6, 38], [22, 38], [36, 38],
];

/** Dumpsters — visual + collision. */
export const CITY_DUMPSTERS = [
  [3, 15], [3, 28],
  [40, 15], [40, 28],
];

/** Thin lamp-post cells at lane edges (blocked). */
export const CITY_LAMPS = (() => {
  const out = [];
  const lampGX = [
    Math.floor((wx(GX_L1) + CS * 0.6) / CS),
    Math.floor((wx(GX_L2) - CS * 0.6) / CS),
    Math.floor((wx(GX_R1) + CS * 0.6) / CS),
    Math.floor((wx(GX_R2) - CS * 0.6) / CS),
  ];
  for (const t of [0.22, 0.5, 0.78]) {
    const gz = Math.floor((wz(GZ_SA2) + W_LANE_D * t) / CS);
    for (const gx of lampGX) out.push([gx, gz]);
  }
  return out;
})();

/** Door archways through interior side walls (force open after obstacles). */
export const CITY_DOOR_ROWS   = [GZ_SA2, GZ_SA2 + 1, GZ_LE - 1, GZ_LE];
export const CITY_DOOR_LEFT   = [GX_L2, GX_L2 + 1, GX_L2 + 2];
export const CITY_DOOR_RIGHT  = [GX_M2, GX_M2 + 1, GX_R1 - 1];

export const CITY_SPAWN_POINTS = [
  { x: wx(6),  z: wz(4)  },
  { x: wx(10), z: wz(4)  },
  { x: wx(22), z: wz(5)  },
  { x: wx(33), z: wz(4)  },
  { x: wx(37), z: wz(4)  },
  { x: wx(6),  z: wz(38) },
  { x: wx(10), z: wz(38) },
  { x: wx(22), z: wz(38) },
  { x: wx(33), z: wz(38) },
  { x: wx(37), z: wz(38) },
];

export const CITY_AMMO_CHESTS = [
  { x: W_L_LX, z: W_LANE_Z },
  { x: W_R_LX, z: W_LANE_Z },
];

export const CITY_LANES = [
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

/** Lodibidon — fixed 2 spawns per team, facing map centre. */
export const LODIBIDON_CENTER = { x: W_MID_X, z: W_LANE_Z };
export const LODIBIDON_ALPHA_SPAWNS = [
  { x: wx(10), z: wz(4) },
  { x: wx(22), z: wz(5) },
];
export const LODIBIDON_OMEGA_SPAWNS = [
  { x: wx(10), z: wz(38) },
  { x: wx(22), z: wz(38) },
];

export const CITY_MAP_META = {
  id:     'city',
  width:  MAP_W,
  height: MAP_H,
};
