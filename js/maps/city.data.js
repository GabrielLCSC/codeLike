// ═══════════════════════════════════════════════════════════
//  WARFRONT — City map (urban 3-lane — interior mid + alleys)
// ═══════════════════════════════════════════════════════════

import {
  makeTriLaneMap,
  sideLaneLamps,
  GX_M1, GX_M2, GZ_SA2,
} from './lane-layout.js';

const midPillars = (() => {
  const cols = [GX_M1 + 1, GX_M2 - 2];
  const rows = [GZ_SA2 + 4, GZ_SA2 + 9, GZ_SA2 + 17, GZ_SA2 + 22, GZ_SA2 + 27];
  const out = [];
  for (const gx of cols) for (const gz of rows) out.push([gx, gz]);
  return out;
})();

/** Side-lane alcoves + street cover. */
const covers = [
  [5, 13], [5, 22], [5, 30],
  [8, 17], [8, 26],
  [37, 13], [37, 22], [37, 30],
  [34, 17], [34, 26],
  [6, 5], [22, 5], [36, 5],
  [6, 38], [22, 38], [36, 38],
  // Mid-lane interior cubicles
  [20, 14], [24, 14], [20, 30], [24, 30],
];

export const CITY_GAMEPLAY = makeTriLaneMap({
  meta: {
    id:          'city',
    name:        'Urban Streets',
    description: 'Classic 3-lane block — covered mid atrium and alley flanks.',
  },
  pillars: midPillars,
  covers,
  dumpsters: [[3, 15], [3, 28], [40, 15], [40, 28]],
  lamps: sideLaneLamps(),
  theme: { sky: 0x7a9fc2, fog: 0x7a9fc2, fogDensity: 0.018 },
  sceneProfile: {
    midSpace:    'interior',
    sideSpace:   'interior',
    sideRoof:    true,
    laneStripes: true,
    palette: {
      asphalt:  0x1e1e22,
      building: 0x4e4e56,
      intFloor: 0x38363c,
      roof:     0x2a2a30,
      cover:    0x58504a,
    },
  },
});

// Re-export grid constants for legacy imports
export {
  GX_L1, GX_L2, GX_M1, GX_M2, GX_R1, GX_R2,
  GZ_SA1, GZ_SA2, GZ_LE, GZ_SB2,
  W_LW_X, W_LW_W, W_RW_X, W_RW_W,
  W_LANE_Z, W_LANE_D, W_MID_X, W_MID_W, W_L_LX, W_R_LX,
} from './lane-layout.js';

export const CITY_OPEN_RECTS   = CITY_GAMEPLAY.openRects;
export const CITY_PILLARS      = CITY_GAMEPLAY.pillars;
export const CITY_COVERS       = CITY_GAMEPLAY.covers;
export const CITY_DUMPSTERS    = CITY_GAMEPLAY.dumpsters;
export const CITY_LAMPS        = CITY_GAMEPLAY.lamps;
export const CITY_DOOR_ROWS    = CITY_GAMEPLAY.doors.rows;
export const CITY_DOOR_LEFT    = CITY_GAMEPLAY.doors.left;
export const CITY_DOOR_RIGHT   = CITY_GAMEPLAY.doors.right;
export const CITY_SPAWN_POINTS = CITY_GAMEPLAY.spawnPoints;
export const CITY_AMMO_CHESTS  = CITY_GAMEPLAY.ammoChests;
export const CITY_LANES        = CITY_GAMEPLAY.lanes;
export const LODIBIDON_CENTER  = CITY_GAMEPLAY.lodibidonCenter;
export const LODIBIDON_ALPHA_SPAWNS = CITY_GAMEPLAY.lodibidonSpawns.alpha;
export const LODIBIDON_OMEGA_SPAWNS = CITY_GAMEPLAY.lodibidonSpawns.omega;
export const CITY_MAP_META = { id: 'city', width: 44, height: 44 };
