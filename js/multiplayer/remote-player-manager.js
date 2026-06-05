// ═══════════════════════════════════════════════════════════
//  WARFRONT — Remote player meshes, sync, and interpolation
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import {
  PLAYER_HEIGHT, PLAYER_SPEED, SPRINT_MULT, MAX_HEALTH,
  REMOTE_INTERP_SPEED, REMOTE_EXTRAP_S, REMOTE_SNAP_DIST,
} from '../config.js';
import {
  buildCharacterMesh,
  updateCharacterAnimation,
  updateCharacterOverheadUI,
  resetCharacterPose,
  resetCharacterDeath,
  beginCharacterDeath,
  updateCharacterDeath,
} from '../character.js';

/** Camera eye Y → character feet Y (mesh origin). */
export function eyeHeightToFeetY(eyeY) {
  return Math.max(0, (eyeY ?? PLAYER_HEIGHT) - PLAYER_HEIGHT);
}

/**
 * Manages remote player proxies in multiplayer.
 * @param {import('../game.js').Game} game
 */
export class RemotePlayerManager {
  constructor(game) {
    this.game = game;
    /** @type {Map<string, object>} */
    this.players = new Map();
  }

  clear() {
    const game = this.game;
    for (const { mesh } of this.players.values()) {
      game.scene?.remove(mesh);
    }
    this.players.clear();
  }

  buildMesh(playerName = 'Player', mpTeam = null) {
    const game = this.game;
    const isLod = game._isLodibidon();
    const isAlly = isLod && mpTeam === game.lodibidon?.playerTeam;
    const bodyTeam = mpTeam === 'alpha' || mpTeam === 'omega' ? mpTeam : 'ally';
    const { mesh, rig, healthBar } = buildCharacterMesh({
      team: bodyTeam,
      labelRole: isLod ? (isAlly ? 'ally' : 'enemy') : 'ally',
      name: playerName,
      showHealthBar: true,
    });
    return { mesh, rig, healthBar };
  }

  applySnapshot(rp, data) {
    const x = data.x ?? rp.snapshotX ?? 0;
    const y = data.y ?? rp.snapshotY ?? PLAYER_HEIGHT;
    const z = data.z ?? rp.snapshotZ ?? 0;
    const ts = data.ts ?? Date.now();

    if (rp.snapshotTs != null && ts >= rp.snapshotTs) {
      const dt = (ts - rp.snapshotTs) / 1000;
      if (dt > 0.001 && dt < 1.5) {
        rp.velX = (x - rp.snapshotX) / dt;
        rp.velY = (y - rp.snapshotY) / dt;
        rp.velZ = (z - rp.snapshotZ) / dt;
        const maxH = PLAYER_SPEED * SPRINT_MULT * 1.15;
        const hSpd = Math.hypot(rp.velX, rp.velZ);
        if (hSpd > maxH) {
          rp.velX = (rp.velX / hSpd) * maxH;
          rp.velZ = (rp.velZ / hSpd) * maxH;
        }
        rp.velY = Math.max(-18, Math.min(18, rp.velY));
      }
    }

    rp.snapshotX = x;
    rp.snapshotY = y;
    rp.snapshotZ = z;
    rp.snapshotTs = ts;
    const feetY = eyeHeightToFeetY(y);
    rp.targetPos.set(x, feetY, z);
    rp.targetRotY = data.rotY ?? rp.targetRotY ?? 0;
  }

  onPlayerUpdate(uid, data) {
    const game = this.game;
    if (this.players.has(uid)) {
      const rp = this.players.get(uid);
      const wasAlive = rp.data.alive;
      rp.data = data;
      this.applySnapshot(rp, data);

      if (wasAlive && !data.alive) {
        rp.dying = true;
        rp.mesh.visible = true;
        beginCharacterDeath(rp.rig, rp.mesh, {
          onComplete: () => {
            rp.dying = false;
            rp.mesh.visible = false;
            resetCharacterDeath(rp.rig, rp.mesh);
            resetCharacterPose(rp.rig);
          },
        });

        if (game._recentlyShot.has(uid)) {
          const isHead = game._recentlyShot.get(uid) ?? false;
          game._recentlyShot.delete(uid);
          game._onKill(data.name ?? 'Player', isHead, uid);
        } else if (game._isLodibidon() && (data.team === 'alpha' || data.team === 'omega')) {
          game._lodibidonOnElimination(null, data.team);
        }
      } else if (!wasAlive && data.alive) {
        rp.dying = false;
        resetCharacterDeath(rp.rig, rp.mesh);
        resetCharacterPose(rp.rig);
        rp.mesh.visible = true;
      } else {
        rp.mesh.visible = !!data.alive || !!rp.dying;
      }
      return;
    }

    const { mesh, rig, healthBar } = this.buildMesh(data.name ?? 'Player', data.team);
    const feetY = eyeHeightToFeetY(data.y);
    mesh.position.set(data.x ?? 0, feetY, data.z ?? 0);
    game.scene.add(mesh);
    this.players.set(uid, {
      mesh,
      rig,
      healthBar,
      data,
      dying: false,
      targetPos:  new THREE.Vector3(data.x ?? 0, feetY, data.z ?? 0),
      targetRotY: data.rotY ?? 0,
      prevPos:    new THREE.Vector3(data.x ?? 0, feetY, data.z ?? 0),
      velX:       0,
      velY:       0,
      velZ:       0,
      snapshotX:  data.x ?? 0,
      snapshotY:  data.y ?? PLAYER_HEIGHT,
      snapshotZ:  data.z ?? 0,
      snapshotTs: data.ts ?? Date.now(),
    });
  }

  onPlayerRemoved(uid) {
    const rp = this.players.get(uid);
    if (rp) {
      this.game.scene.remove(rp.mesh);
      this.players.delete(uid);
    }
  }

  update(delta) {
    const game = this.game;
    const smooth = 1 - Math.exp(-REMOTE_INTERP_SPEED * delta);
    const snapDist2 = REMOTE_SNAP_DIST * REMOTE_SNAP_DIST;

    this.players.forEach(rp => {
      if (rp.dying) {
        updateCharacterDeath(rp.rig, rp.mesh, delta);
        return;
      }
      if (!rp.mesh.visible) return;

      const predX = rp.targetPos.x + (rp.velX ?? 0) * REMOTE_EXTRAP_S;
      const predY = Math.max(0, rp.targetPos.y + (rp.velY ?? 0) * REMOTE_EXTRAP_S);
      const predZ = rp.targetPos.z + (rp.velZ ?? 0) * REMOTE_EXTRAP_S;

      const dx = predX - rp.mesh.position.x;
      const dy = predY - rp.mesh.position.y;
      const dz = predZ - rp.mesh.position.z;
      if (dx * dx + dz * dz > snapDist2) {
        rp.mesh.position.x = predX;
        rp.mesh.position.z = predZ;
      } else {
        rp.mesh.position.x += dx * smooth;
        rp.mesh.position.z += dz * smooth;
      }
      if (Math.abs(dy) > 1.2) {
        rp.mesh.position.y = Math.max(0, predY);
      } else {
        rp.mesh.position.y = Math.max(0, rp.mesh.position.y + dy * smooth);
      }

      let rotDiff = rp.targetRotY - rp.mesh.rotation.y;
      while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
      while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
      rp.mesh.rotation.y += rotDiff * (1 - Math.exp(-18 * delta));

      if (rp.rig && rp.prevPos) {
        this._animate(rp, delta);
      }
      const hp = rp.data.health ?? MAX_HEALTH;
      updateCharacterOverheadUI(rp.mesh, game.camera, game.map, {
        healthBar: rp.healthBar,
        healthRatio: Math.max(0, hp / MAX_HEALTH),
        visible: (rp.data.alive ?? true) && hp > 0,
        ...game._lodibidonLabelOpts(rp.data.team),
      });
    });
  }

  _animate(rp, delta) {
    const game = this.game;
    const moved = rp.prevPos.distanceTo(rp.mesh.position);
    rp.prevPos.copy(rp.mesh.position);

    const isAirborne = rp.mesh.position.y > 0.1
      || (rp.snapshotY ?? rp.data.y ?? PLAYER_HEIGHT) > PLAYER_HEIGHT + 0.1;

    let pose = 'idle';
    if (isAirborne) {
      pose = 'jump';
    } else if (moved > 0.005) {
      pose = moved > 0.022 ? 'run' : 'walk';

      rp._stepTimer = (rp._stepTimer ?? 0) - delta;
      if (rp._stepTimer <= 0) {
        rp._stepTimer = pose === 'run' ? 0.28 : 0.44;
        game._playWorldSound(game._randomFootstepKey(), rp.mesh.position, {
          volume: 0.82, maxDist: 24,
        });
      }
    }

    updateCharacterAnimation(rp.rig, delta, pose);
  }

  /** Wire remote-player callbacks on the multiplayer manager. */
  bindMultiplayer() {
    const game = this.game;
    game.mp.onPlayerUpdate = (uid, data) => this.onPlayerUpdate(uid, data);
    game.mp.onPlayerRemoved = uid => this.onPlayerRemoved(uid);
    game.mp.onHitReceived = evt => {
      let killerName = evt.killerName;
      if (!killerName && evt.botIndex != null) killerName = `Bot-${evt.botIndex + 1}`;
      if (!killerName) killerName = game.mp.players.get(evt.shooter)?.name ?? 'Player';
      game.takeDamage(evt.damage, killerName);
    };
  }
}
