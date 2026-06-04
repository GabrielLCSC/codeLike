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
  reload_ar:     'sounds/weapons/reload_ar.mp3',
  reload_sg:     'sounds/weapons/reload_sg.mp3',
  reload_sn:     'sounds/weapons/reload_sn.mp3',
  empty_click:   'sounds/weapons/empty_click.mp3',
  tactical_sprint: 'sounds/weapons/tactical_sprint.mp3',

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

  // ── Kill voice lines — drop in sounds/voice/ (kill_1 … kill_6) ─
  kill_voice_1:  'sounds/voice/kill_1.mp3',
  kill_voice_2:  'sounds/voice/kill_2.mp3',
  kill_voice_3:  'sounds/voice/kill_3.mp3',
  kill_voice_4:  'sounds/voice/kill_4.mp3',
  kill_voice_5:  'sounds/voice/kill_5.mp3',
  kill_voice_6:  'sounds/voice/kill_6.mp3',

  // ── Medal achievements — drop files in sounds/medals/ ────
  medal_3:       'sounds/medals/medal_3.mp3',
  medal_5:       'sounds/medals/medal_5.mp3',
  medal_10:      'sounds/medals/medal_10.mp3',

  // ── Ambiance — drop files in sounds/ambiance/ ────────────
  // Main city bed (required for in-game ambiance)
  ambiance_city: 'sounds/ambiance/ambiance_city.mp3',
  // Optional extra layers — skipped silently if missing
  ambiance_wind: 'sounds/ambiance/ambiance_wind.mp3',
  ambiance_distant: 'sounds/ambiance/ambiance_distant.mp3',
};

/** Looping ambiance layers played together during a match. */
const AMBIANCE_PROFILES = {
  city: [
    { key: 'ambiance_city',     volume: 0.20 },
    { key: 'ambiance_wind',     volume: 0.08 },
    { key: 'ambiance_distant',  volume: 0.12 },
  ],
};

class SoundManager {
  constructor() {
    /** @type {Map<string, AudioBuffer>} */
    this._buffers = new Map();
    this._ctx     = null;
    this._master  = null;   // GainNode — master volume
    this._sfxGain = null;   // GainNode — SFX bus
    this._ambGain = null;   // GainNode — ambiance bus (loops)
    this._ready   = false;

    /** @type {{ src: AudioBufferSourceNode, gain: GainNode }[]} */
    this._ambLayers = [];
    this._ambVolume = 0.45; // user-facing ambiance bus level

    // Footstep rate-limiting + anti-repeat
    this._lastFootstep     = 0;
    this._footstepInterval = 0.38; // seconds between steps
    this._footstepKeys     = [];   // populated after load — all available variants
    this._lastFootstepIdx  = -1;   // index of last played variant

    this._loopSources = new Map();
    this._killVoiceIdx = 0;
    this._killVoiceKeys = [];
  }

  // ─── INIT (call once after first user gesture) ────────────
  async init() {
    if (this._ready) return;
    try {
      this._ctx     = new (window.AudioContext || window.webkitAudioContext)();
      this._master  = this._ctx.createGain();
      this._sfxGain = this._ctx.createGain();
      this._ambGain = this._ctx.createGain();
      this._sfxGain.connect(this._master);
      this._ambGain.connect(this._master);
      this._master.connect(this._ctx.destination);
      this._master.gain.value  = 1.0;
      this._sfxGain.gain.value = 1.0;
      this._ambGain.gain.value = this._ambVolume;
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

    this.play(this._footstepKeys[idx], { volume: 0.20, pitch: 0.9 + Math.random() * 0.2 });
  }

  /**
   * Play a sound with approximate 3D spatialization.
   * Volume falls off quadratically with distance; stereo pan is derived
   * from the camera's right vector so sounds come from correct L/R.
   *
   * @param {string}  key        — key from SOUND_FILES
   * @param {{ x:number, y:number, z:number }} srcPos  — world-space source
   * @param {{ position:{x,y,z}, quaternion:{x,y,z,w} }} camera — Three.js camera
   * @param {object}  [opts]
   * @param {number}  [opts.volume=1]
   * @param {number}  [opts.pitch=1]
   * @param {number}  [opts.maxDist=20]  — distance at which volume reaches 0
   */
  playAt(key, srcPos, camera, { volume = 1, pitch = 1, maxDist = 20 } = {}) {
    if (!this._ready || !this._buffers.has(key)) return;

    const dx = srcPos.x - camera.position.x;
    const dy = srcPos.y - camera.position.y;
    const dz = srcPos.z - camera.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist >= maxDist) return;

    // Quadratic attenuation
    const atten = 1 - dist / maxDist;
    const vol   = volume * atten * atten;
    if (vol < 0.01) return;

    // Stereo pan: project source direction onto camera's right axis.
    // Camera right = rotate world-right (1,0,0) by camera quaternion.
    const q  = camera.quaternion;
    const rx = 1 - 2 * (q.y * q.y + q.z * q.z);
    const rz = 2 * (q.x * q.z - q.y * q.w);
    const horiz = Math.max(dist, 0.1);
    const pan = Math.max(-1, Math.min(1, (rx * dx + rz * dz) / horiz));

    this._playWithPan(key, vol, pitch + (Math.random() - 0.5) * 0.04, pan);
  }

  /** Master volume 0–1 */
  setVolume(v) {
    if (this._master) this._master.gain.value = Math.max(0, Math.min(1, v));
  }

  /**
   * Start looping ambiance for a match (instant on/off).
   * @param {string} [profile='city'] — key from AMBIANCE_PROFILES
   */
  async startAmbiance(profile = 'city') {
    if (!this._ready) await this.init();
    if (!this._ready || this._ambLayers.length > 0) return;

    if (this._ctx.state === 'suspended') {
      try { await this._ctx.resume(); } catch {}
    }

    const layers = AMBIANCE_PROFILES[profile] ?? AMBIANCE_PROFILES.city;

    for (const layer of layers) {
      if (!this._buffers.has(layer.key)) continue;

      const src  = this._ctx.createBufferSource();
      const gain = this._ctx.createGain();
      src.buffer = this._buffers.get(layer.key);
      src.loop   = true;
      gain.gain.value = layer.volume;

      src.connect(gain);
      gain.connect(this._ambGain);
      src.start(0);

      this._ambLayers.push({ src, gain });
    }

    if (this._ambLayers.length > 0) {
      console.log(`[Sound] Ambiance started (${profile}, ${this._ambLayers.length} layer(s)).`);
    }
  }

  /** Stop all ambiance loops immediately. */
  stopAmbiance() {
    if (!this._ready || this._ambLayers.length === 0) return;

    for (const { src } of this._ambLayers) {
      try { src.stop(); } catch {}
    }
    this._ambLayers = [];
  }

  /** Ambiance bus volume 0–1 (does not affect SFX). */
  setAmbianceVolume(v) {
    this._ambVolume = Math.max(0, Math.min(1, v));
    if (this._ambGain) this._ambGain.gain.value = this._ambVolume;
  }

  // ─── INTERNAL: play with explicit pan ─────────────────────
  _playWithPan(key, volume, pitch, pan) {
    if (!this._ready || !this._buffers.has(key)) return;
    const src      = this._ctx.createBufferSource();
    const gainNode = this._ctx.createGain();
    const panNode  = this._ctx.createStereoPanner
      ? this._ctx.createStereoPanner()
      : null;

    src.buffer             = this._buffers.get(key);
    src.playbackRate.value = pitch;
    gainNode.gain.value    = volume;

    src.connect(gainNode);
    if (panNode) {
      panNode.pan.value = pan;
      gainNode.connect(panNode);
      panNode.connect(this._sfxGain);
    } else {
      gainNode.connect(this._sfxGain);
    }
    src.start(0);
  }

  // ─── PRIVATE ──────────────────────────────────────────────
  async _loadAll() {
    const entries = Object.entries(SOUND_FILES);
    await Promise.all(entries.map(([key, path]) => this._load(key, path)));
    const loaded = this._buffers.size;
    this._footstepKeys = []; // reset so playFootstep rebuilds from loaded buffers
    this._killVoiceKeys = [
      'kill_voice_1', 'kill_voice_2', 'kill_voice_3',
      'kill_voice_4', 'kill_voice_5', 'kill_voice_6',
    ].filter(k => this._buffers.has(k));
    console.log(`[Sound] ${loaded}/${entries.length} sounds loaded.`);
  }

  /** Per-weapon reload SFX (falls back to generic reload). */
  playReload(weaponKey, { volume = 0.8 } = {}) {
    const map = {
      assault_rifle: 'reload_ar',
      shotgun:       'reload_sg',
      sniper:        'reload_sn',
    };
    const key = map[weaponKey] ?? 'reload';
    if (!this._buffers.has(key)) this.play('reload', { volume });
    else this.play(key, { volume });
  }

  /**
   * Occasional kill voice line — not every kill; rotates through loaded clips.
   * @param {number} [chance=0.38] — 0–1 probability per kill
   */
  playKillVoice(chance = 0.38, delayMs = 0) {
    if (this._killVoiceKeys.length === 0 || Math.random() > chance) return;
    const playLine = () => {
      const key = this._killVoiceKeys[this._killVoiceIdx % this._killVoiceKeys.length];
      this._killVoiceIdx++;
      this.play(key, { volume: 0.85, pitch: 0.95 + Math.random() * 0.1 });
    };
    if (delayMs > 0) setTimeout(playLine, delayMs);
    else playLine();
  }

  /** Low loop while weapon is in tactical sprint pose (viewmodel only). */
  startTacticalSprintLoop() {
    if (this._loopSources.has('tactical_sprint')) return;
    const src = this.play('tactical_sprint', { volume: 0.22, loop: true });
    if (src) this._loopSources.set('tactical_sprint', src);
  }

  stopTacticalSprintLoop() {
    const src = this._loopSources.get('tactical_sprint');
    if (src) { try { src.stop(); } catch {} }
    this._loopSources.delete('tactical_sprint');
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
