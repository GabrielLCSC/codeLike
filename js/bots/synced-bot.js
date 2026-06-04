// ═══════════════════════════════════════════════════════════
//  WARFRONT — Networked bot proxy (client visuals only)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import {
  buildCharacterMesh,
  updateCharacterAnimation,
  updateCharacterOverheadUI,
  botStateToPose,
  resetCharacterPose,
} from '../character.js';
import { BOT_HEALTH } from '../config.js';

export class SyncedBot {
  constructor(scene, map, index) {
    this.scene  = scene;
    this.map    = map;
    this.index  = index;

    const { mesh, rig, healthBar } = buildCharacterMesh({
      team: 'enemy',
      name: `BOT-${index + 1}`,
      showHealthBar: true,
    });
    mesh.userData.syncedBotIndex = index;

    this.mesh       = mesh;
    this.rig        = rig;
    this.healthBar  = healthBar;
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

    scene.add(mesh);
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
    this.mesh.visible = this.alive;
  }

  dispose() {
    resetCharacterPose(this.rig);
    this.scene.remove(this.mesh);
    this.mesh.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
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

    updateCharacterOverheadUI(this.mesh, camera, this.map, {
      healthBar: this.healthBar,
      healthRatio: this.health / this.maxHealth,
      visible: this.alive,
    });
  }
}
