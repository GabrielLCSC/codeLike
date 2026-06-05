// ═══════════════════════════════════════════════════════════
//  WARFRONT — Parametric 3-lane scene (interior / exterior)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { MAP_W, MAP_H, CELL_SIZE, WALL_HEIGHT } from '../config.js';
import {
  GX_L2, GX_M1, GX_M2, GX_R1,
  GZ_SA2, GZ_LE,
  W_LW_X, W_LW_W, W_RW_X, W_RW_W,
  W_LANE_Z, W_LANE_D, W_MID_X, W_MID_W, W_L_LX, W_R_LX,
  wx, wz,
} from './lane-layout.js';

const CS = CELL_SIZE;
const WH = WALL_HEIGHT;

/**
 * @param {THREE.Scene} scene
 * @param {import('./index.js').MapGameplay} gp
 * @param {(scene: THREE.Scene, batches: object, materials: object, box: Function) => void} mergeFn
 */
export function buildTriLaneScene(scene, gp, mergeFn) {
  const theme = gp.theme ?? {};
  const prof  = gp.sceneProfile ?? {};
  scene.background = new THREE.Color(theme.sky ?? 0x7a9fc2);
  scene.fog        = new THREE.FogExp2(theme.fog ?? 0x7a9fc2, theme.fogDensity ?? 0.018);

  const pal = prof.palette ?? {};
  const M = {
    asphalt:  new THREE.MeshLambertMaterial({ color: pal.asphalt  ?? 0x1e1e22 }),
    concrete: new THREE.MeshLambertMaterial({ color: pal.concrete ?? 0x6a6a72 }),
    building: new THREE.MeshLambertMaterial({ color: pal.building ?? 0x4e4e56 }),
    intFloor: new THREE.MeshLambertMaterial({ color: pal.intFloor ?? 0x38363c }),
    roof:     new THREE.MeshLambertMaterial({ color: pal.roof     ?? 0x2a2a30 }),
    cover:    new THREE.MeshLambertMaterial({ color: pal.cover    ?? 0x58504a }),
    rust:     new THREE.MeshLambertMaterial({ color: pal.rust     ?? 0x3c1e10 }),
    stripe:   new THREE.MeshLambertMaterial({ color: pal.stripe   ?? 0x3a3830 }),
    accent:   new THREE.MeshLambertMaterial({
      color: pal.accent ?? 0xc4a035,
      emissive: pal.accentEmissive ?? 0x000000,
      emissiveIntensity: pal.accentEmissive ? 0.35 : 0,
    }),
    awning:   new THREE.MeshLambertMaterial({ color: pal.awning ?? 0x8a5038 }),
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

  const midInterior = prof.midSpace === 'interior';
  const sideInterior = prof.sideSpace !== 'exterior';

  box('asphalt', mapW, 0.15, mapD, mapCX, 0, mapCZ);

  // Side-lane interior floors (warehouse / bazaar / tunnel)
  if (sideInterior) {
    box('intFloor', W_LW_W, 0.08, W_LANE_D, W_LW_X, 0.15, W_LANE_Z);
    box('intFloor', W_RW_W, 0.08, W_LANE_D, W_RW_X, 0.15, W_LANE_Z);
  }

  // Mid lane floor — interior slab or exterior deck
  if (midInterior) {
    box('intFloor', W_MID_W, 0.08, W_LANE_D, W_MID_X, 0.15, W_LANE_Z);
  } else if (prof.midDeck) {
    box('concrete', W_MID_W, 0.22, W_LANE_D, W_MID_X, 0.08, W_LANE_Z);
  }

  // Perimeter shell
  const BT = CS * 2;
  const BH = WH + 4.5;
  box('concrete', BT,   BH, mapD, BT * 0.5,        0, mapCZ);
  box('concrete', BT,   BH, mapD, mapW - BT * 0.5, 0, mapCZ);
  box('concrete', mapW, BH, BT,   mapCX, 0, BT * 0.5);
  box('concrete', mapW, BH, BT,   mapCX, 0, mapD - BT * 0.5);

  // Side-lane building shells (interior corridors)
  const sideH = prof.sideWallHeight ?? WH;
  box('building', W_LW_W, sideH, W_LANE_D, W_LW_X, 0, W_LANE_Z);
  box('building', W_RW_W, sideH, W_LANE_D, W_RW_X, 0, W_LANE_Z);

  const roofX = (wx(GX_L2) + wx(GX_R1)) * 0.5;
  const roofW = wx(GX_R1) - wx(GX_L2);

  // Connecting roof over side lanes + optional mid cover
  if (prof.sideRoof !== false) {
    box('roof', roofW, 0.35, W_LANE_D, roofX, sideH, W_LANE_Z);
  }

  const PT = 0.25;
  const PH = prof.parapetH ?? 0.55;
  // Parapet walls bridging side lanes to mid
  box('building', roofW,   PH, PT, roofX, sideH + 0.35, wz(GZ_SA2) - PT * 0.5);
  box('building', roofW,   PH, PT, roofX, sideH + 0.35, wz(GZ_LE)  + PT * 0.5);
  box('building', PT, PH, W_LANE_D, wx(GX_L2) + PT * 0.5, sideH + 0.35, W_LANE_Z);
  box('building', PT, PH, W_LANE_D, wx(GX_R1) - PT * 0.5, sideH + 0.35, W_LANE_Z);

  // Mid-lane roof / skylight
  if (midInterior) {
    box('roof', W_MID_W - 0.05, 0.12, W_LANE_D - 0.05, W_MID_X, WH - 0.12, W_LANE_Z);
    const headerH = WH * 0.28;
    const headerT = CS * 0.5;
    box('building', W_MID_W, headerH, headerT, W_MID_X, WH - headerH, wz(GZ_SA2) - headerT * 0.5);
    box('building', W_MID_W, headerH, headerT, W_MID_X, WH - headerH, wz(GZ_LE)  + headerT * 0.5);
  } else if (prof.midParapet) {
    const pH = prof.midParapetH ?? 0.9;
    const pT = 0.35;
    box('concrete', W_MID_W, pH, pT, W_MID_X, 0, wz(GZ_SA2) - pT * 0.5);
    box('concrete', W_MID_W, pH, pT, W_MID_X, 0, wz(GZ_LE)  + pT * 0.5);
    box('concrete', pT, pH, W_LANE_D, wx(GX_M1) + pT * 0.5, 0, W_LANE_Z);
    box('concrete', pT, pH, W_LANE_D, wx(GX_M2) - pT * 0.5, 0, W_LANE_Z);
  }

  // Skylight strips over exterior mid (container yard / courtyard)
  if (prof.skylightBands) {
    for (const t of [0.3, 0.7]) {
      box('accent', W_MID_W * 0.35, 0.04, 0.5, W_MID_X, sideH + 0.36, wz(GZ_SA2) + W_LANE_D * t);
    }
  }

  // Side-lane interior props
  for (const [gc, gr] of gp.pillars ?? []) {
    const h = prof.pillarH ?? WH;
    box('building', CS * 0.7, h, CS * 0.7, (gc + 0.5) * CS, 0, (gr + 0.5) * CS);
  }
  for (const [gc, gr] of gp.covers ?? []) {
    const tall = gp.tallCovers?.some(c => c[0] === gc && c[1] === gr);
    const ch = tall ? 2.2 : 1.0;
    box('cover', CS * 1.1, ch, CS * 0.4, (gc + 0.5) * CS, 0, (gr + 0.5) * CS);
  }
  for (const [gc, gr] of gp.dumpsters ?? []) {
    box('rust', CS * 0.9, 1.25, CS * 0.55, (gc + 0.5) * CS, 0, (gr + 0.5) * CS);
  }

  // Container stacks (shipment)
  for (const c of gp.containers ?? []) {
    const [gc, gr, stack = 1] = c;
    const bh = CS * 0.85 * stack;
    box('rust', CS * 0.95, bh, CS * 0.95, (gc + 0.5) * CS, 0, (gr + 0.5) * CS);
  }

  // Bazaar awnings over stall covers
  for (const [gc, gr] of gp.awnings ?? []) {
    box('awning', CS * 1.3, 0.08, CS * 0.9, (gc + 0.5) * CS, 2.05, (gr + 0.5) * CS);
  }

  // Lane striping
  if (prof.laneStripes !== false) {
    const markW = 0.18;
    const markH = 0.02;
    const seg   = W_LANE_D * 0.45;
    box('stripe', markW, markH, seg, W_L_LX, 0.16, wz(GZ_SA2) + W_LANE_D * 0.27);
    box('stripe', markW, markH, seg, W_L_LX, 0.16, wz(GZ_SA2) + W_LANE_D * 0.73);
    box('stripe', markW, markH, seg, W_R_LX, 0.16, wz(GZ_SA2) + W_LANE_D * 0.27);
    box('stripe', markW, markH, seg, W_R_LX, 0.16, wz(GZ_SA2) + W_LANE_D * 0.73);
    if (prof.midStripes) {
      box('stripe', markW, markH, seg * 0.8, W_MID_X, 0.18, W_LANE_Z);
    }
  }

  // Lamps
  const lpH = (prof.lampH ?? WH) + 0.8;
  const lpS = 0.10;
  for (const [gc, gr] of gp.lamps ?? []) {
    box('concrete', lpS, lpH, lpS, (gc + 0.5) * CS, 0, (gr + 0.5) * CS);
  }

  // Accent neon / hazard strips on side building edges
  if (prof.edgeAccents) {
    box('accent', 0.12, 0.12, W_LANE_D * 0.6, wx(GX_L2) + 0.2, sideH * 0.55, W_LANE_Z);
    box('accent', 0.12, 0.12, W_LANE_D * 0.6, wx(GX_R1) - 0.2, sideH * 0.55, W_LANE_Z);
  }

  mergeFn(scene, batches, M);
}
