// ═══════════════════════════════════════════════════════════
//  WARFRONT — Sound Manager
//  Drop files in sounds/ with the names listed below.
//  Missing files are silently skipped — no crashes.
// ═══════════════════════════════════════════════════════════

const SOUND_FILES = {
  // ── Weapons ──────────────────────────────────────────────
  ar_shoot:      'sounds/weapons/ar_shoot.mp3',
  sg_shoot:      'sounds/weapons/sg_shoot.mp3',
  sn_shoot:      'sounds/weapons/sn_shoot.mp3',
  reload:        'sounds/weapons/reload.mp3',
  empty_click:   'sounds/weapons/empty_click.mp3',

  // ── Player ───────────────────────────────────────────────
  hurt:          'sounds/player/hurt.mp3',
  die:           'sounds/player/die.mp3',
  // footstep variants — drop as many as you have (footstep.mp3 is required, rest optional)
  footstep:      'sounds/player/footstep.mp3',
  footstep2:     'sounds/player/footstep2.mp3',
  footstep3:     'sounds/player/footstep3.mp3',
  footstep4:     'sounds/player/footstep4.mp3',
  jump:          'sounds/player/jump.mp3',
  land:          'sounds/player/land.mp3',

  // ── World ────────────────────────────────────────────────
  bullet_wall:   'sounds/world/bullet_wall.mp3',
  bullet_flesh:  'sounds/world/bullet_flesh.mp3',
  headshot:      'sounds/world/headshot.mp3',

  // ── UI ───────────────────────────────────────────────────
  ui_hover:      'sounds/ui/ui_hover.mp3',
  ui_click:      'sounds/ui/ui_click.mp3',
  kill_confirm:  'sounds/ui/kill_confirm.mp3',
};

class SoundManager {
  constructor() {
    /** @type {Map<string, AudioBuffer>} */
    this._buffers = new Map();
    this._ctx     = null;
    this._master  = null;   // GainNode — master volume
    this._sfxGain = null;   // GainNode — SFX bus
    this._ready   = false;

    // Footstep rate-limiting + anti-repeat
    this._lastFootstep     = 0;
    this._footstepInterval = 0.38; // seconds between steps
    this._footstepKeys     = [];   // populated after load — all available variants
    this._lastFootstepIdx  = -1;   // index of last played variant

    // Positional audio: listener is the camera
    this._listener = null;
  }

  // ─── INIT (call once after first user gesture) ────────────
  async init() {
    if (this._ready) return;
    try {
      this._ctx     = new (window.AudioContext || window.webkitAudioContext)();
      this._master  = this._ctx.createGain();
      this._sfxGain = this._ctx.createGain();
      this._sfxGain.connect(this._master);
      this._master.connect(this._ctx.destination);
      this._master.gain.value  = 1.0;
      this._sfxGain.gain.value = 1.0;
      this._ready = true;
      await this._loadAll();
    } catch (e) {
      console.warn('[Sound] AudioContext unavailable:', e.message);
    }
  }

  // ─── PLAY ─────────────────────────────────────────────────
  /**
   * @param {string}  key        — key from SOUND_FILES
   * @param {object}  [opts]
   * @param {number}  [opts.volume=1]
   * @param {number}  [opts.pitch=1]    — playbackRate multiplier
   * @param {boolean} [opts.loop=false]
   * @returns {AudioBufferSourceNode|null}
   */
  play(key, { volume = 1, pitch = 1, loop = false } = {}) {
    if (!this._ready || !this._buffers.has(key)) return null;
    const src  = this._ctx.createBufferSource();
    const gain = this._ctx.createGain();
    src.buffer             = this._buffers.get(key);
    src.playbackRate.value = pitch + (Math.random() - 0.5) * 0.05; // tiny natural variation
    src.loop               = loop;
    gain.gain.value        = volume;
    src.connect(gain);
    gain.connect(this._sfxGain);
    src.start(0);
    return src;
  }

  /** Play a shoot sound for the given weapon key.
   *  For automatic weapons the previous instance is cut first (re-trigger),
   *  so you hear a crisp per-shot crack instead of muddy overlap. */
  playShoot(weaponKey, { isADS = false } = {}) {
    const map = {
      assault_rifle: 'ar_shoot',
      shotgun:       'sg_shoot',
      sniper:        'sn_shoot',
    };
    const sndKey = map[weaponKey] ?? 'ar_shoot';

    // Stop previous shot sound for this weapon (re-trigger)
    const prev = this._shootSources?.get(weaponKey);
    if (prev) { try { prev.stop(); } catch {} }

    const src = this.play(sndKey, {
      volume: isADS ? 0.45 : 0.62,
      pitch:  isADS ? 0.92 : 1.0,
    });
    if (!this._shootSources) this._shootSources = new Map();
    if (src) this._shootSources.set(weaponKey, src);
  }

  /** Footstep — auto rate-limited, no two identical steps in a row.
   *  @param {boolean} isSprinting — tightens the interval when running */
  playFootstep(nowSec, isSprinting = false) {
    const interval = isSprinting ? 0.23 : 0.38; // sprint ~1.65× faster
    if (nowSec - this._lastFootstep < interval) return;
    this._lastFootstep = nowSec;

    // Build variant list on first call (only includes loaded buffers)
    if (this._footstepKeys.length === 0) {
      const all = ['footstep', 'footstep2', 'footstep3', 'footstep4'];
      this._footstepKeys = all.filter(k => this._buffers.has(k));
    }
    if (this._footstepKeys.length === 0) return; // nothing loaded yet

    // Pick a random variant that isn't the same as last time
    let idx;
    if (this._footstepKeys.length === 1) {
      idx = 0;
    } else {
      do { idx = Math.floor(Math.random() * this._footstepKeys.length); }
      while (idx === this._lastFootstepIdx);
    }
    this._lastFootstepIdx = idx;

    this.play(this._footstepKeys[idx], { volume: 0.45, pitch: 0.9 + Math.random() * 0.2 });
  }

  /** Master volume 0–1 */
  setVolume(v) {
    if (this._master) this._master.gain.value = Math.max(0, Math.min(1, v));
  }

  // ─── PRIVATE ──────────────────────────────────────────────
  async _loadAll() {
    const entries = Object.entries(SOUND_FILES);
    await Promise.all(entries.map(([key, path]) => this._load(key, path)));
    const loaded = this._buffers.size;
    this._footstepKeys = []; // reset so playFootstep rebuilds from loaded buffers
    console.log(`[Sound] ${loaded}/${entries.length} sounds loaded.`);
  }

  async _load(key, path) {
    // Try the listed extension first, then the two common alternatives.
    // This way .mp3 entries work when you drop .wav files (and vice-versa).
    const base = path.replace(/\.[^.]+$/, '');
    const ext  = path.match(/\.([^.]+)$/)?.[1] ?? 'mp3';
    const alts = ['mp3', 'wav', 'ogg'].filter(e => e !== ext);
    const candidates = [path, ...alts.map(e => `${base}.${e}`)];

    for (const candidate of candidates) {
      try {
        const res = await fetch(candidate);
        if (!res.ok) continue;
        const decoded = await this._ctx.decodeAudioData(await res.arrayBuffer());
        this._buffers.set(key, decoded);
        return; // found it
      } catch {}
    }
    // All extensions tried and none found — silently skip
  }
}

// Export singleton
export const sound = new SoundManager();
