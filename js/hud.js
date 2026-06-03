// ═══════════════════════════════════════════════════════════
//  WARFRONT — HUD manager
//  Pure DOM layer — zero Three.js dependency.
//  Instantiate once per game session; call show()/hide() on
//  start/stop.  All methods are idempotent and safe to call
//  from any game state.
// ═══════════════════════════════════════════════════════════

import { CELL_SIZE }  from './config.js';
import { sound }      from './sound.js';

// Streaks that unlock a medal PNG + sound.
const MEDAL_MAP = { 3: 'medal_3', 5: 'medal_5', 10: 'medal_10' };
const MEDAL_VISIBLE_MS = 3200;

/** @param {string} id @returns {HTMLElement} */
const $ = id => document.getElementById(id);

export class HUD {
  /**
   * @param {string} username   — local player name (for kill-feed colour)
   * @param {string} [roomCode] — displayed next to score in multiplayer
   */
  constructor(username, roomCode = '') {
    this._username   = username;
    this._medalTimer = null;
    this._hmTimeout  = null;

    if (roomCode) $('hud-room-tag').textContent = `· ${roomCode}`;

    // Minimap canvas (sized once at construction)
    this._mm    = $('minimap');
    this._mmCtx = this._mm.getContext('2d');
    this._mm.width  = 150;
    this._mm.height = 150;
  }

  // ── Lifecycle ──────────────────────────────────────────────
  show() { $('hud').classList.remove('hidden'); }
  hide() { $('hud').classList.add('hidden'); }

  // ── Health ─────────────────────────────────────────────────
  setHealth(hp) {
    const pct = Math.max(0, hp) / 100;
    const bar = $('health-bar');
    bar.style.width           = `${pct * 100}%`;
    bar.style.backgroundColor = `hsl(${Math.floor(pct * 120)}, 85%, 48%)`;
    $('hud-health-val').textContent = Math.ceil(hp);
  }

  // ── Ammo ───────────────────────────────────────────────────
  /** @param {number} mag @param {number} reserve @param {string} [name] */
  setAmmo(mag, reserve, name) {
    $('hud-ammo-mag').textContent     = mag;
    $('hud-ammo-reserve').textContent = reserve;
    if (name !== undefined) $('hud-weapon-name').textContent = name;
  }

  // ── Score ──────────────────────────────────────────────────
  setScore(kills, deaths) {
    $('hud-kills').textContent  = `K ${kills}`;
    $('hud-deaths').textContent = `D ${deaths}`;
  }

  // ── Kill feed ──────────────────────────────────────────────
  addKillFeed(killer, victim) {
    const feed  = $('kill-feed');
    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    const isMe  = victim === this._username;
    entry.innerHTML =
      `<span class="kf-killer">${killer}</span>` +
      `<span class="kf-icon">✦</span>` +
      `<span class="kf-victim${isMe ? ' is-me' : ''}">${victim}</span>`;
    feed.prepend(entry);
    setTimeout(() => entry.remove(), 5000);
  }

  // ── Hit marker ─────────────────────────────────────────────
  showHitMarker(isHead = false) {
    const el = $('hit-marker');
    el.className = isHead ? 'headshot' : 'hit';
    el.classList.remove('hidden');
    clearTimeout(this._hmTimeout);
    this._hmTimeout = setTimeout(() => el.classList.add('hidden'), 220);
  }

  // ── Score popup ────────────────────────────────────────────
  showScorePopup(text, isKill = false) {
    const el = document.createElement('div');
    el.className   = 'score-popup' + (isKill ? ' score-popup--kill' : '');
    el.textContent = text;
    $('hud').appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  // ── Medal ──────────────────────────────────────────────────
  showMedal(streak) {
    const key = MEDAL_MAP[streak];
    if (!key) return;
    clearTimeout(this._medalTimer);
    this._medalTimer = setTimeout(() => {
      const img = $('medal-display');
      if (!img) return;
      img.src = `images/medals/${key}.png`;
      img.classList.remove('hidden');
      // Restart CSS animation
      img.style.animation = 'none';
      void img.offsetHeight;
      img.style.animation = '';
      sound.play(key, { volume: 1.0 });
      setTimeout(() => img.classList.add('hidden'), MEDAL_VISIBLE_MS);
    }, 500);
  }

  // ── Reload bar ─────────────────────────────────────────────
  showReloadBar(durationMs) {
    $('reload-bar').classList.remove('hidden');
    const fill = $('reload-fill-bar');
    fill.style.transition = 'none';
    fill.style.width = '0%';
    void fill.offsetHeight;
    fill.style.transition = `width ${durationMs}ms linear`;
    fill.style.width = '100%';
  }

  hideReloadBar() { $('reload-bar').classList.add('hidden'); }

  // ── Damage vignette ────────────────────────────────────────
  showDamageVignette() {
    const el = $('damage-vignette');
    el.classList.remove('flash');
    void el.offsetHeight;
    el.classList.add('flash');
  }

  hideDamageVignette() { $('damage-vignette').classList.remove('flash'); }

  // ── Scope / crosshair ──────────────────────────────────────
  /** @param {boolean} visible — true = show scope, false = show crosshair */
  setScope(visible) {
    $('scope-overlay').classList.toggle('hidden', !visible);
    $('crosshair').classList.toggle('hidden', visible);
  }

  /** Shrinks the crosshair while ADS is active (non-scope weapons). */
  setAiming(on) {
    $('crosshair').classList.toggle('aiming', on);
  }

  // ── Death screen ───────────────────────────────────────────
  showDeathScreen(killerName) {
    $('pointer-lock-overlay').classList.add('hidden');
    $('lbl-killer').textContent = killerName;
    $('death-screen').classList.remove('hidden');
  }

  setRespawnCountdown(n) { $('lbl-respawn-count').textContent = n; }

  hideDeathScreen() { $('death-screen').classList.add('hidden'); }

  // ── Minimap ────────────────────────────────────────────────
  /**
   * Renders the minimap.  All Three.js data must be converted to plain
   * objects before calling so this module stays dependency-free.
   *
   * @param {{ grid: number[][], width: number, height: number }} mapData
   * @param {{ x: number, z: number, dirX: number, dirZ: number }} player
   * @param {{ x: number, z: number, alive: boolean }[]} bots
   * @param {{ x: number, z: number, alive: boolean }[]} remotePlayers
   */
  updateMinimap(mapData, player, bots, remotePlayers) {
    const ctx = this._mmCtx;
    const W   = this._mm.width;
    const H   = this._mm.height;
    const sx  = W / (mapData.width  * CELL_SIZE);
    const sz  = H / (mapData.height * CELL_SIZE);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, W, H);

    // Walkable floor cells
    ctx.fillStyle = '#2a3545';
    for (let gx = 0; gx < mapData.width; gx++) {
      for (let gz = 0; gz < mapData.height; gz++) {
        if (mapData.grid[gx][gz] === 1) {
          ctx.fillRect(
            gx * CELL_SIZE * sx, gz * CELL_SIZE * sz,
            CELL_SIZE * sx + 0.5, CELL_SIZE * sz + 0.5,
          );
        }
      }
    }

    // Bots (red)
    ctx.fillStyle = '#ff3333';
    bots.forEach(b => {
      if (!b.alive) return;
      ctx.beginPath();
      ctx.arc(b.x * sx, b.z * sz, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Remote players (blue)
    ctx.fillStyle = '#4488ff';
    remotePlayers.forEach(r => {
      if (!r.alive) return;
      ctx.beginPath();
      ctx.arc(r.x * sx, r.z * sz, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Local player (green dot + direction arrow)
    const px = player.x * sx;
    const pz = player.z * sz;
    ctx.fillStyle = '#00ff88';
    ctx.beginPath();
    ctx.arc(px, pz, 3.5, 0, Math.PI * 2);
    ctx.fill();

    const len = Math.hypot(player.dirX, player.dirZ);
    if (len > 0.01) {
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, pz);
      ctx.lineTo(px + (player.dirX / len) * 9, pz + (player.dirZ / len) * 9);
      ctx.stroke();
    }
  }
}
