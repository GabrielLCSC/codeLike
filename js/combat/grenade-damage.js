// ═══════════════════════════════════════════════════════════
//  WARFRONT — Grenade splash damage (authoritative + local)
// ═══════════════════════════════════════════════════════════

import { GRENADE_DAMAGE, GRENADE_RADIUS } from '../config.js';

/**
 * Apply grenade splash to local player, bots, and remote players.
 * @param {import('../game.js').Game} game
 * @param {THREE.Vector3} center
 * @param {string} sourceName
 * @param {boolean} authoritative
 */
export function applyGrenadeDamage(game, center, sourceName, authoritative) {
  const map = game.map;
  const applyToSelf = () => {
    const px = game.camera.position.x;
    const py = game.camera.position.y;
    const pz = game.camera.position.z;
    const dist = Math.hypot(px - center.x, py - center.y, pz - center.z);
    if (dist >= GRENADE_RADIUS) return;
    if (!map.hasLOS(center.x, center.z, px, pz)) return;
    const t = 1 - dist / GRENADE_RADIUS;
    const dmg = GRENADE_DAMAGE * t * t;
    if (dmg > 0) game.takeDamage(dmg, sourceName);
  };

  if (authoritative) {
    applyToSelf();
    if (game._isMpHost() || !game._isMultiplayer()) {
      for (const bot of game.bots) {
        if (!bot.alive) continue;
        const bx = bot.mesh.position.x;
        const bz = bot.mesh.position.z;
        const dist = Math.hypot(bx - center.x, 1 - center.y, bz - center.z);
        if (dist >= GRENADE_RADIUS || !map.hasLOS(center.x, center.z, bx, bz)) continue;
        const t = 1 - dist / GRENADE_RADIUS;
        const dmg = GRENADE_DAMAGE * t * t;
        if (dmg > 0) {
          const killed = bot.takeDamage(dmg);
          if (killed) {
            const killer = sourceName === game.username ? 'player' : null;
            game._onBotEliminated(bot, false, killer);
          }
        }
      }
    }
    if (game._isMultiplayer()) {
      for (const [uid, rp] of game.remotePlayers) {
        if (!rp.mesh.visible) continue;
        const rx = rp.mesh.position.x;
        const rz = rp.mesh.position.z;
        const dist = Math.hypot(rx - center.x, rp.mesh.position.y - center.y, rz - center.z);
        if (dist >= GRENADE_RADIUS || !map.hasLOS(center.x, center.z, rx, rz)) continue;
        const t = 1 - dist / GRENADE_RADIUS;
        const dmg = Math.round(GRENADE_DAMAGE * t * t);
        if (dmg > 0) game.mp.sendHit(uid, dmg);
      }
    }
  } else {
    applyToSelf();
  }
}
