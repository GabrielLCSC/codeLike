// ═══════════════════════════════════════════════════════════
//  WARFRONT — Local player movement and physics
// ═══════════════════════════════════════════════════════════

import {
  PLAYER_HEIGHT, PLAYER_SPEED, SPRINT_MULT,
  GRAVITY, JUMP_FORCE,
} from '../config.js';
import { sound } from '../sound.js';

/**
 * Handles WASD movement, sprint, jump, and gravity for the local player.
 * @param {import('../game.js').Game} game
 */
export class MovementController {
  constructor(game) {
    this.game = game;
  }

  updateMovement(delta) {
    const game = this.game;
    if (!game.controls.isLocked) return;
    if (game.lodibidon && !game.lodibidon.canMove()) {
      game.isMoving = false;
      return;
    }

    const sprint = game.keys.has('ShiftLeft') || game.keys.has('ShiftRight');
    const spd    = PLAYER_SPEED
      * (sprint ? SPRINT_MULT : 1)
      * (game.weapon.isADS ? 0.55 : 1);

    const fwd = (game.keys.has('KeyW') ? 1 : 0) - (game.keys.has('KeyS') ? 1 : 0);
    const rgt = (game.keys.has('KeyD') ? 1 : 0) - (game.keys.has('KeyA') ? 1 : 0);

    const fwdVec = game._fwdVec;
    game.camera.getWorldDirection(fwdVec);
    fwdVec.y = 0; fwdVec.normalize();

    const rgtVec = game._rgtVec;
    rgtVec.setFromMatrixColumn(game.camera.matrix, 0);
    rgtVec.y = 0; rgtVec.normalize();

    if (game.onGround) {
      if (fwd !== 0 || rgt !== 0) {
        game._airVelX = fwdVec.x * fwd * spd + rgtVec.x * rgt * spd;
        game._airVelZ = fwdVec.z * fwd * spd + rgtVec.z * rgt * spd;
        game.isMoving = true;
        const stepT = performance.now() / 1000;
        sound.playFootstep(stepT, sprint);
        if (sprint && game.weapon.isTacticalSprint) {
          sound.playTacticalSprintStep(stepT);
        }
      } else {
        game._airVelX = 0;
        game._airVelZ = 0;
        game.isMoving = false;
      }
    } else {
      game.isMoving = Math.hypot(game._airVelX, game._airVelZ) > 0.5;
    }

    const cx = game.camera.position;
    if (!game.map.isWall(cx.x + game._airVelX * delta, cx.z)) cx.x += game._airVelX * delta;
    if (!game.map.isWall(cx.x, cx.z + game._airVelZ * delta)) cx.z += game._airVelZ * delta;

    if (game.keys.has('Space') && game.onGround) {
      if (game.lodibidon && !game.lodibidon.canJump()) return;
      game.velY = JUMP_FORCE;
      game.onGround = false;
      sound.play('jump', { volume: 0.18 });
    }
  }

  updatePhysics(delta) {
    const game = this.game;
    if (!game.onGround) game.velY -= GRAVITY * delta;

    const newY = game.camera.position.y + game.velY * delta;
    if (newY <= PLAYER_HEIGHT) {
      if (!game.onGround && game.velY < -3) {
        sound.play('land', { volume: 0.15 + Math.min(0.20, -game.velY / 15) });
      }
      game.camera.position.y = PLAYER_HEIGHT;
      game.velY = 0;
      game.onGround = true;
    } else {
      game.camera.position.y = newY;
      game.onGround = false;
    }
  }
}
