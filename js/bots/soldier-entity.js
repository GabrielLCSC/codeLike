// ═══════════════════════════════════════════════════════════
//  WARFRONT — Bot soldier entity (mesh, vitals, VFX, animation)
// ═══════════════════════════════════════════════════════════

import {
  BOT_HEALTH,
  BOT_RESPAWN_MS,
} from '../config.js';
import {
  buildCharacterMesh,
  updateCharacterAnimation,
  resetCharacterPose,
  resetCharacterDeath,
  triggerCharacterRecoil,
  updateCharacterOverheadUI,
  updateCharacterDeath,
  beginCharacterDeath,
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
    this.dying     = false;
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
    if (this.dying) return;
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

  updateDeath(delta) {
    if (!this.dying) return;
    updateCharacterDeath(this.rig, this.mesh, delta);
  }

  updateHealthBar(camera, map, opts = {}) {
    if (this.dying || (!this.alive && !opts.alwaysShow)) return;
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

  _finishDeathVisual() {
    this.dying = false;
    this.mesh.visible = false;
    resetCharacterDeath(this.rig, this.mesh);
    resetCharacterPose(this.rig);
  }

  /**
   * @param {() => void} [onRespawn]
   * @param {number} [respawnMs] — 0 disables respawn (lodibidon)
   */
  die(onRespawn, respawnMs = BOT_RESPAWN_MS) {
    this.alive = false;
    this.dying = true;
    this.mesh.visible = true;

    beginCharacterDeath(this.rig, this.mesh, {
      onComplete: () => this._finishDeathVisual(),
    });

    if (respawnMs <= 0) return;

    setTimeout(() => {
      this.health = this.maxHealth;
      this.alive  = true;
      this.dying  = false;
      this.phase  = 'advance';
      this._mats.forEach(m => { m.emissive?.set(0x000000); });
      resetCharacterDeath(this.rig, this.mesh);
      resetCharacterPose(this.rig);
      this.mesh.position.set(this.spawnPos.x, 0, this.spawnPos.z);
      this.mesh.rotation.set(0, 0, 0);
      this.mesh.visible = true;
      onRespawn?.();
    }, BOT_RESPAWN_MS);
  }
}
