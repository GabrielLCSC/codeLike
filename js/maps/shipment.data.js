// ═══════════════════════════════════════════════════════════
//  SHIPMENT — Container yard (interior warehouses + exterior mid)
// ═══════════════════════════════════════════════════════════

import {
  makeTriLaneMap,
  sideLaneLamps,
  GX_L1, GX_L2, GX_R1, GX_R2, GZ_SA2, GZ_LE,
  isDoorCell, isSideLane,
} from './lane-layout.js';

/** Stacked containers along side-lane interiors. [gx, gz, stackHeight] */
const containers = (() => {
  const out = [];
  const rows = [GZ_SA2 + 3, GZ_SA2 + 8, GZ_SA2 + 14, GZ_SA2 + 20, GZ_SA2 + 26, GZ_LE - 3];
  for (const gz of rows) {
    for (let gx = GX_L1 + 1; gx <= GX_L2 - 1; gx++) {
      if (isDoorCell(gx, gz)) continue;
      if ((gx + gz) % 3 === 0) out.push([gx, gz, 1 + (gz % 5 === 0 ? 1 : 0)]);
    }
    for (let gx = GX_R1 + 1; gx <= GX_R2 - 1; gx++) {
      if (isDoorCell(gx, gz)) continue;
      if ((gx + gz) % 3 === 1) out.push([gx, gz, 1]);
    }
  }
  return out;
})();

/** Open-air mid yard — scattered crates & barrels. */
const midCovers = [
  [19, 16], [25, 16], [22, 20],
  [18, 24], [26, 24], [22, 28],
  [20, 32], [24, 32],
];

const tallCovers = [
  [8, 18], [8, 24], [35, 18], [35, 24],
];

export const SHIPMENT_GAMEPLAY = makeTriLaneMap({
  meta: {
    id:          'shipment',
    name:        'Container Yard',
    description: 'Indoor warehouse lanes open onto a sunlit loading yard.',
  },
  containers,
  covers: midCovers,
  tallCovers,
  dumpsters: [[22, 22], [20, 26], [24, 26]],
  lamps: sideLaneLamps().filter(([gx, gz]) => isSideLane(gx, gz)),
  theme: { sky: 0x9a8a72, fog: 0x8a7a62, fogDensity: 0.015 },
  sceneProfile: {
    midSpace:      'exterior',
    sideSpace:     'interior',
    sideRoof:      true,
    midParapet:    true,
    midParapetH:   0.75,
    midDeck:       true,
    skylightBands: true,
    sideWallHeight: 3.6,
    laneStripes:   true,
    edgeAccents:   true,
    palette: {
      asphalt:  0x2a2824,
      concrete: 0x5a5a62,
      building: 0x3a4448,
      intFloor: 0x2e3234,
      roof:     0x353a3e,
      cover:    0x6a5038,
      rust:     0x8a4020,
      stripe:   0xd4a030,
      accent:   0xff8822,
      accentEmissive: 0x442200,
    },
  },
});
