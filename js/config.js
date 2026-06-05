// ═══════════════════════════════════════════════════════════
//  WARFRONT — Game constants & weapon definitions
// ═══════════════════════════════════════════════════════════

// ─── RENDER ──────────────────────────────────────────────────
/** Cap Retina DPR (1.5 ≈ sharp on MacBook, much cheaper than 2). */
export const MAX_PIXEL_RATIO = 1.5;

// ─── LODIBIDON (2v2 round mode) ──────────────────────────────
export const LODIBIDON_ROUND_TIME_S    = 120;
export const LODIBIDON_PREP_TIME_S     = 3;
export const LODIBIDON_CAPTURE_TIME_S  = 5;
export const LODIBIDON_CAPTURE_RADIUS  = 4.5;
export const LODIBIDON_ROUNDS_TO_WIN   = 6;
export const LODIBIDON_ROUND_PAUSE_S   = 4;
export const LODIBIDON_TEAM_SIZE       = 2;

// ─── MAP ─────────────────────────────────────────────────────
export const MAP_W       = 44;   // grid cells wide
export const MAP_H       = 44;   // grid cells tall
export const CELL_SIZE   = 2.2;  // world units per cell
export const WALL_HEIGHT = 3.2;  // wall height in world units

// ─── PLAYER ──────────────────────────────────────────────────
export const PLAYER_HEIGHT = 1.72; // camera eye height
export const PLAYER_RADIUS = 0.42; // collision cylinder radius
export const PLAYER_SPEED  = 7.5;  // world units / second
export const SPRINT_MULT   = 1.65;
export const GRAVITY       = 20;
export const JUMP_FORCE    = 5.0;

// ─── COMBAT ──────────────────────────────────────────────────
export const REGEN_DELAY   = 5500;  // ms without damage before regen starts
export const REGEN_RATE    = 14;    // HP per second while regenerating
export const RESPAWN_TIME  = 5;     // seconds
/** Player / bot max HP — bodyDamage × 4 or headDamage × 2 (AR & shotgun). */
export const MAX_HEALTH = 100;

/** World distance (XZ) to use an ammo chest. */
export const AMMO_CHEST_RADIUS = 2.75;
/** Cooldown after resupplying at a chest (ms). */
export const AMMO_CHEST_COOLDOWN_MS = 59000;

/** Grid cell sync for multiplayer (not fog-of-war). */
export const MAP_SCAN_RADIUS    = 2;
/** Minimap: half-width of visible world area (metres). Larger = less zoom. */
export const MINIMAP_VIEW_RADIUS = 28;
/** Radar: 360° lap (seconds), repeats every cycle. */
export const MINIMAP_SWEEP_LAP_S       = 1;
export const MINIMAP_SWEEP_CYCLE_S     = 3;
/** Sweep start bearing: π/2 = 6 o'clock, progresses clockwise. */
export const MINIMAP_SWEEP_START_RAD   = Math.PI / 2;
/** Angular width of the sweep beam (radians). */
export const MINIMAP_SWEEP_BEAM_RAD = 0.3;
/** How long revealed enemy blips stay visible (ms). */
export const MINIMAP_REVEAL_FADE_MS   = 3500;
/** Spawn / chest separation — occupancy counted within this range. */
export const SPAWN_OCCUPANCY_RADIUS = 8;
/** Assists credited if you damaged target within this window (ms). */
export const ASSIST_WINDOW_MS   = 5000;

// ─── GRENADES ────────────────────────────────────────────────
export const GRENADE_MAX         = 2;
export const GRENADE_FUSE_S       = 4;    // seconds from unpin until boom
export const GRENADE_THROW_SPEED  = 16;
export const GRENADE_THROW_LIFT   = 5;
export const GRENADE_DAMAGE       = 110;
export const GRENADE_RADIUS       = 6.5;
export const GRENADE_GRAVITY      = 20;

// ─── WEAPONS ─────────────────────────────────────────────────
export const WEAPONS = {
  assault_rifle: {
    name:        'ASSAULT RIFLE',
    bodyDamage:  25,   // 4 body shots to kill @ 100 HP
    headDamage:  50,   // 2 head shots
    fireRate:    640,          // rounds per minute
    reloadTime:  2200,         // ms
    magSize:     30,
    reserve:     120,
    spread:      0.016,
    pellets:     1,
    automatic:   true,
    zoom:        1.2,
    recoilZ:     0.022,
    recoilRotX:  0.05,
    bodyColor:   0x1e1e22,   // dark charcoal polymer
    barrelColor: 0x111114,   // near-black metal
    stockColor:  0x1a1a1e,   // same polymer as body
  },
  shotgun: {
    name:        'SHOTGUN',
    bodyDamage:  MAX_HEALTH,        // all 8 pellets on body = kill (12.5 each)
    headDamage:  MAX_HEALTH * 2,    // 4+ head pellets = kill (25 each)
    fireRate:    68,
    reloadTime:  3400,
    magSize:     6,
    reserve:     30,
    spread:      0.13,
    pellets:     8,
    automatic:   false,
    zoom:        1.0,
    recoilZ:     0.038,
    recoilRotX:  0.07,
    bodyColor:   0x262624,   // dark gunmetal
    barrelColor: 0x111111,   // black steel
    stockColor:  0x3a2010,   // dark walnut wood
  },
  sniper: {
    name:        'SNIPER RIFLE',
    bodyDamage:  100,  // one shot kill
    headDamage:  100,
    fireRate:    48,
    reloadTime:  3000,
    magSize:     5,
    reserve:     25,
    spread:      0.003,
    pellets:     1,
    automatic:   false,
    zoom:        4.0,
    recoilZ:     0.045,
    recoilRotX:  0.09,
    bodyColor:   0x1c1e1a,   // dark military green-black chassis
    barrelColor: 0x0f0f12,   // very dark steel
    stockColor:  0x181c18,   // dark tactical stock
    scopeColor:  0x111114,   // scope black
  },
};

// ─── BOT CONFIG (AI implementation: js/bots/) ─────────────────
export const BOT_COUNT      = 3;
export const BOT_HEALTH     = MAX_HEALTH;
export const BOT_DAMAGE     = 14;      // HP per hit (all difficulties)
export const BOT_RESPAWN_MS = 14000;   // ms before bot respawns

/** Shared bot movement / combat (same for every difficulty). */
export const BOT_SPEED         = 4.5;   // march speed (world units / s)
export const BOT_CHASE_SPEED_MULT   = 1.38; // faster while pathing to target
export const BOT_ADVANCE_SPEED_MULT = 1.25; // faster while closing in combat
export const BOT_MISS_CLOSE_MULT    = 1.2;  // extra closing speed after missed shots
export const BOT_MISS_ADVANCE_THRESHOLD = 2; // consecutive misses before pushing in
export const BOT_ATTACK_RANGE  = 22;    // start shooting with LOS within this range
export const BOT_IDEAL_SHOOT_RANGE = 11; // bots advance closer while fighting above this
export const BOT_MIN_COMBAT_RANGE  = 2.0; // stop closing — don't hug targets
export const BOT_SHOOT_MIN     = 850;   // ms between shots (base)
export const BOT_SHOOT_JITTER  = 550;
/** Extra hit chance added to lodibidon bot accuracy. */
export const LODIBIDON_BOT_HIT_BONUS = 0.24;
/** Seconds between path replans (base). */
export const BOT_REPLAN_INTERVAL = 0.65;
/** Replan early when the player moves at least this far (world units²). */
export const BOT_REPLAN_MOVE_SQ  = 9;

/** Difficulty — only accuracy (`hitBase`) changes. */
export const BOT_LEVELS = {
  private:  { label: 'PRIVATE',  hitBase: 0.18 },
  corporal: { label: 'CORPORAL', hitBase: 0.35 },
  commando: { label: 'COMMANDO', hitBase: 0.55 },
  veteran:  { label: 'VETERAN',  hitBase: 0.72 },
};

// ─── MULTIPLAYER ─────────────────────────────────────────────
export const SYNC_INTERVAL    = 50;   // ms between position syncs
export const BOT_SYNC_INTERVAL = 80;  // ms — host bot snapshot rate (multi)
/** Remote player render smoothing (MP). */
export const REMOTE_INTERP_SPEED = 16;  // higher = snappier catch-up
export const REMOTE_EXTRAP_S     = 0.07; // short dead-reckoning ahead of last packet
export const REMOTE_SNAP_DIST    = 5;   // teleport if interpolation lag exceeds this
export const MAX_PLAYERS      = 4;

// ─── FIREBASE CONFIG ──────────────────────────────────────────
// Loaded from the gitignored js/firebase-config.js
// Copy js/firebase-config.example.js → js/firebase-config.js to set up.
export { FIREBASE_CONFIG } from './firebase-config.js';
