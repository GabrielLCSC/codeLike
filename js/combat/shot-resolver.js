// ═══════════════════════════════════════════════════════════
//  WARFRONT — Raycast shot resolution (bots + remote players)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { sound } from '../sound.js';

/**
 * Resolves weapon raycasts against bots, remote players, and walls.
 * @param {import('../game.js').Game} game
 */
export class ShotResolver {
  constructor(game) {
    this.game = game;
    this._hitWorldPos = new THREE.Vector3();
  }

  /** Walk parent chain to find which character root was hit. */
  resolveCharacterHit(hitObject, entries) {
    let node = hitObject;
    while (node) {
      for (const entry of entries) {
        if (node === entry.mesh) return entry;
      }
      node = node.parent;
    }
    return null;
  }

  /** Headshot uses world-space Y (nested limb local Y is unreliable). */
  isHeadHit(hitObject) {
    if (hitObject.userData?.ignoreRaycast) return false;
    if (hitObject.material?.depthTest === false) return false;
    hitObject.getWorldPosition(this._hitWorldPos);
    return this._hitWorldPos.y > 1.52;
  }

  /** Damage for one ray/pellet (shotgun splits shell damage across pellets). */
  weaponShotDamage(isHead) {
    const game = this.game;
    const d = game.weapon.def;
    const body = d.bodyDamage ?? d.damage ?? 0;
    const head = d.headDamage ?? body * 2;
    let amount = isHead ? head : body;
    if (d.pellets > 1) amount /= d.pellets;
    return amount;
  }

  getBotShotTargets() {
    const game = this.game;
    if (game._isMpClient()) {
      return game.syncedBots
        .filter(b => b && b.alive)
        .filter(b => !game._isLodibidon() || b.team !== game.lodibidon.playerTeam)
        .map(b => ({ mesh: b.mesh, ref: { type: 'synced', index: b.index } }));
    }
    return game.bots
      .filter(b => b.alive)
      .filter(b => !game._isLodibidon() || b.team !== game.lodibidon.playerTeam)
      .map(b => ({ mesh: b.mesh, ref: b }));
  }

  /** Fire one pellet / ray and apply hits. */
  firePellet() {
    const game = this.game;
    const s = game.weapon.effectiveSpread;
    game.raycaster.setFromCamera(
      new THREE.Vector2((Math.random() - 0.5) * s * 2, (Math.random() - 0.5) * s * 2),
      game.camera,
    );

    const wallHits = game.raycaster.intersectObjects(game.map.staticMeshes, false);
    const wallDist = wallHits.length > 0 ? wallHits[0].distance : Infinity;

    const botEntries = this.getBotShotTargets();
    if (botEntries.length > 0) {
      const botHits = game.raycaster.intersectObjects(botEntries.map(e => e.mesh), true);
      for (const hit of botHits) {
        if (hit.distance >= wallDist) break;
        if (hit.object.userData?.ignoreRaycast) continue;
        if (hit.object.material?.depthTest === false) continue;
        const entry = this.resolveCharacterHit(hit.object, botEntries);
        if (!entry?.ref) continue;

        const isHead = this.isHeadHit(hit.object);
        const dmg    = this.weaponShotDamage(isHead);

        if (entry.ref.type === 'synced') {
          game._recordDamage(`bot:${entry.ref.index}`);
          game.mp?.sendBotHit(entry.ref.index, dmg);
          sound.playHitImpact(isHead);
          game.hud.showHitMarker(isHead);
          return;
        }

        const bot = entry.ref;
        if (!bot.alive) continue;
        game._recordDamage(`bot:${bot.index}`);
        const killed = bot.takeDamage(dmg);
        sound.playHitImpact(isHead);
        game.hud.showHitMarker(isHead);
        if (killed) game._onBotEliminated(bot, isHead);
        return;
      }
    }

    if (game.mode === 'multi' && game.remotePlayers.size > 0) {
      const rpEntries = [...game.remotePlayers.values()]
        .filter(rp => rp.mesh.visible)
        .filter(rp => !game._isLodibidon() || rp.data.team !== game.lodibidon.playerTeam)
        .map(rp => ({ mesh: rp.mesh, ref: rp }));
      const rHits = game.raycaster.intersectObjects(rpEntries.map(e => e.mesh), true);
      for (const hit of rHits) {
        if (hit.distance >= wallDist) break;
        if (hit.object.userData?.ignoreRaycast) continue;
        if (hit.object.material?.depthTest === false) continue;
        const entry = this.resolveCharacterHit(hit.object, rpEntries);
        if (!entry) continue;

        const rp     = entry.ref;
        const isHead = this.isHeadHit(hit.object);
        const dmg    = this.weaponShotDamage(isHead);

        for (const [uid, candidate] of game.remotePlayers) {
          if (candidate !== rp) continue;
          game._recordDamage(`player:${uid}`);
          game.mp.sendHit(uid, dmg);
          sound.playHitImpact(isHead);
          game.hud.showHitMarker(isHead);
          game._recentlyShot.set(uid, isHead);
          setTimeout(() => game._recentlyShot.delete(uid), 5000);
          break;
        }
        return;
      }
    }

    if (wallHits.length > 0) {
      const sh     = wallHits[0];
      const normal = sh.face.normal.clone().transformDirection(sh.object.matrixWorld);
      game.particles.spawnImpact(sh.point, normal);
      sound.play('bullet_wall', { volume: 0.5, pitch: 0.85 + Math.random() * 0.3 });
    }
  }
}
