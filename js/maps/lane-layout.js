// ═══════════════════════════════════════════════════════════
//  WARFRONT — Shared 3-lane map skeleton (grid + spawns)
//  All maps use this lane topology; each map adds its own cover.
// ═══════════════════════════════════════════════════════════

import { MAP_W, MAP_H, CELL_SIZE } from '../config.js';

export const CS = CELL_SIZE;
export const wx = c => c * CS;
export const wz = r => r * CS;

// ─── Grid lane boundaries ───────────────────────────────────
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

// ─── World anchors ───────────────────────────────────────────
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

/** Standard walkable 3-lane footprint. */
export function standardOpenRects() {
  return [
    { x: GX_L1, z: GZ_SA1, w: GX_R2 - GX_L1, h: GZ_SA2 - GZ_SA1, kind: 'floor' },
    { x: GX_L1, z: GZ_SA2, w: GX_L2 - GX_L1, h: GZ_LE - GZ_SA2, kind: 'floor' },
    { x: GX_M1, z: GZ_SA2, w: GX_M2 - GX_M1, h: GZ_LE - GZ_SA2, kind: 'floor' },
    { x: GX_R1, z: GZ_SA2, w: GX_R2 - GX_R1, h: GZ_LE - GZ_SA2, kind: 'floor' },
    { x: GX_L1, z: GZ_LE,  w: GX_R2 - GX_L1, h: GZ_SB2 - GZ_LE, kind: 'floor' },
  ];
}

/** Doorways linking side lanes ↔ mid lane. */
export function standardDoors() {
  return {
    rows:  [GZ_SA2, GZ_SA2 + 1, GZ_LE - 1, GZ_LE],
    left:  [GX_L2, GX_L2 + 1, GX_L2 + 2],
    right: [GX_M2, GX_M2 + 1, GX_R1 - 1],
  };
}

export function standardSpawnPoints() {
  return [
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
}

export function standardAmmoChests() {
  return [
    { x: W_L_LX, z: W_LANE_Z },
    { x: W_R_LX, z: W_LANE_Z },
  ];
}

export function standardLanes() {
  return [
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

export function standardLodibidon() {
  return {
    center: { x: W_MID_X, z: W_LANE_Z },
    spawns: {
      alpha: [
        { x: wx(10), z: wz(4) },
        { x: wx(22), z: wz(5) },
      ],
      omega: [
        { x: wx(10), z: wz(38) },
        { x: wx(22), z: wz(38) },
      ],
    },
  };
}

/** Side-lane interior lamp posts (avoid door rows). */
export function sideLaneLamps() {
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
}

/**
 * Build a complete gameplay bundle on the standard 3-lane skeleton.
 * @param {object} overrides — pillars, covers, sceneProfile, meta, theme, …
 */
export function makeTriLaneMap(overrides = {}) {
  const lod = standardLodibidon();
  return {
    openRects:   standardOpenRects(),
    doors:       standardDoors(),
    spawnPoints: standardSpawnPoints(),
    ammoChests:  standardAmmoChests(),
    lanes:       standardLanes(),
    lodibidonCenter: lod.center,
    lodibidonSpawns: lod.spawns,
    pillars:     [],
    covers:      [],
    dumpsters:   [],
    lamps:       [],
    theme:       { sky: 0x7a9fc2, fog: 0x7a9fc2, fogDensity: 0.018 },
    sceneProfile: { midSpace: 'interior', sideSpace: 'interior' },
    meta: {
      width:  MAP_W,
      height: MAP_H,
      scene:  'tri-lane',
    },
    ...overrides,
    meta: {
      width:  MAP_W,
      height: MAP_H,
      scene:  'tri-lane',
      ...overrides.meta,
    },
  };
}

/** Cells that must stay walkable (door archways). */
export function isDoorCell(gx, gz) {
  const d = standardDoors();
  if (!d.rows.includes(gz)) return false;
  return d.left.includes(gx) || d.right.includes(gx);
}

/** @param {number} gx @param {number} gz @returns {boolean} inside left/right lane run */
export function isSideLane(gx, gz) {
  if (gz < GZ_SA2 || gz >= GZ_LE) return false;
  return (gx >= GX_L1 && gx < GX_L2) || (gx >= GX_R1 && gx <= GX_R2);
}

/** @param {number} gx @param {number} gz */
export function isMidLane(gx, gz) {
  if (gz < GZ_SA2 || gz >= GZ_LE) return false;
  return gx >= GX_M1 && gx <= GX_M2;
}
