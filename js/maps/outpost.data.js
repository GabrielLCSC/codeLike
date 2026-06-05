// ═══════════════════════════════════════════════════════════
//  OUTPOST — Old Quarter (covered bazaar lanes + sunlit courtyard)
// ═══════════════════════════════════════════════════════════

import {
  makeTriLaneMap,
  GX_L1, GX_L2, GX_R1, GX_R2, GX_M1, GX_M2, GZ_SA2, GZ_LE,
  isDoorCell,
} from './lane-layout.js';

/** Market stalls in side-lane interiors. */
const stallCovers = (() => {
  const out = [];
  for (let gz = GZ_SA2 + 2; gz < GZ_LE - 1; gz += 3) {
    for (let gx = GX_L1 + 1; gx <= GX_L2 - 2; gx++) {
      if (isDoorCell(gx, gz)) continue;
      if ((gx + gz) % 2 === 0) out.push([gx, gz]);
    }
    for (let gx = GX_R1 + 1; gx <= GX_R2 - 2; gx++) {
      if (isDoorCell(gx, gz)) continue;
      if ((gx + gz) % 2 === 1) out.push([gx, gz]);
    }
  }
  return out;
})();

/** Courtyard fountain + broken pillars in open mid. */
const midPillars = [
  [GX_M1 + 3, GZ_SA2 + 8], [GX_M2 - 4, GZ_SA2 + 8],
  [GX_M1 + 3, GZ_LE - 4],  [GX_M2 - 4, GZ_LE - 4],
  [21, 22], [23, 22],
];

const midCovers = [
  [19, 15], [25, 15], [19, 29], [25, 29],
  [22, 18], [22, 26],
];

export const OUTPOST_GAMEPLAY = makeTriLaneMap({
  meta: {
    id:          'outpost',
    name:        'Old Quarter',
    description: 'Shaded bazaar alleys spill into a bright central courtyard.',
  },
  pillars: midPillars,
  covers:  [...stallCovers, ...midCovers],
  awnings: stallCovers.filter((_, i) => i % 2 === 0),
  dumpsters: [[22, 22], [8, 20], [35, 20]],
  lamps: [],
  theme: { sky: 0xc4a878, fog: 0xb89868, fogDensity: 0.011 },
  sceneProfile: {
    midSpace:      'exterior',
    sideSpace:     'interior',
    sideRoof:      true,
    midParapet:    true,
    midParapetH:   0.65,
    midDeck:       true,
    sideWallHeight: 3.4,
    parapetH:    0.45,
    laneStripes:   false,
    palette: {
      asphalt:  0x3a3428,
      concrete: 0x8a7a62,
      building: 0x9a6848,
      intFloor: 0x5a4838,
      roof:     0x6a5038,
      cover:    0x7a5840,
      rust:     0x5a3828,
      awning:   0xc45830,
      stripe:   0x4a4030,
    },
  },
});
