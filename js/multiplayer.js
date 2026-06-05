// ═══════════════════════════════════════════════════════════
//  WARFRONT — Firebase Realtime Database multiplayer manager
// ═══════════════════════════════════════════════════════════

import { FIREBASE_CONFIG, MAX_PLAYERS, PLAYER_HEIGHT } from './config.js';

export class MultiplayerManager {
  constructor() {
    this.db       = null;
    this.roomRef  = null;
    this.roomCode = null;
    this.uid      = null;
    this.isHost   = false;

    /** @type {Map<string,object>} */
    this.players  = new Map();

    // ── Callbacks (set by Game) ─────────────────────────
    /** @type {(uid:string, data:object) => void} */
    this.onPlayerUpdate  = null;
    /** @type {(uid:string) => void} */
    this.onPlayerRemoved = null;
    /** @type {(evt:object) => void} */
    this.onHitReceived   = null;
    /** @type {(bots:Record<string,object>) => void} */
    this.onBotsUpdate    = null;
    /** @type {(evt:object) => void} */
    this.onWorldEvent    = null;
    /** @type {() => void} */
    this.onGameStart     = null;
    /** @type {(players:object[]) => void} */
    this.onLobbyUpdate   = null;
    /** @type {() => void} */
    this.onRoomClosed    = null;
    /** @type {(data:object) => void} */
    this.onMatchUpdate   = null;

    this.gameMode = 'ffa';
    this._roomClosedFired = false;
  }

  /** @param {'ffa'|'lodibidon'} mode */
  setGameMode(mode) {
    this.gameMode = mode;
  }

  // ─── INIT ────────────────────────────────────────────
  /**
   * @param {string} [accountUid] — Firebase Auth uid when logged in
   */
  init(accountUid = null) {
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    this.db  = firebase.database();
    this.uid = accountUid || ('p_' + Math.random().toString(36).slice(2, 11));
  }

  // ─── ROOM CREATION ───────────────────────────────────
  async hostRoom(username, weapon, opts = {}) {
    const code = this._genCode();
    this.roomCode = code;
    this.isHost   = true;
    this.gameMode = opts.gameMode ?? 'ffa';

    const roomData = {
      host:     this.uid,
      status:   'waiting',
      gameMode: this.gameMode,
      created:  Date.now(),
      players: {
        [this.uid]: this._playerPayload(username, weapon, true, opts.team ?? null),
      },
      world: { bots: {} },
    };

    if (this.gameMode === 'lodibidon') {
      roomData.match = this._defaultMatchState();
    }

    await this.db.ref(`warfront_rooms/${code}`).set(roomData);
    this.roomRef = this.db.ref(`warfront_rooms/${code}`);
    await this.roomRef.onDisconnect().remove();
    this._listen();
    return code;
  }

  async joinRoom(code, username, weapon, opts = {}) {
    const snap = await this.db.ref(`warfront_rooms/${code}`).once('value');
    if (!snap.exists()) throw new Error('Room not found. Check the code.');

    const data = snap.val();
    if (data.status !== 'waiting') throw new Error('Game has already started.');

    const count = Object.keys(data.players || {}).length;
    if (count >= MAX_PLAYERS) throw new Error('Room is full.');

    this.roomCode = code;
    this.isHost   = false;
    this.gameMode = data.gameMode ?? 'ffa';

    if (this.gameMode === 'lodibidon') {
      const team = opts.team ?? null;
      if (!team) throw new Error('Pick ALPHA or OMEGA before joining a Lodibidon room.');
      const teamCount = Object.values(data.players || {})
        .filter(p => p.team === team).length;
      if (teamCount >= 2) throw new Error(`Team ${team.toUpperCase()} is full.`);
    } else if (opts.team) {
      // ignore team for FFA
    }

    await this.db.ref(`warfront_rooms/${code}/players/${this.uid}`)
      .set(this._playerPayload(username, weapon, false, opts.team ?? null));

    this.roomRef = this.db.ref(`warfront_rooms/${code}`);
    this._listen();
  }

  // ─── GAME LIFECYCLE ──────────────────────────────────
  startGame() {
    if (this.isHost && this.roomRef) {
      this.roomRef.child('status').set('playing');
      this.roomRef.child('world/bots').set({});
      if (this.gameMode === 'lodibidon') {
        this.roomRef.child('match').set(this._defaultMatchState());
      }
    }
  }

  /** @param {'alpha'|'omega'} team @returns {boolean} */
  setTeam(team) {
    if (!this.roomRef) return false;
    if (this.gameMode === 'lodibidon') {
      let count = 0;
      for (const [uid, p] of this.players) {
        if (uid !== this.uid && p.team === team) count++;
      }
      if (count >= 2) return false;
    }
    this.db.ref(`warfront_rooms/${this.roomCode}/players/${this.uid}`).update({ team });
    return true;
  }

  setSpectating(on) {
    if (!this.roomRef) return;
    this.db.ref(`warfront_rooms/${this.roomCode}/players/${this.uid}`).update({ spectating: !!on });
  }

  /** Host: push lodibidon match state. */
  syncMatch(state) {
    if (!this.roomRef || !this.isHost) return;
    this.roomRef.child('match').set(state);
  }

  // ─── REAL-TIME DATA PUSH ─────────────────────────────
  updatePosition(x, y, z, rotY, gx = null, gz = null) {
    if (!this.roomRef) return;
    // x/z = world horizontal; y = camera eye height (includes jump arc).
    const patch = { x, y, z, rotY, ts: Date.now() };
    if (gx !== null) patch.gx = gx;
    if (gz !== null) patch.gz = gz;
    this.db.ref(`warfront_rooms/${this.roomCode}/players/${this.uid}`).update(patch);
  }

  updateWeapon(weapon) {
    if (!this.roomRef) return;
    this.db.ref(`warfront_rooms/${this.roomCode}/players/${this.uid}`)
      .update({ weapon });
  }

  updateHealth(health) {
    if (!this.roomRef) return;
    this.db.ref(`warfront_rooms/${this.roomCode}/players/${this.uid}`)
      .update({ health, alive: health > 0 });
  }

  updateKills(kills, deaths) {
    this.updateStats(kills, deaths);
  }

  /** Host: full bot snapshot for all clients. */
  syncBots(botsByIndex) {
    if (!this.roomRef || !this.isHost) return;
    this.roomRef.child('world/bots').set(botsByIndex);
  }

  sendHit(targetUid, damage, opts = {}) {
    if (!this.roomRef) return;
    const payload = {
      type:    'hit',
      target:  targetUid,
      shooter: opts.shooter ?? this.uid,
      damage,
      ts:      Date.now(),
    };
    if (opts.killerName != null) payload.killerName = opts.killerName;
    if (opts.botIndex != null) payload.botIndex = opts.botIndex;
    this.roomRef.child('events').push(payload);
  }

  /** Client → host: damage vs synced bot. */
  sendBotHit(botIndex, damage) {
    if (!this.roomRef) return;
    this.roomRef.child('events').push({
      type:      'bot_hit',
      botIndex,
      damage,
      shooter:   this.uid,
      ts:        Date.now(),
    });
  }

  /** Ephemeral world events (shots, grenades, bot fire sounds). */
  sendWorldEvent(evt) {
    if (!this.roomRef) return;
    this.roomRef.child('events').push({
      ...evt,
      shooter: evt.shooter ?? this.uid,
      ts:      Date.now(),
    });
  }

  sendKillFeedEvent(killer, victim) {
    if (!this.roomRef) return;
    this.roomRef.child('killfeed').push({ killer, victim, ts: Date.now() });
  }

  // ─── LOBBY HELPERS ───────────────────────────────────
  getLobbyPlayers() {
    return [...this.players.entries()].map(([uid, data]) => ({
      uid,
      name:   data.name   || uid,
      weapon: data.weapon || 'assault_rifle',
      isHost: data.isHost || false,
      team:   data.team   || null,
    }));
  }

  countTeam(team) {
    return [...this.players.values()].filter(p => p.team === team).length;
  }

  // ─── CLEANUP ─────────────────────────────────────────
  /** Leave lobby/game. Host deletes the entire room. */
  async leave() {
    if (!this.roomRef || !this.roomCode) return;

    const code    = this.roomCode;
    const wasHost = this.isHost;
    const ref     = this.roomRef;

    ref.off();
    this.roomRef  = null;
    this.roomCode = null;
    this.isHost   = false;
    this.players.clear();

    const playerRef = this.db.ref(`warfront_rooms/${code}/players/${this.uid}`);
    try { await playerRef.onDisconnect().cancel(); } catch {}

    if (wasHost) {
      try { await ref.onDisconnect().cancel(); } catch {}
      await this.db.ref(`warfront_rooms/${code}`).remove();
    } else {
      await playerRef.remove();
    }
  }

  _onRoomClosed() {
    if (this._roomClosedFired) return;
    this._roomClosedFired = true;

    this.roomRef?.off();
    this.roomRef  = null;
    this.roomCode = null;
    this.isHost   = false;
    this.players.clear();

    this.onRoomClosed?.();
  }

  // ─── PRIVATE ─────────────────────────────────────────
  _genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  _playerPayload(username, weapon, isHost, team = null) {
    return {
      name:   username,
      weapon,
      isHost,
      team,
      spectating: false,
      x: 0, y: PLAYER_HEIGHT, z: 0, rotY: 0,
      health:  100,
      kills:   0,
      deaths:  0,
      assists: 0,
      alive:   true,
      ts:      0,
    };
  }

  _defaultMatchState() {
    const now = Date.now();
    return {
      round:            1,
      scores:           { alpha: 0, omega: 0 },
      phase:            'prep',
      phaseEndsAt:      now + 3000,
      phaseRemainingMs: 3000,
      serverNow:        now,
      flagActive:       false,
      captureProgress:  0,
      captureTeam:      null,
      roundWinner:      null,
      matchWinner:      null,
      winReason:        '',
      ts:               now,
    };
  }

  /** Persist local kills/deaths (+ optional assists from events). */
  updateStats(kills, deaths, assists = null) {
    if (!this.roomRef) return;
    const patch = { kills, deaths };
    if (assists !== null) patch.assists = assists;
    this.db.ref(`warfront_rooms/${this.roomCode}/players/${this.uid}`).update(patch);
  }

  /** Increment assists for other players (called by killer client). */
  grantAssists(uids) {
    if (!this.roomRef || !uids?.length) return;
    for (const uid of uids) {
      if (!uid || uid === this.uid) continue;
      const ref = this.db.ref(`warfront_rooms/${this.roomCode}/players/${uid}/assists`);
      ref.transaction(v => (v || 0) + 1);
    }
  }

  getLeaderboardRows() {
    return [...this.players.entries()]
      .map(([uid, d]) => ({
        uid,
        name:    d.name || uid,
        kills:   d.kills   ?? 0,
        deaths:  d.deaths  ?? 0,
        assists: d.assists ?? 0,
        ratio:   (d.kills ?? 0) / Math.max(1, d.deaths ?? 0),
        isSelf:  uid === this.uid,
      }))
      .sort((a, b) => b.kills - a.kills || b.ratio - a.ratio);
  }

  _listen() {
    this._roomClosedFired = false;

    this.roomRef.on('value', snap => {
      if (!snap.exists()) {
        this._onRoomClosed();
      }
    });

    const playersRef = this.roomRef.child('players');

    playersRef.on('value', snap => {
      const all = snap.val() || {};
      const seenUids = new Set(Object.keys(all));

      for (const uid of this.players.keys()) {
        if (!seenUids.has(uid) && uid !== this.uid) {
          this.players.delete(uid);
          this.onPlayerRemoved?.(uid);
        }
      }

      for (const [uid, data] of Object.entries(all)) {
        this.players.set(uid, data);
        if (uid !== this.uid) {
          this.onPlayerUpdate?.(uid, data);
        }
      }

      this.onLobbyUpdate?.(this.getLobbyPlayers());
    });

    this.roomRef.child('status').on('value', snap => {
      if (snap.val() === 'playing') {
        this.onGameStart?.();
      }
    });

    this.roomRef.child('world/bots').on('value', snap => {
      this.onBotsUpdate?.(snap.val() || {});
    });

    this.roomRef.child('match').on('value', snap => {
      const val = snap.val();
      if (val) this.onMatchUpdate?.(val);
    });

    this.roomRef.child('match').once('value', snap => {
      const val = snap.val();
      if (val) this.onMatchUpdate?.(val);
    });

    this.roomRef.child('events').on('child_added', snap => {
      const evt = snap.val();
      if (!evt) return;

      if (evt.type === 'hit' && evt.target === this.uid) {
        this.onHitReceived?.(evt);
      } else {
        this.onWorldEvent?.(evt);
      }

      snap.ref.remove();
    });

    this.db
      .ref(`warfront_rooms/${this.roomCode}/players/${this.uid}`)
      .onDisconnect()
      .remove();
  }
}
