// ═══════════════════════════════════════════════════════════
//  WARFRONT — HUD manager
//  Pure DOM layer — zero Three.js dependency.
// ═══════════════════════════════════════════════════════════

import {
  CELL_SIZE,
  MAX_HEALTH,
  GRENADE_FUSE_S,
  MINIMAP_VIEW_RADIUS,
  MINIMAP_PING_FADE_MS,
} from './config.js';
import { sound }      from './sound.js';

const MEDAL_MAP = { 3: 'medal_3', 5: 'medal_5', 10: 'medal_10' };
const MEDAL_VISIBLE_MS = 3200;

/** @param {string} id @returns {HTMLElement} */
const $ = id => document.getElementById(id);

export class HUD {
  constructor(username, roomCode = '') {
    this._username   = username;
    this._medalTimer = null;
    this._hmTimeout  = null;
    /** @type {{ x:number, z:number, color:string, t:number }[]} */
    this._minimapPings = [];

    if (roomCode) $('hud-room-tag').textContent = `· ${roomCode}`;

    this._mm    = $('minimap');
    this._mmCtx = this._mm.getContext('2d');
    this._mm.width  = 150;
    this._mm.height = 150;
  }

  show() { $('hud').classList.remove('hidden'); }
  hide() { $('hud').classList.add('hidden'); }

  setHealth(hp) {
    const pct = Math.max(0, hp) / MAX_HEALTH;
    const bar = $('health-bar');
    bar.style.width           = `${pct * 100}%`;
    bar.style.backgroundColor = `hsl(${Math.floor(pct * 120)}, 85%, 48%)`;
  }

  setGrenades(count) {
    const el = $('hud-grenades');
    if (el) el.textContent = `G ${count}`;
  }

  showGrenadePrime(primed, fuseLeft, showHud) {
    const el = $('hud-grenade-hint');
    if (!el) return;
    if (!primed || !showHud) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const fill = $('hud-grenade-fuse-fill');
    const lbl  = $('hud-grenade-fuse-lbl');
    const pct  = Math.max(0, Math.min(1, fuseLeft / GRENADE_FUSE_S));
    if (fill) fill.style.width = `${pct * 100}%`;
    if (lbl) lbl.textContent = fuseLeft > 0.05 ? fuseLeft.toFixed(1) : '0.0';
  }

  showAmmoChestHint(show, ready = true, cooldownSec = 0) {
    const el = $('hud-ammo-hint');
    if (!el) return;
    if (!show) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    if (ready) {
      el.innerHTML = '<span class="ammo-hint-key">F</span> Resupply ammo';
    } else {
      el.textContent = `Ammo chest — ${cooldownSec}s`;
    }
  }

  setAmmo(mag, reserve, name) {
    $('hud-ammo-mag').textContent     = mag;
    $('hud-ammo-reserve').textContent = reserve;
    if (name !== undefined) $('hud-weapon-name').textContent = name;
  }

  setScore(kills, deaths) {
    $('hud-kills').textContent  = `K ${kills}`;
    $('hud-deaths').textContent = `D ${deaths}`;
  }

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

  showHitMarker(isHead = false) {
    const el = $('hit-marker');
    el.className = isHead ? 'headshot' : 'hit';
    el.classList.remove('hidden');
    clearTimeout(this._hmTimeout);
    this._hmTimeout = setTimeout(() => el.classList.add('hidden'), 220);
  }

  showKillScore(isHeadshot) {
    const el = document.createElement('div');
    el.className   = 'score-popup' + (isHeadshot ? ' score-popup--head-kill' : '');
    el.textContent = isHeadshot ? '+150' : '+100';
    $('hud').appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  showMedal(streak) {
    const key = MEDAL_MAP[streak];
    if (!key) return;
    clearTimeout(this._medalTimer);
    this._medalTimer = setTimeout(() => {
      const img = $('medal-display');
      if (!img) return;
      img.src = `images/medals/${key}.png`;
      img.classList.remove('hidden');
      img.style.animation = 'none';
      void img.offsetHeight;
      img.style.animation = '';
      sound.play(key, { volume: 1.0 });
      setTimeout(() => img.classList.add('hidden'), MEDAL_VISIBLE_MS);
    }, 500);
  }

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

  showDamageVignette() {
    const el = $('damage-vignette');
    el.classList.remove('flash');
    void el.offsetHeight;
    el.classList.add('flash');
  }

  hideDamageVignette() { $('damage-vignette').classList.remove('flash'); }

  setScope(visible) {
    $('scope-overlay').classList.toggle('hidden', !visible);
    $('crosshair').classList.toggle('hidden', visible);
  }

  setAiming(on) {
    $('crosshair').classList.toggle('aiming', on);
  }

  showDeathScreen(killerName) {
    $('pointer-lock-overlay').classList.add('hidden');
    $('lbl-killer').textContent = killerName;
    $('death-screen').classList.remove('hidden');
  }

  setRespawnCountdown(n) { $('lbl-respawn-count').textContent = n; }

  hideDeathScreen() { $('death-screen').classList.add('hidden'); }

  /** Record a minimap blip (bots / remote players). */
  pushMinimapPing(x, z, color) {
    this._minimapPings.push({ x, z, color, t: performance.now() });
  }

  /**
   * Zoomed, player-centred, heading-up minimap with fading pings.
   * @param {{ grid: number[][], width: number, height: number }} mapData
   * @param {{ x: number, z: number, dirX: number, dirZ: number }} player
   * @param {number} nowMs
   */
  updateMinimap(mapData, player, nowMs) {
    const ctx = this._mmCtx;
    const W   = this._mm.width;
    const H   = this._mm.height;
    const R   = MINIMAP_VIEW_RADIUS;
    const CS  = CELL_SIZE;
    const px  = player.x;
    const pz  = player.z;
    const scale = Math.min(W, H) / (R * 2);

    this._minimapPings = this._minimapPings.filter(
      p => nowMs - p.t < MINIMAP_PING_FADE_MS,
    );

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, W, H);

    const yaw = Math.atan2(player.dirX, player.dirZ);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-yaw);
    ctx.scale(scale, scale);
    ctx.translate(-px, -pz);

    const gxMin = Math.max(0, Math.floor((px - R) / CS));
    const gxMax = Math.min(mapData.width - 1, Math.floor((px + R) / CS));
    const gzMin = Math.max(0, Math.floor((pz - R) / CS));
    const gzMax = Math.min(mapData.height - 1, Math.floor((pz + R) / CS));

    for (let gx = gxMin; gx <= gxMax; gx++) {
      for (let gz = gzMin; gz <= gzMax; gz++) {
        if (mapData.grid[gx][gz] !== 1) continue;
        const wx = gx * CS;
        const wz = gz * CS;
        ctx.fillStyle = '#2a3545';
        ctx.fillRect(wx, wz, CS + 0.5, CS + 0.5);
      }
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.04;
    for (let gx = gxMin; gx <= gxMax; gx++) {
      const x = gx * CS;
      ctx.beginPath();
      ctx.moveTo(x, gzMin * CS);
      ctx.lineTo(x, (gzMax + 1) * CS);
      ctx.stroke();
    }
    for (let gz = gzMin; gz <= gzMax; gz++) {
      const z = gz * CS;
      ctx.beginPath();
      ctx.moveTo(gxMin * CS, z);
      ctx.lineTo((gxMax + 1) * CS, z);
      ctx.stroke();
    }

    for (const ping of this._minimapPings) {
      const age = nowMs - ping.t;
      const alpha = 1 - age / MINIMAP_PING_FADE_MS;
      const pulse = 0.65 + 0.35 * Math.sin((1 - alpha) * Math.PI);
      ctx.fillStyle = ping.color;
      ctx.globalAlpha = alpha * pulse;
      ctx.beginPath();
      ctx.arc(ping.x, ping.z, 0.55 + (1 - alpha) * 0.35, 0, Math.PI * 2);
      ctx.fill();
      if (alpha > 0.35) {
        ctx.strokeStyle = ping.color;
        ctx.globalAlpha = alpha * 0.45;
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        ctx.arc(ping.x, ping.z, 1.1 + (1 - alpha) * 0.8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#00ff88';
    ctx.beginPath();
    ctx.moveTo(0, 0.85);
    ctx.lineTo(-0.45, -0.55);
    ctx.lineTo(0.45, -0.55);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    ctx.strokeStyle = 'rgba(0,255,136,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  showLeaderboard(rows) {
    const panel = $('hud-leaderboard');
    const body  = $('hud-leaderboard-body');
    if (!panel || !body) return;
    panel.classList.remove('hidden');
    body.innerHTML = rows.map(r => `
      <tr class="${r.isSelf ? 'lb-row-self' : ''}${r.isBot ? ' lb-row-bot' : ''}">
        <td>${r.name}</td>
        <td>${r.kills}</td>
        <td>${r.assists}</td>
        <td>${r.deaths}</td>
        <td>${r.ratio.toFixed(2)}</td>
      </tr>
    `).join('');
  }

  hideLeaderboard() {
    $('hud-leaderboard')?.classList.add('hidden');
  }
}
