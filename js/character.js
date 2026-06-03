// ═══════════════════════════════════════════════════════════
//  WARFRONT — Character model & animation (bots + players)
//  High-detail primitive rigs with hierarchical limb joints.
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';

// ─── TEAM PALETTES ───────────────────────────────────────────
const TEAMS = {
  enemy: {
    uniform:     0x5c6354,   // khaki-olive
    uniformDark: 0x3e4438,
    vest:        0x2f3528,   // dark olive vest
    plate:       0x484e44,   // grey-green plate
    helmet:      0x3a4038,
    visor:       0x1c2218,
    skin:        0x7a6e5c,
    glove:       0x242420,
    boot:        0x141414,
    metal:       0x2c2c28,
    nameColor:   '#a8a898',
    labelColor:  0x6a7a5a,
    barBg:       0x222220,
  },
  ally: {
    uniform:     0x525a4e,   // cool khaki
    uniformDark: 0x383e36,
    vest:        0x2a3228,
    plate:       0x424840,
    helmet:      0x363c36,
    visor:       0x182018,
    skin:        0x7a6e5c,
    glove:       0x222220,
    boot:        0x121212,
    metal:       0x282826,
    nameColor:   '#b0b8a8',
    labelColor:  0x5a6a52,
    barBg:       0x1e1e1c,
  },
};

// ─── GEOMETRY HELPERS ─────────────────────────────────────────
function part(group, shape, mat, params, pos, rot = [0, 0, 0]) {
  let geo;
  if (shape === 'box') {
    geo = new THREE.BoxGeometry(...params);
  } else {
    geo = new THREE.CylinderGeometry(...params);
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  group.add(mesh);
  return mesh;
}

function makeMats(teamKey) {
  const t = TEAMS[teamKey] ?? TEAMS.enemy;
  return {
    uniform:     new THREE.MeshLambertMaterial({ color: t.uniform }),
    uniformDark: new THREE.MeshLambertMaterial({ color: t.uniformDark }),
    vest:        new THREE.MeshLambertMaterial({ color: t.vest }),
    plate:       new THREE.MeshLambertMaterial({ color: t.plate }),
    helmet:      new THREE.MeshLambertMaterial({ color: t.helmet }),
    visor:       new THREE.MeshLambertMaterial({ color: t.visor }),
    skin:        new THREE.MeshLambertMaterial({ color: t.skin }),
    glove:       new THREE.MeshLambertMaterial({ color: t.glove }),
    boot:        new THREE.MeshLambertMaterial({ color: t.boot }),
    metal:       new THREE.MeshLambertMaterial({ color: t.metal }),
    gunBody:     new THREE.MeshLambertMaterial({ color: 0x1a1a1e }),
    gunMetal:    new THREE.MeshLambertMaterial({ color: 0x111114 }),
  };
}

/** Compact assault-rifle prop attached to the right hand. */
function buildHeldWeapon(parent, mats) {
  const g = new THREE.Group();
  g.position.set(0.06, -0.04, 0.14);
  g.rotation.set(-0.55, 0.05, 0);

  part(g, 'box', mats.gunBody,  [0.045, 0.042, 0.22],  [0, 0, -0.04]);
  part(g, 'box', mats.gunMetal, [0.042, 0.014, 0.19],  [0, 0.028, -0.02]);
  part(g, 'cyl', mats.gunMetal, [0.009, 0.011, 0.20, 8], [0, 0.028, -0.16], [Math.PI / 2, 0, 0]);
  part(g, 'box', mats.gunBody,  [0.028, 0.075, 0.038], [0, -0.055, 0.02]);
  part(g, 'box', mats.gunBody,  [0.026, 0.065, 0.036], [0, -0.048, 0.07]);
  part(g, 'box', mats.gunBody,  [0.032, 0.022, 0.09],  [0, 0, 0.12]);
  part(g, 'box', mats.gunMetal, [0.014, 0.014, 0.022], [0, 0.028, -0.27]);
  part(g, 'box', mats.gunMetal, [0.006, 0.018, 0.035], [0.024, 0, 0]);

  parent.add(g);
  return g;
}

/**
 * Build a detailed soldier mesh.
 * @param {object} opts
 * @param {'enemy'|'ally'} [opts.team='enemy']
 * @param {string}         [opts.name='Soldier']
 * @param {boolean}        [opts.showHealthBar=true]
 */
export function buildCharacterMesh({ team = 'enemy', name = 'Soldier', showHealthBar = true } = {}) {
  const palette = TEAMS[team] ?? TEAMS.enemy;
  const mats    = makeMats(team);
  const root    = new THREE.Group();

  // ── Torso stack ──────────────────────────────────────────
  const torso = new THREE.Group();
  torso.position.y = 0.92;
  root.add(torso);

  part(torso, 'box', mats.uniformDark, [0.42, 0.22, 0.26], [0, -0.38, 0]);          // pelvis
  part(torso, 'box', mats.metal,       [0.44, 0.06, 0.28], [0, -0.48, 0.02]);       // belt
  part(torso, 'box', mats.metal,       [0.05, 0.05, 0.04], [-0.16, -0.48, 0.14]);   // buckle
  part(torso, 'box', mats.uniform,     [0.50, 0.38, 0.28], [0, -0.08, 0]);          // lower torso
  part(torso, 'box', mats.uniform,     [0.54, 0.36, 0.30], [0, 0.22, 0]);           // chest
  part(torso, 'box', mats.vest,        [0.56, 0.42, 0.32], [0, 0.20, 0.01]);        // vest
  part(torso, 'box', mats.plate,       [0.28, 0.30, 0.04], [0, 0.24, 0.17]);         // front plate
  part(torso, 'box', mats.plate,       [0.14, 0.18, 0.03], [-0.20, 0.18, 0.16]);     // side plate L
  part(torso, 'box', mats.plate,       [0.14, 0.18, 0.03], [0.20, 0.18, 0.16]);      // side plate R
  part(torso, 'box', mats.vest,        [0.10, 0.14, 0.08], [-0.22, 0.02, 0.12]);     // pouch L
  part(torso, 'box', mats.vest,        [0.10, 0.14, 0.08], [0.22, 0.02, 0.12]);      // pouch R
  part(torso, 'box', mats.uniformDark, [0.22, 0.28, 0.12], [0, 0.18, -0.18]);        // backpack
  part(torso, 'box', mats.metal,       [0.08, 0.06, 0.04], [-0.24, 0.38, 0]);         // radio
  part(torso, 'cyl', mats.metal,       [0.025, 0.025, 0.04, 6], [-0.24, 0.44, 0]);   // antenna

  // ── Head ─────────────────────────────────────────────────
  const head = new THREE.Group();
  head.position.y = 0.58;
  torso.add(head);

  part(head, 'cyl', mats.skin,   [0.09, 0.11, 0.14, 8], [0, 0, 0]);                 // neck
  part(head, 'box', mats.skin,   [0.30, 0.28, 0.28], [0, 0.20, 0]);                  // head
  part(head, 'box', mats.helmet, [0.36, 0.10, 0.32], [0, 0.38, 0]);                  // helmet base
  part(head, 'box', mats.helmet, [0.34, 0.08, 0.30], [0, 0.46, 0]);                  // helmet crown
  part(head, 'box', mats.helmet, [0.38, 0.04, 0.34], [0, 0.34, 0.02]);               // brim
  part(head, 'box', mats.visor,  [0.32, 0.08, 0.04], [0, 0.22, 0.15]);               // visor
  part(head, 'box', mats.metal,  [0.10, 0.04, 0.06], [0, 0.48, 0.02]);               // nvg mount
  part(head, 'box', mats.metal,  [0.06, 0.05, 0.08], [0.12, 0.46, 0.06]);             // nvg pod

  // ── Limb factory ─────────────────────────────────────────
  function buildArm(side, withWeapon) {
    const sign = side === 'left' ? -1 : 1;
    const grp  = new THREE.Group();
    grp.position.set(sign * 0.34, 0.38, 0);
    torso.add(grp);

    part(grp, 'box', mats.plate,   [0.14, 0.08, 0.16], [sign * 0.02, 0.02, 0]);     // shoulder pad
    const upper = part(grp, 'box', mats.uniform, [0.15, 0.26, 0.15], [0, -0.16, 0]);
    part(grp, 'box', mats.plate,   [0.13, 0.05, 0.14], [0, -0.30, 0.02]);           // upper armband

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.28, 0);
    grp.add(elbow);

    const forearm = part(elbow, 'box', mats.uniformDark, [0.13, 0.22, 0.13], [0, -0.12, 0]);
    part(elbow, 'box', mats.plate, [0.12, 0.05, 0.12], [0, -0.20, 0.02]);            // forearm guard

    const hand = new THREE.Group();
    hand.position.set(0, -0.24, 0);
    elbow.add(hand);
    part(hand, 'box', mats.glove, [0.11, 0.10, 0.12], [0, -0.04, 0.02]);

    let weapon = null;
    if (withWeapon) weapon = buildHeldWeapon(hand, mats);

    return { group: grp, upper, elbow, forearm, hand, weapon };
  }

  function buildLeg(side) {
    const sign = side === 'left' ? -1 : 1;
    const grp  = new THREE.Group();
    grp.position.set(sign * 0.13, -0.38, 0);
    torso.add(grp);

    const thigh = part(grp, 'box', mats.uniform, [0.18, 0.28, 0.20], [0, -0.16, 0]);
    part(grp, 'box', mats.plate, [0.16, 0.07, 0.18], [0, -0.28, 0.04]);             // holster/thigh pouch

    const knee = new THREE.Group();
    knee.position.set(0, -0.30, 0);
    grp.add(knee);

    part(knee, 'box', mats.plate, [0.17, 0.07, 0.19], [0, 0, 0.03]);                 // knee pad
    const shin = part(knee, 'box', mats.uniformDark, [0.16, 0.24, 0.17], [0, -0.14, 0]);

    const foot = new THREE.Group();
    foot.position.set(0, -0.26, 0.04);
    knee.add(foot);
    part(foot, 'box', mats.boot, [0.17, 0.10, 0.24], [0, -0.04, 0.04]);             // boot
    part(foot, 'box', mats.boot, [0.18, 0.04, 0.10], [0, -0.09, 0.12]);               // sole

    return { group: grp, thigh, knee, shin, foot };
  }

  const leftArm  = buildArm('left', false);
  const rightArm = buildArm('right', true);
  const leftLeg  = buildLeg('left');
  const rightLeg = buildLeg('right');

  // ── Name label ───────────────────────────────────────────
  const nameCanvas = document.createElement('canvas');
  nameCanvas.width = 256; nameCanvas.height = 48;
  const nc = nameCanvas.getContext('2d');
  nc.font = 'bold 22px "Rajdhani", sans-serif';
  nc.fillStyle = palette.nameColor;
  nc.textAlign = 'center';
  nc.shadowColor = 'rgba(0,0,0,0.85)';
  nc.shadowBlur = 6;
  nc.fillText(name, 128, 34);
  const nameSprite = new THREE.Mesh(
    new THREE.PlaneGeometry(1.05, 0.20),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(nameCanvas),
      transparent: true, depthTest: false, side: THREE.DoubleSide,
    }),
  );
  nameSprite.name = 'nameSprite';
  nameSprite.position.y = 2.35;
  root.add(nameSprite);

  // ── Health bar ───────────────────────────────────────────
  let healthBar = null;
  if (showHealthBar) {
    const barBg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.52, 0.06),
      new THREE.MeshBasicMaterial({ color: palette.barBg, depthTest: false }),
    );
    barBg.position.y = 2.15;
    root.add(barBg);

    healthBar = new THREE.Mesh(
      new THREE.PlaneGeometry(0.52, 0.06),
      new THREE.MeshBasicMaterial({ color: palette.labelColor, depthTest: false }),
    );
    healthBar.position.set(0, 2.15, 0.002);
    root.add(healthBar);
  }

  const rig = {
    root,
    torso,
    head,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    animPhase: 0,
    bobPhase:  0,
    recoilT:   0,
  };

  root.userData.isCharacter = true;
  return { mesh: root, rig, healthBar, mats };
}

/**
 * Drive character animation from a pose name.
 * @param {object} rig       — returned by buildCharacterMesh
 * @param {number} delta     — seconds
 * @param {'idle'|'walk'|'run'|'aim'|'cover'|'jump'} pose
 */
export function updateCharacterAnimation(rig, delta, pose) {
  if (!rig) return;
  const L = rig.leftArm;
  const R = rig.rightArm;
  const LL = rig.leftLeg;
  const RL = rig.rightLeg;
  const t  = Math.min(1, delta * 10);

  const lerp = (obj, prop, target) => {
    obj[prop] = THREE.MathUtils.lerp(obj[prop], target, t);
  };

  // Torso bob reset
  let bobY = 0;
  let torsoLean = 0;
  let headLean = 0;

  if (pose === 'jump') {
    lerp(LL.group.rotation, 'x', -0.45);
    lerp(LL.knee.rotation, 'x', -0.85);
    lerp(RL.group.rotation, 'x', -0.45);
    lerp(RL.knee.rotation, 'x', -0.85);
    lerp(L.group.rotation, 'x', 0.55);
    lerp(L.elbow.rotation, 'x', -0.35);
    lerp(R.group.rotation, 'x', 0.55);
    lerp(R.elbow.rotation, 'x', -0.35);
    lerp(rig.torso.rotation, 'x', -0.06);
    bobY = 0.04;
  } else if (pose === 'aim') {
    lerp(L.group.rotation, 'x', -0.95);
    lerp(L.elbow.rotation, 'x', -0.55);
    lerp(R.group.rotation, 'x', -1.15);
    lerp(R.elbow.rotation, 'x', -0.45);
    lerp(LL.group.rotation, 'x', 0.08);
    lerp(LL.knee.rotation, 'x', -0.12);
    lerp(RL.group.rotation, 'x', -0.08);
    lerp(RL.knee.rotation, 'x', -0.12);
    torsoLean = 0.10;
    headLean = -0.04;
    if (R.weapon) {
      lerp(R.weapon.rotation, 'x', -0.08);
      if (rig.recoilT > 0) {
        R.weapon.rotation.x -= rig.recoilT * 0.18;
        rig.recoilT = Math.max(0, rig.recoilT - delta * 5);
      }
    }
  } else if (pose === 'cover') {
    lerp(L.group.rotation, 'x', -0.55);
    lerp(L.elbow.rotation, 'x', -0.30);
    lerp(R.group.rotation, 'x', -0.70);
    lerp(R.elbow.rotation, 'x', -0.25);
    lerp(LL.group.rotation, 'x', 1.05);
    lerp(LL.knee.rotation, 'x', -1.35);
    lerp(RL.group.rotation, 'x', 1.05);
    lerp(RL.knee.rotation, 'x', -1.35);
    torsoLean = 0.22;
    bobY = -0.12;
  } else if (pose === 'idle') {
    rig.bobPhase += delta * 1.6;
    bobY = Math.sin(rig.bobPhase) * 0.012;
    lerp(L.group.rotation, 'x', 0.04);
    lerp(L.elbow.rotation, 'x', -0.08);
    lerp(R.group.rotation, 'x', -0.12);
    lerp(R.elbow.rotation, 'x', -0.15);
    lerp(LL.group.rotation, 'x', 0);
    lerp(LL.knee.rotation, 'x', 0);
    lerp(RL.group.rotation, 'x', 0);
    lerp(RL.knee.rotation, 'x', 0);
  } else {
    // walk / run gait with knee & elbow bend
    const isRun = pose === 'run';
    const freq  = isRun ? 11 : 6;
    const amp   = isRun ? 0.72 : 0.48;
    rig.animPhase += delta * freq;
    const s  = Math.sin(rig.animPhase);
    const s2 = Math.sin(rig.animPhase + Math.PI);

    lerp(L.group.rotation, 'x',  s * amp * 0.75);
    lerp(L.elbow.rotation, 'x', -Math.abs(s) * 0.55);
    lerp(R.group.rotation, 'x',  s2 * amp * 0.75);
    lerp(R.elbow.rotation, 'x', -Math.abs(s2) * 0.55);

    lerp(LL.group.rotation, 'x', -s * amp);
    lerp(LL.knee.rotation, 'x', Math.max(0, s) * amp * 1.1);
    lerp(RL.group.rotation, 'x', -s2 * amp);
    lerp(RL.knee.rotation, 'x', Math.max(0, s2) * amp * 1.1);

    bobY = Math.abs(Math.sin(rig.animPhase * 2)) * (isRun ? 0.045 : 0.025);
    torsoLean = isRun ? 0.12 : 0.05;

    if (R.weapon) lerp(R.weapon.rotation, 'x', -0.55 + Math.sin(rig.animPhase) * 0.04);
  }

  lerp(rig.torso.rotation, 'x', torsoLean);
  lerp(rig.head.rotation, 'x', headLean);
  rig.torso.position.y = 0.92 + bobY;
}

/** Reset all joint rotations (e.g. on respawn). */
export function resetCharacterPose(rig) {
  if (!rig) return;
  rig.animPhase = 0;
  rig.bobPhase  = 0;
  rig.recoilT   = 0;
  rig.torso.position.y = 0.92;
  rig.torso.rotation.set(0, 0, 0);
  rig.head.rotation.set(0, 0, 0);

  for (const limb of [rig.leftArm, rig.rightArm, rig.leftLeg, rig.rightLeg]) {
    limb.group.rotation.set(0, 0, 0);
    if (limb.elbow) limb.elbow.rotation.set(0, 0, 0);
    if (limb.knee)  limb.knee.rotation.set(0, 0, 0);
    if (limb.weapon) limb.weapon.rotation.set(-0.55, 0.05, 0);
  }
}

/** Brief weapon kick when the character fires. */
export function triggerCharacterRecoil(rig) {
  if (rig) rig.recoilT = 1;
}

/** Billboard name/health sprites toward the camera. */
export function billboardCharacterLabels(mesh, camera, healthBar, healthRatio = 1) {
  mesh.traverse(c => {
    if (c.isMesh && c.material?.depthTest === false) c.lookAt(camera.position);
  });
  if (healthBar) {
    healthBar.scale.x = Math.max(0, healthRatio);
    healthBar.position.x = (healthRatio - 1) * 0.26;
  }
}

/** Map bot AI state → animation pose. */
export function botStateToPose(state, atCoverPoint = false) {
  if (state === 'attack') return 'aim';
  if (state === 'cover')  return atCoverPoint ? 'cover' : 'run';
  if (state === 'chase')  return 'run';
  return 'walk';
}
