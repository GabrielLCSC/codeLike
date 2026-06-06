// ═══════════════════════════════════════════════════════════
//  WARFRONT — Entry point & menu logic
// ═══════════════════════════════════════════════════════════

import { Game }               from './game.js';
import { MultiplayerManager } from './multiplayer.js';
import { sound }              from './sound.js';
import { auth, USER_SETTINGS_DEFAULTS } from './auth.js';
import { MAP_CATALOG, getMapCatalog, getMapGameplay, prefetchCustomMapsFromFirebase } from './maps/index.js';
import { initMapModels } from './maps/model-loader.js';
import { initWeaponModels } from './weapons/gun-parts.js';
import { setModelTools } from './maps/asset-catalog.js';

// ─── SETTINGS (local cache + Firebase per user) ───────────
const DEFAULTS = USER_SETTINGS_DEFAULTS;

function loadSettingsLocal() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('wf_settings') || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

function settingsForStorage(s) {
  const { username, ...prefs } = s;
  return prefs;
}

function saveSettings(s) {
  localStorage.setItem('wf_settings', JSON.stringify(s));
  if (auth.isLoggedIn) {
    auth.saveUserSettings(settingsForStorage(s)).catch(err => {
      console.warn('[Settings] Could not save to database:', err);
    });
  }
}

async function refreshSettingsFromDb() {
  if (!auth.isLoggedIn) {
    settings = loadSettingsLocal();
    return settings;
  }
  try {
    const dbPrefs = await auth.loadUserSettings();
    settings = { ...dbPrefs, username: auth.displayName };
    localStorage.setItem('wf_settings', JSON.stringify(settings));
  } catch (err) {
    console.warn('[Settings] Could not load from database, using local cache:', err);
    settings = loadSettingsLocal();
    settings.username = auth.displayName;
  }
  return settings;
}

// ─── STATE ───────────────────────────────────────────────
let settings = loadSettingsLocal();
let activeGame = null;
let mp = null;
let pendingMode = null;     // 'solo' | 'multi' — transport
let pendingGameType = 'ffa';  // 'ffa' | 'lodibidon'

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
  document.getElementById('inp-volume').value   = settings.volume;
  document.getElementById('lbl-sens').textContent = Number(settings.sensitivity).toFixed(1);
  document.getElementById('lbl-fov').textContent  = settings.fov;
  document.getElementById('lbl-volume').textContent = Math.round(settings.volume * 100);
  sound.setVolume(settings.volume);
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
      saveSettings(settings);
    });
  });
}

function setupMapCards() {
  const grid = document.getElementById('map-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const m of getMapCatalog()) {
    const card = document.createElement('div');
    card.className = 'map-card' + (m.custom ? ' custom-map' : '');
    card.dataset.map = m.id;
    card.innerHTML =
      `<h3>${m.name.toUpperCase()}</h3>` +
      `<p class="map-desc">${m.description}</p>`;
    if (m.id === settings.mapId) card.classList.add('selected');
    card.addEventListener('click', () => {
      document.querySelectorAll('.map-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      settings.mapId = m.id;
      saveSettings(settings);
    });
    grid.appendChild(card);
  }
}

function getMapLabel(mapId) {
  return getMapGameplay(mapId).meta.name ?? mapId;
}

function updateBotCountUI() {
  const el = document.getElementById('lbl-bot-count');
  if (el) el.textContent = settings.botCount === 0 ? 'OFF' : settings.botCount;
}

function applyDiffToUI() {
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.diff === settings.botLevel);
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

async function showAppMenu() {
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('menu-overlay').style.display = '';
  await refreshSettingsFromDb();
  const [models] = await Promise.all([initMapModels(), initWeaponModels()]);
  setModelTools(models);
  await prefetchCustomMapsFromFirebase();
  syncUsernameFromAuth();
  applySettingsToUI();
  setupGunCards();
  setupMapCards();
  updateBotCountUI();
  applyDiffToUI();
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
  document.getElementById('loading-screen')?.classList.add('hidden');
  _startGame(mode, mpInstance);
  activeGame?.tryPointerLock();
}

function launchMapEditor() {
  document.getElementById('menu-overlay').style.display = 'none';
  document.getElementById('loading-screen')?.classList.add('hidden');
  if (activeGame) {
    activeGame.stop({ leaveRoom: false });
    activeGame = null;
  }
  syncUsernameFromAuth();
  activeGame = new Game({
    mode:        'solo',
    editorMode:  true,
    weapon:      settings.weapon,
    sensitivity: settings.sensitivity,
    fov:         settings.fov,
    username:    auth.displayName,
    adsMode:     settings.adsMode,
  });
  void activeGame.start().then(() => {
    if (!activeGame?.running) {
      activeGame?.stop({ leaveRoom: false });
      activeGame = null;
    }
  });
}

function _startGame(mode, mpInstance) {
  if (activeGame) {
    activeGame.stop();
    activeGame = null;
  }
  syncUsernameFromAuth();
  const isLodibidon = pendingGameType === 'lodibidon' || mpInstance?.gameMode === 'lodibidon';
  activeGame = new Game({
    mode,
    gameType:  isLodibidon ? 'lodibidon' : 'ffa',
    team:      settings.team,
    mapId:     mpInstance?.mapId ?? settings.mapId,
    weapon:      settings.weapon,
    sensitivity: settings.sensitivity,
    fov:         settings.fov,
    username:    auth.displayName,
    adsMode:     settings.adsMode,
    botCount:    isLodibidon ? 0 : settings.botCount,
    botLevel:    settings.botLevel,
    mp:          mpInstance,
  });
  activeGame.start();
}

function showGametypeScreen(transport) {
  pendingMode = transport;
  const title = document.getElementById('gametype-title');
  if (title) title.textContent = `${transport === 'solo' ? 'SOLO' : 'MULTIPLAYER'} — GAME TYPE`;
  showScreen('screen-gametype');
}

function setLoadoutForGameType(gameType) {
  pendingGameType = gameType;
  settings.gameType = gameType;
  saveSettings(settings);

  const isLod = gameType === 'lodibidon';
  document.getElementById('lodibidon-team-row').style.display = isLod ? '' : 'none';
  document.getElementById('btn-confirm-loadout').classList.remove('hidden');
  document.querySelectorAll('.bot-count-row').forEach(el => {
    if (el.id === 'lodibidon-team-row') return;
    el.style.display = isLod ? 'none' : '';
  });
  if (isLod) {
    document.querySelectorAll('.team-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.team === settings.team);
    });
  }
  setupGunCards();
  setupMapCards();
  showScreen('screen-loadout');
}

/** @deprecated use setLoadoutForGameType */
function setLoadoutMode(mode) {
  if (mode === 'lodibidon') {
    pendingGameType = 'lodibidon';
    setLoadoutForGameType('lodibidon');
    return;
  }
  pendingMode = mode;
  setLoadoutForGameType('ffa');
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
  document.getElementById('classic-match-over')?.classList.add('hidden');
  document.getElementById('death-screen').classList.add('hidden');
  document.getElementById('scope-overlay').classList.add('hidden');
  document.getElementById('damage-vignette').classList.remove('flash');
  showScreen('screen-main');
}

// ─── LOBBY UI ────────────────────────────────────────────
function renderLobby(players) {
  const list = document.getElementById('lobby-player-list');
  const isLod = mp?.gameMode === 'lodibidon';
  const mapLbl = document.getElementById('lbl-lobby-map');
  if (mapLbl && mp?.mapId) mapLbl.textContent = getMapLabel(mp.mapId);
  list.innerHTML = '';
  players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'lobby-player';
    const teamTag = p.team
      ? `<span class="lobby-player-team ${p.team}">${p.team.toUpperCase()}</span>`
      : '';
    div.innerHTML =
      `<span class="lobby-player-num">${i + 1}</span>` +
      `<span class="lobby-player-name">${p.name}${p.isHost ? ' 👑' : ''}${teamTag}</span>` +
      `<span class="lobby-player-weapon">${p.weapon.replace('_', ' ').toUpperCase()}</span>`;
    list.appendChild(div);
  });

  if (isLod && mp?.isHost) {
    const btn = document.getElementById('btn-start-game');
    const alpha = mp.countTeam('alpha');
    const omega = mp.countTeam('omega');
    const total = players.length;
    const ok = total >= 1 && alpha <= 2 && omega <= 2;
    btn.disabled = !ok;
    btn.title = ok ? '' : 'Need at least 1 player; max 2 per team (bots fill empty slots)';
  }
}

function setLobbyLodibidonUI(isLod) {
  document.getElementById('lobby-hint-ffa').classList.toggle('hidden', isLod);
  document.getElementById('lobby-hint-lodibidon').classList.toggle('hidden', !isLod);
  document.getElementById('lobby-team-pick').classList.toggle('hidden', !isLod);
}

// ═══════════════════════════════════════════════════════
//  WIRE UP BUTTONS
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  applySettingsToUI();
  setupGunCards();
  setupMapCards();
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
  auth.init().then(async () => {
    if (auth.isLoggedIn) await showAppMenu();
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
      await showAppMenu();
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
      await showAppMenu();
    } catch (err) {
      showAuthError(err.message || 'Sign up failed.');
    } finally {
      setAuthBusy(false);
    }
  });

  // ── Bot count stepper ────────────────────────────────
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
    showGametypeScreen('solo');
  });

  document.getElementById('btn-multiplayer').addEventListener('click', () => {
    showGametypeScreen('multi');
  });

  document.getElementById('btn-back-gametype').addEventListener('click', () => {
    showScreen('screen-main');
  });

  document.getElementById('btn-gametype-classic').addEventListener('click', () => {
    setLoadoutForGameType('ffa');
  });

  document.getElementById('btn-gametype-lodibidon').addEventListener('click', () => {
    setLoadoutForGameType('lodibidon');
  });

  document.querySelectorAll('.team-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const team = btn.dataset.team;
      if (mp && !mp.setTeam(team)) {
        alert(`Team ${team.toUpperCase()} is full (max 2).`);
        const me = mp.players.get(mp.uid);
        const current = me?.team ?? settings.team;
        document.querySelectorAll('.team-btn').forEach(b =>
          b.classList.toggle('active', b.dataset.team === current),
        );
        return;
      }
      settings.team = team;
      document.querySelectorAll('.team-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.team === settings.team),
      );
      saveSettings(settings);
    });
  });

  document.getElementById('btn-lodibidon-exit')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    const prevLabel = btn.textContent;
    btn.textContent = 'LEAVING…';
    await sound.fadeOutMatchEnd(3);
    void exitToMenu();
  });

  document.getElementById('btn-classic-exit')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'LEAVING…';
    await sound.fadeOutMatchEnd(3);
    void exitToMenu();
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    applySettingsToUI();
    showScreen('screen-settings');
  });

  document.getElementById('btn-map-editor')?.addEventListener('click', () => {
    launchMapEditor();
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
    document.getElementById('lodibidon-team-row').style.display = 'none';
    document.querySelectorAll('.bot-count-row').forEach(el => {
      if (el.id !== 'lodibidon-team-row') el.style.display = '';
    });
    showScreen('screen-gametype');
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
  document.getElementById('inp-volume').addEventListener('input', function () {
    document.getElementById('lbl-volume').textContent = Math.round(parseFloat(this.value) * 100);
    sound.setVolume(parseFloat(this.value));
  });

  // ADS mode toggle
  document.getElementById('ads-toggle-btn').addEventListener('click', () => {
    settings.adsMode = 'toggle';
    applySettingsToUI();
    saveSettings(settings);
  });
  document.getElementById('ads-hold-btn').addEventListener('click', () => {
    settings.adsMode = 'hold';
    applySettingsToUI();
    saveSettings(settings);
  });

  document.getElementById('btn-save-settings').addEventListener('click', () => {
    settings.sensitivity = parseFloat(document.getElementById('inp-sens').value);
    settings.fov         = parseInt(document.getElementById('inp-fov').value);
    settings.volume      = parseFloat(document.getElementById('inp-volume').value);
    sound.setVolume(settings.volume);
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
      const isLod = pendingGameType === 'lodibidon';
      if (isLod) mp.setGameMode('lodibidon');

      const code = await mp.hostRoom(auth.displayName, settings.weapon, {
        gameMode: isLod ? 'lodibidon' : 'ffa',
        team:     isLod ? settings.team : null,
        mapId:    settings.mapId,
      });

      document.getElementById('lbl-room-code').textContent = code;
      document.getElementById('btn-start-game').style.display = 'inline-block';
      document.getElementById('lbl-lobby-status').style.display = 'none';

      mp.onLobbyUpdate = renderLobby;
      wireRoomClosedHandlers();
      setLobbyLodibidonUI(isLod);

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
      const isLod = pendingGameType === 'lodibidon';

      await mp.joinRoom(code, auth.displayName, settings.weapon, {
        team: isLod ? settings.team : null,
      });

      document.getElementById('lbl-room-code').textContent = code;
      document.getElementById('btn-start-game').style.display = 'none';
      document.getElementById('lbl-lobby-status').style.display = '';

      mp.onLobbyUpdate = renderLobby;
      mp.onGameStart   = () => launchGame('multi', mp);
      wireRoomClosedHandlers();
      setLobbyLodibidonUI(mp.gameMode === 'lodibidon');

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
    if (activeGame?.alive && activeGame?.running) activeGame.tryPointerLock();
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
