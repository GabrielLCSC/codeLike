// ═══════════════════════════════════════════════════════════
//  WARFRONT — Custom map day / night ambiance
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';

/** @typedef {'day'|'night'} MapTimeOfDay */

/** @type {Record<MapTimeOfDay, object>} */
export const MAP_TIME_PRESETS = {
  day: {
    sky:          0x8899aa,
    fog:          0x8899aa,
    fogDensity:   0.016,
    ambientColor: 0xb8c8dc,
    ambientInt:   0.95,
    sunColor:     0xfff0dd,
    sunInt:       1.25,
    sunPos:       [40, 60, 20],
    hemiSky:      0x8caabb,
    hemiGround:   0x4a5538,
    hemiInt:      0.62,
    midLightColor: 0xff9933,
    midLightInt:  2.4,
  },
  night: {
    sky:          0x080c18,
    fog:          0x0a1020,
    fogDensity:   0.032,
    ambientColor: 0x223355,
    ambientInt:   0.42,
    sunColor:     0x6688cc,
    sunInt:       0.18,
    sunPos:       [-20, 45, 10],
    hemiSky:      0x1a2844,
    hemiGround:   0x0a0a12,
    hemiInt:      0.35,
    midLightColor: 0xffaa55,
    midLightInt:  1.6,
  },
};

/**
 * @param {{ theme?: { timeOfDay?: MapTimeOfDay } }} mapData
 */
export function resolveMapTheme(mapData) {
  const timeOfDay = mapData?.theme?.timeOfDay === 'night' ? 'night' : 'day';
  return { timeOfDay, ...MAP_TIME_PRESETS[timeOfDay] };
}

/** @param {THREE.Scene|null|undefined} scene @param {ReturnType<typeof resolveMapTheme>} theme */
export function applySceneTheme(scene, theme) {
  if (!scene) return;
  scene.background = new THREE.Color(theme.sky);
  scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);
}

/** @param {THREE.Scene} scene @param {ReturnType<typeof resolveMapTheme>} theme @param {{ x: number, z: number }} center */
export function rebuildEditorLighting(scene, theme, center, wallHeight = 4) {
  const toRemove = [];
  scene.traverse(c => {
    if (c.userData?.editorLight) toRemove.push(c);
  });
  for (const l of toRemove) scene.remove(l);

  const amb = new THREE.AmbientLight(theme.ambientColor, theme.ambientInt);
  amb.userData.editorLight = true;
  scene.add(amb);

  const sun = new THREE.DirectionalLight(theme.sunColor, theme.sunInt);
  sun.position.set(...theme.sunPos);
  sun.userData.editorLight = true;
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiInt);
  hemi.userData.editorLight = true;
  scene.add(hemi);

  const mid = new THREE.PointLight(theme.midLightColor, theme.midLightInt, 48);
  mid.position.set(center.x, wallHeight + 2, center.z);
  mid.userData.editorLight = true;
  scene.add(mid);
}
