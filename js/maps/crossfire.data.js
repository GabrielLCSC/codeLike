// ═══════════════════════════════════════════════════════════
//  CROSSFIRE — Overpass (tunnel side lanes + open elevated mid)
// ═══════════════════════════════════════════════════════════

import {
  makeTriLaneMap,
  GX_L1, GX_L2, GX_M1, GX_M2, GX_R1, GX_R2, GZ_SA2, GZ_LE,
  isDoorCell,
} from './lane-layout.js';

/** Tunnel support columns in side lanes. */
const pillars = (() => {
  const out = [];
  const rows = [GZ_SA2 + 5, GZ_SA2 + 12, GZ_SA2 + 19, GZ_SA2 + 26];
  for (const gz of rows) {
    for (const gx of [GX_L1 + 3, GX_L2 - 2, GX_R1 + 2, GX_R2 - 3]) {
      if (!isDoorCell(gx, gz)) out.push([gx, gz]);
    }
  }
  return out;
})();

/** Jersey barriers & mid-lane sightline cover on the overpass deck. */
const covers = [
  [17, 14], [27, 14], [17, 30], [27, 30],
  [19, 18], [25, 18], [19, 26], [25, 26],
  [22, 22],
  [6, 12], [6, 32], [37, 12], [37, 32],
  [10, 20], [33, 20],
];

export const CROSSFIRE_GAMEPLAY = makeTriLaneMap({
  meta: {
    id:          'crossfire',
    name:        'Overpass',
    description: 'Enclosed underpass flanks with a long open highway mid lane.',
  },
  pillars,
  covers,
  dumpsters: [[22, 20], [21, 24], [23, 24]],
  lamps: (() => {
    const out = [];
    for (const gz of [GZ_SA2 + 7, GZ_SA2 + 18, GZ_SA2 + 29]) {
      for (const gx of [GX_L1 + 2, GX_L2 - 1, GX_R1 + 1, GX_R2 - 2]) {
        if (!isDoorCell(gx, gz)) out.push([gx, gz]);
      }
    }
    return out;
  })(),
  theme: { sky: 0x8898a8, fog: 0x6a7888, fogDensity: 0.012 },
  sceneProfile: {
    midSpace:      'exterior',
    sideSpace:     'interior',
    sideRoof:      true,
    midParapet:    true,
    midParapetH:   1.05,
    midDeck:       true,
    midStripes:    true,
    sideWallHeight: 3.8,
    lampH:         2.8,
    laneStripes:   true,
    palette: {
      asphalt:  0x222428,
      concrete: 0x707880,
      building: 0x484c54,
      intFloor: 0x2c3038,
      roof:     0x383c44,
      cover:    0xd4c840,
      stripe:   0xe8e8e8,
    },
  },
});
