// ═══════════════════════════════════════════════════════════
//  WARFRONT — HUD manager
//  Pure DOM layer — zero Three.js dependency.
// ═══════════════════════════════════════════════════════════

import {
  CELL_SIZE,
  MAX_HEALTH,
  GRENADE_FUSE_S,
  MINIMAP_VIEW_RADIUS,
  MINIMAP_SWEEP_LAP_S,
  MINIMAP_SWEEP_CYCLE_S,
  MINIMAP_SWEEP_START_RAD,
  MINIMAP_SWEEP_BEAM_RAD,
  MINIMAP_REVEAL_FADE_MS,
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
    /** @type {Map<string, { wx:number, wz:number, color:string, t:number }>} */
    this._radarHits  = new Map();
    /** @type {HTMLCanvasElement|null} */
    this._basemap    = null;
    this._basemapW   = 0;
    this._basemapH   = 0;

    if (roomCode) $('hud-room-tag').textContent = `· ${roomCode}`;

    this._mm    = $('minimap');
    this._mmCtx = this._mm.getContext('2d');
    this._mm.width  = 150;
    this._mm.height = 150;
  }

  /**
   * Pre-render minimap from MapGrid (same cells as collision / bot pathing).
   * @param {import('./maps/map-core.js').MapGrid | { getMinimapImageData: () => ImageData, width: number, height: number }} source
   */
  initMinimapBasemap(source) {
    const img  = source.getMinimapImageData
      ? source.getMinimapImageData()
      : source.buildMinimapImageData();
    const cols = source.width;
    const rows = source.height;
    const c    = document.createElement('canvas');
    c.width    = cols;
    c.height   = rows;
    c.getContext('2d').putImageData(img, 0, 0);
    this._basemap  = c;
    this._basemapW = cols;
    this._basemapH = rows;
    this._radarHits.clear();
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

  _angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /** Enemy world pos → minimap screen (heading-up, player-centred). */
  _worldToScreen(wx, wz, px, pz, rot, scale, W, H) {
    const dx   = wx - px;
    const dz   = wz - pz;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const sx   = (dx * cosR - dz * sinR) * scale;
    const sy   = (dx * sinR + dz * cosR) * scale;
    return {
      x:       W / 2 + sx,
      y:       H / 2 + sy,
      inRange: dx * dx + dz * dz <= MINIMAP_VIEW_RADIUS * MINIMAP_VIEW_RADIUS,
    };
  }

  /** Screen-space sonar lap (player-centred, not camera-locked). */
  _getSweepPhase(nowMs) {
    const t = (nowMs / 1000) % MINIMAP_SWEEP_CYCLE_S;
    if (t >= MINIMAP_SWEEP_LAP_S) {
      return { active: false, sweep: MINIMAP_SWEEP_START_RAD };
    }
    const progress = t / MINIMAP_SWEEP_LAP_S;
    return {
      active: true,
      sweep:  MINIMAP_SWEEP_START_RAD + progress * Math.PI * 2,
    };
  }

  /**
   * Zoomed, player-centred, heading-up minimap with sonar sweep.
   * @param {{ x: number, z: number, dirX: number, dirZ: number }} player
   * @param {number} nowMs
   * @param {{ x:number, z:number, color:string }[]} enemies
   */
  updateMinimap(player, nowMs, enemies) {
    const ctx   = this._mmCtx;
    const W     = this._mm.width;
    const H     = this._mm.height;
    const CS    = CELL_SIZE;
    const px    = player.x;
    const pz    = player.z;
    const scale = Math.min(W, H) / (MINIMAP_VIEW_RADIUS * 2);
    const yaw   = Math.atan2(player.dirX, player.dirZ);
    const rot   = yaw + Math.PI;
    const phase = this._getSweepPhase(nowMs);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.translate(-px, -pz);

    if (this._basemap) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        this._basemap,
        0, 0, this._basemapW, this._basemapH,
        0, 0, this._basemapW * CS, this._basemapH * CS,
      );
    }

    if (phase.active) {
      const cx = W / 2;
      const cy = H / 2;
      for (const e of enemies) {
        const { x: sx, y: sy, inRange } = this._worldToScreen(
          e.x, e.z, px, pz, rot, scale, W, H,
        );
        if (!inRange) continue;

        const screenAngle = Math.atan2(sy - cy, sx - cx);
        if (Math.abs(this._angleDiff(phase.sweep, screenAngle)) < MINIMAP_SWEEP_BEAM_RAD) {
          const key = `${e.x.toFixed(1)}_${e.z.toFixed(1)}`;
          this._radarHits.set(key, { wx: e.x, wz: e.z, color: e.color, t: nowMs });
        }
      }
    }

    for (const [key, hit] of this._radarHits) {
      if (nowMs - hit.t > MINIMAP_REVEAL_FADE_MS) this._radarHits.delete(key);
    }

    for (const hit of this._radarHits.values()) {
      const age   = nowMs - hit.t;
      const alpha = 1 - age / MINIMAP_REVEAL_FADE_MS;
      if (alpha <= 0) continue;
      const pulse  = 0.7 + 0.3 * Math.sin((1 - alpha) * Math.PI);
      const dotR   = 0.55 + (1 - alpha) * 0.35;
      const ringR  = 1.05 + (1 - alpha) * 0.75;

      ctx.globalAlpha = alpha * pulse;
      ctx.fillStyle = hit.color;
      ctx.beginPath();
      ctx.arc(hit.wx, hit.wz, dotR, 0, Math.PI * 2);
      ctx.fill();

      if (alpha > 0.4) {
        ctx.strokeStyle = hit.color;
        ctx.globalAlpha = alpha * 0.35;
        ctx.lineWidth = 0.1;
        ctx.beginPath();
        ctx.arc(hit.wx, hit.wz, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (phase.active) {
      this._drawScreenRadarSweep(ctx, W, H, phase.sweep);
    }
    this._drawPlayerMarker(ctx, W, H);

    ctx.strokeStyle = 'rgba(0,255,136,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }

  /** Sonar beam in screen space — centred on player, independent of camera yaw. */
  _drawScreenRadarSweep(ctx, W, H, sweep) {
    const cx = W / 2;
    const cy = H / 2;
    const r  = Math.hypot(cx, cy);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sweep);

    const trail = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, -trail, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,255,136,0.16)';
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,255,136,0.95)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r, 0);
    ctx.stroke();

    ctx.fillStyle = 'rgba(0,255,136,0.95)';
    ctx.beginPath();
    ctx.arc(r, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  _drawPlayerMarker(ctx, W, H) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.fillStyle = '#00ff88';
    ctx.strokeStyle = 'rgba(0,40,24,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(-7, 8);
    ctx.lineTo(7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
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
