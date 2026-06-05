// ═══════════════════════════════════════════════════════════
//  WARFRONT — Networked bot proxy (client visuals only)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import {
  buildCharacterMesh,
  updateCharacterAnimation,
  botStateToPose,
  resetCharacterPose,
} from '../character.js';
import { BOT_HEALTH } from '../config.js';

export class SyncedBot {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../mapgen.js').MapGenerator} map
   * @param {number} index
   * @param {{ playerTeam?: string|null }} [opts]
   */
  constructor(scene, map, index, opts = {}) {
    this.scene      = scene;
    this.map        = map;
    this.index      = index;
    this.playerTeam = opts.playerTeam ?? null;

    this.targetPos  = new THREE.Vector3();
    this.targetRotY = 0;
    this.prevPos    = new THREE.Vector3();
    this.health     = BOT_HEALTH;
    this.maxHealth  = BOT_HEALTH;
    this.alive      = true;
    this.state      = 'advance';
    this.kills      = 0;
    this.deaths     = 0;
    this.assists    = 0;
    this.team       = null;
    this._visualTeam      = null;
    this._visualLabelRole = null;

    const built = this._buildMesh('enemy', 'enemy');
    this.mesh      = built.mesh;
    this.rig       = built.rig;
    this.healthBar = built.healthBar;
    scene.add(this.mesh);
  }

  /** @param {string|null} playerTeam — lodibidon ally team for label colours */
  setPlayerTeam(playerTeam) {
    if (this.playerTeam === playerTeam) return;
    this.playerTeam = playerTeam;
    this._maybeRebuildVisual();
  }

  applyState(data) {
    this.targetPos.set(data.x ?? 0, 0, data.z ?? 0);
    this.targetRotY = data.rotY ?? 0;
    this.health     = data.health ?? this.maxHealth;
    this.alive      = !!data.alive;
    this.state      = data.state ?? 'advance';
    this.kills      = data.kills   ?? 0;
    this.deaths     = data.deaths  ?? 0;
    this.assists    = data.assists ?? 0;
    this.team       = data.team    ?? null;
    this.mesh.visible = this.alive;
    this._maybeRebuildVisual();
  }

  _labelRoleForTeam(team) {
    if (team !== 'alpha' && team !== 'omega') return 'enemy';
    if (!this.playerTeam) return 'enemy';
    return team === this.playerTeam ? 'ally' : 'enemy';
  }

  _maybeRebuildVisual() {
    if (this.team !== 'alpha' && this.team !== 'omega') return;
    const labelRole = this._labelRoleForTeam(this.team);
    if (this._visualTeam === this.team && this._visualLabelRole === labelRole) return;
    this._swapMesh(this.team, labelRole);
    this._visualTeam = this.team;
    this._visualLabelRole = labelRole;
  }

  _buildMesh(bodyTeam, labelRole) {
    const { mesh, rig, healthBar } = buildCharacterMesh({
      team: bodyTeam,
      labelRole,
      name: `BOT-${this.index + 1}`,
      showHealthBar: true,
    });
    mesh.userData.syncedBotIndex = this.index;
    return { mesh, rig, healthBar };
  }

  _swapMesh(bodyTeam, labelRole) {
    const pos     = this.mesh.position.clone();
    const rotY    = this.mesh.rotation.y;
    const visible = this.mesh.visible;

    resetCharacterPose(this.rig);
    this._disposeMeshResources(this.mesh);
    this.scene.remove(this.mesh);

    const built = this._buildMesh(bodyTeam, labelRole);
    this.mesh      = built.mesh;
    this.rig       = built.rig;
    this.healthBar = built.healthBar;
    this.mesh.position.copy(pos);
    this.mesh.rotation.y = rotY;
    this.mesh.visible = visible;
    this.prevPos.copy(pos);
    this.scene.add(this.mesh);
  }

  _disposeMeshResources(mesh) {
    mesh.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
  }

  dispose() {
    resetCharacterPose(this.rig);
    this.scene.remove(this.mesh);
    this._disposeMeshResources(this.mesh);
  }

  updateVisual(delta, camera, onFootstep) {
    if (!this.alive) return;

    this.mesh.position.lerp(this.targetPos, 0.3);
    const cur = this.mesh.rotation.y;
    let diff  = this.targetRotY - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.mesh.rotation.y = cur + diff * 0.28;

    const moved = this.prevPos.distanceTo(this.mesh.position);
    this.prevPos.copy(this.mesh.position);

    updateCharacterAnimation(
      this.rig,
      delta,
      botStateToPose(this.state, moved > delta * 0.35),
    );

    if (moved > 0.008) {
      this._stepTimer = (this._stepTimer ?? 0) - delta;
      if (this._stepTimer <= 0) {
        this._stepTimer = moved > 0.02 ? 0.32 : 0.48;
        onFootstep?.('footstep', this.mesh.position, { volume: 0.5, maxDist: 22 });
      }
    }
  }
}
