// ═══════════════════════════════════════════════════════════
//  WARFRONT — Bot soldier entity (mesh, vitals, VFX, animation)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import {
  BOT_HEALTH,
  BOT_RESPAWN_MS,
} from '../config.js';
import {
  buildCharacterMesh,
  updateCharacterAnimation,
  resetCharacterPose,
  triggerCharacterRecoil,
  updateCharacterOverheadUI,
  botStateToPose,
} from '../character.js';

/**
 * Visual + health container for one bot. No AI logic.
 */
export class BotSoldierEntity {
  /**
   * @param {THREE.Scene} scene
   * @param {number} index
   * @param {{ x: number, z: number }} spawnPos
   * @param {{ bodyTeam?: string, labelRole?: 'ally'|'enemy' }} [visual]
   */
  constructor(scene, index, spawnPos, visual = {}) {
    this.scene    = scene;
    this.index    = index;
    this.spawnPos = { ...spawnPos };

    this.health    = BOT_HEALTH;
    this.maxHealth = BOT_HEALTH;
    this.alive     = true;
    this.phase     = 'advance';

    const { mesh, rig, healthBar } = buildCharacterMesh({
      team:      visual.bodyTeam ?? 'enemy',
      labelRole: visual.labelRole ?? 'enemy',
      name:      `BOT-${index + 1}`,
      showHealthBar: true,
    });
    this.mesh       = mesh;
    this.rig        = rig;
    this.healthBar  = healthBar;
    this._prevAnimX = spawnPos.x;
    this._prevAnimZ = spawnPos.z;

    mesh.position.set(spawnPos.x, 0, spawnPos.z);
    scene.add(mesh);

    this._mats = [];
    mesh.traverse(c => { if (c.isMesh) this._mats.push(c.material); });
    this._flashTimer = null;
  }

  getSyncState() {
    return {
      x:      this.mesh.position.x,
      z:      this.mesh.position.z,
      rotY:   this.mesh.rotation.y,
      health: this.health,
      alive:  this.alive,
      state:  this.phase,
    };
  }

  updateAnimation(delta, moving) {
    const bx = this.mesh.position.x;
    const bz = this.mesh.position.z;
    const moved = Math.hypot(bx - this._prevAnimX, bz - this._prevAnimZ);
    this._prevAnimX = bx;
    this._prevAnimZ = bz;
    updateCharacterAnimation(
      this.rig,
      delta,
      botStateToPose(this.phase, moving || moved > delta * 0.35),
    );
  }

  updateHealthBar(camera, map, opts = {}) {
    if (!this.alive && !opts.alwaysShow) return;
    updateCharacterOverheadUI(this.mesh, camera, map, {
      healthBar: this.healthBar,
      healthRatio: this.health / this.maxHealth,
      visible: this.alive,
      ...opts,
    });
  }

  flashHit() {
    this._mats.forEach(m => { m.emissive?.set(0xaa0000); });
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      this._mats.forEach(m => { m.emissive?.set(0x000000); });
    }, 120);
  }

  playRecoil() {
    triggerCharacterRecoil(this.rig);
  }

  /**
   * @param {() => void} [onRespawn]
   * @param {number} [respawnMs] — 0 disables respawn (lodibidon)
   */
  die(onRespawn, respawnMs = BOT_RESPAWN_MS) {
    this.alive = false;
    this.mesh.visible = false;

    const mat = new THREE.MeshLambertMaterial({
      color: 0x3a3f38, transparent: true, opacity: 1,
    });
    const corpse = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 1.50), mat);
    corpse.position.set(this.mesh.position.x, 0.09, this.mesh.position.z);
    corpse.rotation.y = this.mesh.rotation.y;
    this.scene.add(corpse);

    let t = 0;
    const iv = setInterval(() => {
      t += 0.1;
      if (t > 5) mat.opacity = Math.max(0, 1 - (t - 5) / 3);
      if (t >= 8) {
        clearInterval(iv);
        this.scene.remove(corpse);
        mat.dispose();
      }
    }, 100);

    if (respawnMs <= 0) return;

    setTimeout(() => {
      this.health = this.maxHealth;
      this.alive  = true;
      this.phase  = 'advance';
      this._mats.forEach(m => { m.emissive?.set(0x000000); });
      this.mesh.position.set(this.spawnPos.x, 0, this.spawnPos.z);
      this.mesh.rotation.set(0, 0, 0);
      resetCharacterPose(this.rig);
      this.mesh.visible = true;
      onRespawn?.();
    }, BOT_RESPAWN_MS);
  }
}
