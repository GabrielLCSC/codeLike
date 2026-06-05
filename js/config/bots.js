import { MAX_HEALTH } from './combat.js';

export const BOT_COUNT      = 3;
export const BOT_HEALTH     = MAX_HEALTH;
export const BOT_DAMAGE     = 14;
export const BOT_RESPAWN_MS = 14000;

export const BOT_SPEED         = 4.5;
export const BOT_CHASE_SPEED_MULT   = 1.38;
export const BOT_ADVANCE_SPEED_MULT = 1.25;
export const BOT_MISS_CLOSE_MULT    = 1.2;
export const BOT_MISS_ADVANCE_THRESHOLD = 2;
export const BOT_ATTACK_RANGE  = 22;
export const BOT_IDEAL_SHOOT_RANGE = 11;
export const BOT_MIN_COMBAT_RANGE  = 2.0;
export const BOT_SHOOT_MIN     = 850;
export const BOT_SHOOT_JITTER  = 550;
export const LODIBIDON_BOT_HIT_BONUS = 0.24;
export const BOT_REPLAN_INTERVAL = 0.65;
export const BOT_REPLAN_MOVE_SQ  = 9;

export const BOT_LEVELS = {
  private:  { label: 'PRIVATE',  hitBase: 0.18 },
  corporal: { label: 'CORPORAL', hitBase: 0.35 },
  commando: { label: 'COMMANDO', hitBase: 0.55 },
  veteran:  { label: 'VETERAN',  hitBase: 0.72 },
};
