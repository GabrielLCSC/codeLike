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
export const GRAVITY       = 20;
export const JUMP_FORCE    = 5.0;

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
    recoilZ:     0.022,
    recoilRotX:  0.05,
    bodyColor:   0x1e1e22,   // dark charcoal polymer
    barrelColor: 0x111114,   // near-black metal
    stockColor:  0x1a1a1e,   // same polymer as body
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
    recoilZ:     0.038,
    recoilRotX:  0.07,
    bodyColor:   0x262624,   // dark gunmetal
    barrelColor: 0x111111,   // black steel
    stockColor:  0x3a2010,   // dark walnut wood
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
    recoilZ:     0.045,
    recoilRotX:  0.09,
    bodyColor:   0x1c1e1a,   // dark military green-black chassis
    barrelColor: 0x0f0f12,   // very dark steel
    stockColor:  0x181c18,   // dark tactical stock
    scopeColor:  0x111114,   // scope black
  },
};

// ─── BOT CONFIG ───────────────────────────────────────────────
export const BOT_COUNT      = 3;
export const BOT_HEALTH     = 100;
export const BOT_DAMAGE     = 14;      // HP per hit (all difficulties)
export const BOT_RESPAWN_MS = 14000;   // ms before bot respawns

/** Difficulty configs — passed directly to Bot constructor as `cfg`. */
export const BOT_LEVELS = {
  private: {
    label:       'PRIVATE',
    speed:        2.6,
    detectRange:  9,
    attackRange:  7,
    hitBase:      0.18,   // accuracy at close range (scales with distance)
    shootMin:     1900,   // ms between shots (base)
    shootJitter:  1200,
    seeksCover:   false,
    strafes:      false,
  },
  corporal: {
    label:       'CORPORAL',
    speed:        3.2,
    detectRange:  14,
    attackRange:  11,
    hitBase:      0.35,
    shootMin:     1100,
    shootJitter:  800,
    seeksCover:   false,
    strafes:      true,
  },
  commando: {
    label:       'COMMANDO',
    speed:        3.9,
    detectRange:  18,
    attackRange:  14,
    hitBase:      0.55,
    shootMin:     700,
    shootJitter:  500,
    seeksCover:   true,
    strafes:      true,
  },
  veteran: {
    label:       'VETERAN',
    speed:        4.6,
    detectRange:  22,
    attackRange:  17,
    hitBase:      0.72,
    shootMin:     450,
    shootJitter:  280,
    seeksCover:   true,
    strafes:      true,
  },
};

// ─── MULTIPLAYER ─────────────────────────────────────────────
export const SYNC_INTERVAL    = 50;   // ms between position syncs
export const MAX_PLAYERS      = 4;

// ─── FIREBASE CONFIG ──────────────────────────────────────────
// Loaded from the gitignored js/firebase-config.js
// Copy js/firebase-config.example.js → js/firebase-config.js to set up.
export { FIREBASE_CONFIG } from './firebase-config.js';
