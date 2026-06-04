// ═══════════════════════════════════════════════════════════
//  WARFRONT — Entry point & menu logic
// ═══════════════════════════════════════════════════════════

import { Game }               from './game.js';
import { MultiplayerManager } from './multiplayer.js';
import { sound }              from './sound.js';
import { auth }                 from './auth.js';

// ─── SETTINGS (persisted in localStorage) ───────────────
const DEFAULTS = {
  sensitivity: 2.0,
  fov:         75,
  weapon:      'assault_rifle',
  adsMode:     'toggle',   // 'toggle' | 'hold'
  botCount:    3,
  botLevel:    'corporal', // 'private' | 'corporal' | 'commando' | 'veteran'
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
function syncUsernameFromAuth() {
  settings.username = auth.displayName;
}

function applySettingsToUI() {
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
async function flushMatchStatsToProfile() {
  if (!auth.isLoggedIn) return;

  let kills = 0;
  let deaths = 0;
  let assists = 0;

  if (activeGame?.mode === 'multi' && mp?.uid) {
    const p = mp.players.get(mp.uid);
    if (p) {
      kills   = p.kills   ?? 0;
      deaths  = p.deaths  ?? 0;
      assists = p.assists ?? 0;
    }
  } else if (activeGame) {
    kills  = activeGame.kills;
    deaths = activeGame.deaths;
  }

  if (kills + deaths + assists > 0) {
    await auth.addMatchStats({ kills, deaths, assists });
  }
}

function showAuth() {
  document.getElementById('auth-overlay').style.display = '';
  document.getElementById('menu-overlay').style.display = 'none';
  showScreen('screen-auth');
}

function showAppMenu() {
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('menu-overlay').style.display = '';
  syncUsernameFromAuth();
  const lbl = document.getElementById('lbl-menu-user');
  if (lbl) lbl.textContent = auth.displayName;
  showScreen('screen-main');
}

function applyProfileToUI() {
  const p = auth.profile;
  if (!p) return;
  const inp = document.getElementById('inp-profile-pseudo');
  if (inp) inp.value = p.pseudo;
  const k = p.kills ?? 0;
  const d = p.deaths ?? 0;
  const a = p.assists ?? 0;
  const ratio = k / Math.max(1, d);
  $('prof-kills', k);
  $('prof-deaths', d);
  $('prof-assists', a);
  $('prof-ratio', ratio.toFixed(2));
}

function $(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setAuthTab(tab) {
  const login = tab === 'login';
  document.getElementById('form-login').classList.toggle('hidden', !login);
  document.getElementById('form-signup').classList.toggle('hidden', login);
  document.getElementById('tab-login').classList.toggle('active', login);
  document.getElementById('tab-signup').classList.toggle('active', !login);
  clearAuthError();
}

function setAuthBusy(busy) {
  document.getElementById('auth-busy').classList.toggle('hidden', !busy);
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg || '';
}

function clearAuthError() {
  showAuthError('');
  const pe = document.getElementById('profile-error');
  if (pe) pe.textContent = '';
}

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
  syncUsernameFromAuth();
  activeGame = new Game({
    mode,
    weapon:      settings.weapon,
    sensitivity: settings.sensitivity,
    fov:         settings.fov,
    username:    auth.displayName,
    adsMode:     settings.adsMode,
    botCount:    settings.botCount,
    botLevel:    settings.botLevel,
    mp:          mpInstance,
  });
  activeGame.start();
}

function handleRoomClosed() {
  if (activeGame) {
    activeGame.stop({ leaveRoom: false });
    activeGame = null;
  }
  mp = null;
  showMpError('Room closed — the host left.');
  document.getElementById('btn-start-game').style.display = 'none';
  document.getElementById('lbl-lobby-status').style.display = 'none';
  showScreen('screen-multiplayer');
}

function wireRoomClosedHandlers() {
  if (!mp) return;
  mp.onRoomClosed = handleRoomClosed;
}

async function exitToMenu() {
  try {
    await flushMatchStatsToProfile();
  } catch (e) {
    console.warn('Stats sync failed', e);
  }
  if (activeGame) {
    activeGame.stop();
    activeGame = null;
  }
  if (mp) {
    await mp.leave().catch(() => {});
    mp = null;
  } else {
    mp = null;
  }
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
  setAuthTab('login');

  // Pre-load SFX; unlock AudioContext on first pointer/key (browser policy)
  const soundReady = sound.init();
  const unlockAudio = () => { sound.ensureUnlocked(); };
  document.body.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
  document.body.addEventListener('keydown', unlockAudio, { once: true, capture: true });
  const menu = document.getElementById('menu-overlay');
  if (menu) menu.addEventListener('mouseenter', unlockAudio, { once: true, capture: true });

  function uiClick() {
    soundReady.then(() => sound.ensureUnlocked()).then(() => {
      sound.play('ui_click', { volume: 0.5 });
    });
  }
  function uiHover() {
    soundReady.then(() => sound.ensureUnlocked()).then(() => {
      sound.play('ui_hover', { volume: 0.25 });
    });
  }
  document.querySelectorAll('.menu-btn, .confirm-btn, .back-btn, .auth-tab').forEach(btn => {
    btn.addEventListener('click',      uiClick);
    btn.addEventListener('mouseenter', uiHover);
  });

  // ── Auth ─────────────────────────────────────────────
  auth.init().then(() => {
    if (auth.isLoggedIn) showAppMenu();
    else showAuth();
  }).catch(e => {
    showAuthError(e.message || 'Firebase failed to load. Check firebase-config.js');
    showAuth();
  });

  document.getElementById('tab-login').addEventListener('click', () => setAuthTab('login'));
  document.getElementById('tab-signup').addEventListener('click', () => setAuthTab('signup'));

  document.getElementById('form-login').addEventListener('submit', async e => {
    e.preventDefault();
    clearAuthError();
    setAuthBusy(true);
    try {
      await auth.signIn(
        document.getElementById('inp-login-pseudo').value,
        document.getElementById('inp-login-password').value,
      );
      showAppMenu();
    } catch (err) {
      showAuthError(err.message || 'Login failed.');
    } finally {
      setAuthBusy(false);
    }
  });

  document.getElementById('form-signup').addEventListener('submit', async e => {
    e.preventDefault();
    clearAuthError();
    const p1 = document.getElementById('inp-signup-password').value;
    const p2 = document.getElementById('inp-signup-password2').value;
    if (p1 !== p2) {
      showAuthError('Passwords do not match.');
      return;
    }
    setAuthBusy(true);
    try {
      await auth.signUp(
        document.getElementById('inp-signup-pseudo').value,
        p1,
      );
      showAppMenu();
    } catch (err) {
      showAuthError(err.message || 'Sign up failed.');
    } finally {
      setAuthBusy(false);
    }
  });

  // ── Bot count stepper ────────────────────────────────
  function updateBotCountUI() {
    document.getElementById('lbl-bot-count').textContent =
      settings.botCount === 0 ? 'OFF' : settings.botCount;
  }
  updateBotCountUI();

  document.getElementById('btn-bots-minus').addEventListener('click', e => {
    e.stopPropagation();
    if (settings.botCount > 0) { settings.botCount--; updateBotCountUI(); saveSettings(settings); }
  });
  document.getElementById('btn-bots-plus').addEventListener('click', e => {
    e.stopPropagation();
    if (settings.botCount < 10) { settings.botCount++; updateBotCountUI(); saveSettings(settings); }
  });

  // ── Bot difficulty selector ───────────────────────────
  function applyDiffToUI() {
    document.querySelectorAll('.diff-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.diff === settings.botLevel);
    });
  }
  applyDiffToUI();

  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      settings.botLevel = btn.dataset.diff;
      applyDiffToUI();
      saveSettings(settings);
    });
  });

  // ── Main menu ────────────────────────────────────────
  document.getElementById('btn-solo').addEventListener('click', () => {
    pendingMode = 'solo';
    setupGunCards();
    showScreen('screen-loadout');
  });

  document.getElementById('btn-multiplayer').addEventListener('click', () => {
    pendingMode = 'multi';
    setupGunCards();
    showScreen('screen-loadout');
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    applySettingsToUI();
    showScreen('screen-settings');
  });

  document.getElementById('btn-profile').addEventListener('click', () => {
    applyProfileToUI();
    showScreen('screen-profile');
  });

  document.getElementById('btn-back-profile').addEventListener('click', () => {
    showScreen('screen-main');
  });

  document.getElementById('btn-save-pseudo').addEventListener('click', async () => {
    clearAuthError();
    try {
      await auth.updatePseudo(document.getElementById('inp-profile-pseudo').value);
      syncUsernameFromAuth();
      document.getElementById('lbl-menu-user').textContent = auth.displayName;
      applyProfileToUI();
    } catch (err) {
      document.getElementById('profile-error').textContent = err.message || 'Could not save.';
    }
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await auth.signOut();
    showAuth();
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
      mp.init(auth.uid);

      const code = await mp.hostRoom(auth.displayName, settings.weapon);

      document.getElementById('lbl-room-code').textContent = code;
      document.getElementById('btn-start-game').style.display = 'inline-block';
      document.getElementById('lbl-lobby-status').style.display = 'none';

      mp.onLobbyUpdate = renderLobby;
      wireRoomClosedHandlers();

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
      mp.init(auth.uid);

      await mp.joinRoom(code, auth.displayName, settings.weapon);

      document.getElementById('lbl-room-code').textContent = code;
      document.getElementById('btn-start-game').style.display = 'none';
      document.getElementById('lbl-lobby-status').style.display = '';

      mp.onLobbyUpdate = renderLobby;
      mp.onGameStart   = () => launchGame('multi', mp);
      wireRoomClosedHandlers();

      showScreen('screen-lobby');
    } catch (e) {
      showMpError(e.message || 'Failed to join room.');
      mp = null;
    }
  });

  // ── Lobby ─────────────────────────────────────────────
  document.getElementById('btn-back-lobby').addEventListener('click', async () => {
    if (mp) {
      await mp.leave();
      mp = null;
    }
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
    void exitToMenu();
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
