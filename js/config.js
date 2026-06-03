// ═══════════════════════════════════════════════════════════
//  WARFRONT — Game constants & weapon definitions
// ═══════════════════════════════════════════════════════════

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
export const GRAVITY       = 16;
export const JUMP_FORCE    = 6.2;

// ─── COMBAT ──────────────────────────────────────────────────
export const REGEN_DELAY   = 5500;  // ms without damage before regen starts
export const REGEN_RATE    = 14;    // HP per second while regenerating
export const RESPAWN_TIME  = 5;     // seconds
export const HEADSHOT_MULT = 2.5;   // damage multiplier for headshots

// ─── WEAPONS ─────────────────────────────────────────────────
export const WEAPONS = {
  assault_rifle: {
    name:        'ASSAULT RIFLE',
    damage:      22,
    fireRate:    640,          // rounds per minute
    reloadTime:  2200,         // ms
    magSize:     30,
    reserve:     120,
    spread:      0.016,
    pellets:     1,
    automatic:   true,
    zoom:        1.2,
    recoilZ:     0.028,
    recoilRotX:  0.055,
    barrelColor: 0x1a1a1a,
    bodyColor:   0x252525,
  },
  shotgun: {
    name:        'SHOTGUN',
    damage:      18,           // per pellet (8 pellets = 144 max)
    fireRate:    68,
    reloadTime:  3400,
    magSize:     6,
    reserve:     30,
    spread:      0.13,
    pellets:     8,
    automatic:   false,
    zoom:        1.0,
    recoilZ:     0.08,
    recoilRotX:  0.14,
    barrelColor: 0x2a1800,
    bodyColor:   0x3a2800,
  },
  sniper: {
    name:        'SNIPER RIFLE',
    damage:      145,
    fireRate:    48,
    reloadTime:  3000,
    magSize:     5,
    reserve:     25,
    spread:      0.003,
    pellets:     1,
    automatic:   false,
    zoom:        4.0,
    recoilZ:     0.10,
    recoilRotX:  0.18,
    barrelColor: 0x111111,
    bodyColor:   0x1c2418,
  },
};

// ─── BOT CONFIG ───────────────────────────────────────────────
export const BOT_COUNT        = 3;
export const BOT_HEALTH       = 100;
export const BOT_SPEED        = 3.4;
export const BOT_DETECT_RANGE = 14;   // world units
export const BOT_ATTACK_RANGE = 11;   // world units
export const BOT_DAMAGE       = 14;   // HP per hit
export const BOT_SHOOT_MIN    = 1100; // ms between shots (min)
export const BOT_SHOOT_JITTER = 800;  // extra random ms
export const BOT_RESPAWN_MS   = 14000;// ms before bot respawns

// ─── MULTIPLAYER ─────────────────────────────────────────────
export const SYNC_INTERVAL    = 50;   // ms between position syncs
export const MAX_PLAYERS      = 4;

// ─── FIREBASE CONFIG ──────────────────────────────────────────
// Loaded from the gitignored js/firebase-config.js
// Copy js/firebase-config.example.js → js/firebase-config.js to set up.
export { FIREBASE_CONFIG } from './firebase-config.js';
