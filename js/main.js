// ═══════════════════════════════════════════════════════════
//  WARFRONT — Entry point & menu logic
// ═══════════════════════════════════════════════════════════

import { Game }               from './game.js';
import { MultiplayerManager } from './multiplayer.js';
import { sound }              from './sound.js';

// ─── SETTINGS (persisted in localStorage) ───────────────
const DEFAULTS = {
  username:    'Ghost',
  sensitivity: 2.0,
  fov:         75,
  weapon:      'assault_rifle',
  adsMode:     'toggle',   // 'toggle' | 'hold'
  botCount:    3,
};

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('wf_settings') || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings(s) {
  localStorage.setItem('wf_settings', JSON.stringify(s));
}

// ─── STATE ───────────────────────────────────────────────
let settings = loadSettings();
let activeGame = null;
let mp = null;
let pendingMode = null;  // 'solo' | 'multi' — set before loadout screen

// ─── SCREEN MANAGER ──────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
}

// ─── POPULATE SETTINGS UI ────────────────────────────────
function applySettingsToUI() {
  document.getElementById('inp-username').value = settings.username;
  document.getElementById('inp-sens').value     = settings.sensitivity;
  document.getElementById('inp-fov').value      = settings.fov;
  document.getElementById('lbl-sens').textContent = Number(settings.sensitivity).toFixed(1);
  document.getElementById('lbl-fov').textContent  = settings.fov;
  // ADS mode buttons
  document.getElementById('ads-toggle-btn').classList.toggle('active', settings.adsMode === 'toggle');
  document.getElementById('ads-hold-btn').classList.toggle('active', settings.adsMode === 'hold');

  // Sync in-game pause panel
  const igSens = document.getElementById('ingame-sens');
  if (igSens) igSens.value = settings.sensitivity;
  const igSensVal = document.getElementById('ingame-sens-val');
  if (igSensVal) igSensVal.textContent = Number(settings.sensitivity).toFixed(1);
  document.querySelectorAll('.ingame-gun-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.gun === settings.weapon)
  );
}

// ─── GUN SELECTION ───────────────────────────────────────
function setupGunCards() {
  document.querySelectorAll('.gun-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.gun === settings.weapon);
    card.addEventListener('click', () => {
      document.querySelectorAll('.gun-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      settings.weapon = card.dataset.gun;
    });
  });
}

// ─── GAME LAUNCHER ───────────────────────────────────────
function launchGame(mode, mpInstance = null) {
  document.getElementById('menu-overlay').style.display = 'none';

  // Loading splash
  const loadScr = document.getElementById('loading-screen');
  loadScr.classList.remove('hidden');
  document.getElementById('loading-fill').style.width = '0%';

  // Give UI time to render, then build map (synchronous but heavy)
  requestAnimationFrame(() => {
    document.getElementById('loading-fill').style.width = '40%';
    setTimeout(() => {
      document.getElementById('loading-fill').style.width = '80%';
      setTimeout(() => {
        document.getElementById('loading-fill').style.width = '100%';
        setTimeout(() => {
          loadScr.classList.add('hidden');
          _startGame(mode, mpInstance);
        }, 200);
      }, 300);
    }, 200);
  });
}

function _startGame(mode, mpInstance) {
  if (activeGame) {
    activeGame.stop();
    activeGame = null;
  }
  activeGame = new Game({
    mode,
    weapon:      settings.weapon,
    sensitivity: settings.sensitivity,
    fov:         settings.fov,
    username:    settings.username,
    adsMode:     settings.adsMode,
    botCount:    settings.botCount,
    mp:          mpInstance,
  });
  activeGame.start();
}

function exitToMenu() {
  if (activeGame) {
    activeGame.stop();
    activeGame = null;
  }
  mp = null;
  document.getElementById('menu-overlay').style.display = '';
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('pointer-lock-overlay').classList.add('hidden');
  document.getElementById('death-screen').classList.add('hidden');
  document.getElementById('scope-overlay').classList.add('hidden');
  document.getElementById('damage-vignette').classList.remove('flash');
  showScreen('screen-main');
}

// ─── LOBBY UI ────────────────────────────────────────────
function renderLobby(players) {
  const list = document.getElementById('lobby-player-list');
  list.innerHTML = '';
  players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'lobby-player';
    div.innerHTML =
      `<span class="lobby-player-num">${i + 1}</span>` +
      `<span class="lobby-player-name">${p.name}${p.isHost ? ' 👑' : ''}</span>` +
      `<span class="lobby-player-weapon">${p.weapon.replace('_', ' ').toUpperCase()}</span>`;
    list.appendChild(div);
  });
}

// ═══════════════════════════════════════════════════════
//  WIRE UP BUTTONS
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  applySettingsToUI();
  setupGunCards();

  // UI sound helper — init AudioContext on first menu click
  function uiClick() { sound.init(); sound.play('ui_click', { volume: 0.5 }); }
  function uiHover() { sound.play('ui_hover', { volume: 0.25 }); }
  document.querySelectorAll('.menu-btn, .confirm-btn, .back-btn').forEach(btn => {
    btn.addEventListener('click',      uiClick);
    btn.addEventListener('mouseenter', uiHover);
  });

  // ── Bot count stepper ────────────────────────────────
  function updateBotCountUI() {
    document.getElementById('lbl-bot-count').textContent = settings.botCount;
  }
  updateBotCountUI();

  document.getElementById('btn-bots-minus').addEventListener('click', e => {
    e.stopPropagation();
    if (settings.botCount > 1) { settings.botCount--; updateBotCountUI(); saveSettings(settings); }
  });
  document.getElementById('btn-bots-plus').addEventListener('click', e => {
    e.stopPropagation();
    if (settings.botCount < 10) { settings.botCount++; updateBotCountUI(); saveSettings(settings); }
  });

  // ── Main menu ────────────────────────────────────────
  document.getElementById('btn-solo').addEventListener('click', () => {
    pendingMode = 'solo';
    setupGunCards();
    document.getElementById('screen-loadout').classList.add('is-solo');
    showScreen('screen-loadout');
  });

  document.getElementById('btn-multiplayer').addEventListener('click', () => {
    pendingMode = 'multi';
    setupGunCards();
    document.getElementById('screen-loadout').classList.remove('is-solo');
    showScreen('screen-loadout');
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    applySettingsToUI();
    showScreen('screen-settings');
  });

  // ── Loadout ──────────────────────────────────────────
  document.getElementById('btn-back-loadout').addEventListener('click', () => {
    showScreen('screen-main');
  });

  document.getElementById('btn-confirm-loadout').addEventListener('click', () => {
    if (pendingMode === 'solo') {
      launchGame('solo');
    } else {
      showScreen('screen-multiplayer');
    }
  });

  // ── Settings ─────────────────────────────────────────
  document.getElementById('btn-back-settings').addEventListener('click', () => {
    showScreen('screen-main');
  });

  document.getElementById('inp-sens').addEventListener('input', function () {
    document.getElementById('lbl-sens').textContent = Number(this.value).toFixed(1);
  });
  document.getElementById('inp-fov').addEventListener('input', function () {
    document.getElementById('lbl-fov').textContent = this.value;
  });

  // ADS mode toggle
  document.getElementById('ads-toggle-btn').addEventListener('click', () => {
    settings.adsMode = 'toggle';
    applySettingsToUI();
  });
  document.getElementById('ads-hold-btn').addEventListener('click', () => {
    settings.adsMode = 'hold';
    applySettingsToUI();
  });

  document.getElementById('btn-save-settings').addEventListener('click', () => {
    settings.username    = document.getElementById('inp-username').value.trim() || 'Ghost';
    settings.sensitivity = parseFloat(document.getElementById('inp-sens').value);
    settings.fov         = parseInt(document.getElementById('inp-fov').value);
    saveSettings(settings);
    showScreen('screen-main');
  });

  // ── Multiplayer ───────────────────────────────────────
  document.getElementById('btn-back-multiplayer').addEventListener('click', () => {
    showScreen('screen-loadout');
  });

  document.getElementById('inp-room-code').addEventListener('input', function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z]/g, '');
  });

  document.getElementById('btn-host').addEventListener('click', async () => {
    clearMpError();
    try {
      mp = new MultiplayerManager();
      mp.init();

      const code = await mp.hostRoom(settings.username, settings.weapon);

      document.getElementById('lbl-room-code').textContent = code;
      document.getElementById('btn-start-game').style.display = 'inline-block';
      document.getElementById('lbl-lobby-status').style.display = 'none';

      mp.onLobbyUpdate = renderLobby;

      showScreen('screen-lobby');
    } catch (e) {
      showMpError(e.message || 'Failed to create room.');
      mp = null;
    }
  });

  document.getElementById('btn-join').addEventListener('click', async () => {
    clearMpError();
    const code = document.getElementById('inp-room-code').value.trim().toUpperCase();
    if (code.length !== 4) { showMpError('Enter a 4-letter room code.'); return; }

    try {
      mp = new MultiplayerManager();
      mp.init();

      await mp.joinRoom(code, settings.username, settings.weapon);

      document.getElementById('lbl-room-code').textContent = code;
      document.getElementById('btn-start-game').style.display = 'none';
      document.getElementById('lbl-lobby-status').style.display = '';

      mp.onLobbyUpdate = renderLobby;
      mp.onGameStart   = () => launchGame('multi', mp);

      showScreen('screen-lobby');
    } catch (e) {
      showMpError(e.message || 'Failed to join room.');
      mp = null;
    }
  });

  // ── Lobby ─────────────────────────────────────────────
  document.getElementById('btn-back-lobby').addEventListener('click', () => {
    if (mp) { mp.leave(); mp = null; }
    showScreen('screen-multiplayer');
  });

  document.getElementById('btn-start-game').addEventListener('click', () => {
    if (!mp) return;
    mp.onGameStart = () => launchGame('multi', mp);
    mp.startGame();
  });

  // ── Exit-to-menu button (shown in pointer-lock overlay) ──
  document.getElementById('btn-exit-to-menu').addEventListener('click', e => {
    e.stopPropagation();
    exitToMenu();
  });

  // ── Resume button ─────────────────────────────────────
  document.getElementById('btn-resume').addEventListener('click', e => {
    e.stopPropagation();
    if (activeGame?.alive && activeGame?.running) activeGame.controls.lock();
  });

  // ── In-game weapon selector ───────────────────────────
  document.querySelectorAll('.ingame-gun-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const key = btn.dataset.gun;
      activeGame?.changeWeapon(key);
      settings.weapon = key;
      saveSettings(settings);
      document.querySelectorAll('.ingame-gun-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.gun === key)
      );
    });
  });

  // ── In-game sensitivity slider ────────────────────────
  const igSens = document.getElementById('ingame-sens');
  igSens?.addEventListener('click',  e => e.stopPropagation());
  igSens?.addEventListener('mousedown', e => e.stopPropagation());
  igSens?.addEventListener('input', e => {
    e.stopPropagation();
    const val = parseFloat(igSens.value);
    document.getElementById('ingame-sens-val').textContent = val.toFixed(1);
    activeGame?.setSensitivity(val);
    settings.sensitivity = val;
    saveSettings(settings);
  });
});

// ─── HELPERS ─────────────────────────────────────────────
function showMpError(msg) {
  const el = document.getElementById('mp-error');
  el.textContent = msg;
}
function clearMpError() {
  document.getElementById('mp-error').textContent = '';
}
