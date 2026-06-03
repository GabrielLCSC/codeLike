// ═══════════════════════════════════════════════════════════
//  WARFRONT — Firebase Realtime Database multiplayer manager
// ═══════════════════════════════════════════════════════════

import { FIREBASE_CONFIG, MAX_PLAYERS } from './config.js';

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
    /** @type {() => void} */
    this.onGameStart     = null;
    /** @type {(players:object[]) => void} */
    this.onLobbyUpdate   = null;
  }

  // ─── INIT ────────────────────────────────────────────
  init() {
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    this.db  = firebase.database();
    this.uid = 'p_' + Math.random().toString(36).slice(2, 11);
  }

  // ─── ROOM CREATION ───────────────────────────────────
  /**
   * Host a new room. Returns the room code.
   * @param {string} username
   * @param {string} weapon
   */
  async hostRoom(username, weapon) {
    const code = this._genCode();
    this.roomCode = code;
    this.isHost   = true;

    const roomData = {
      host:    this.uid,
      status:  'waiting',
      created: Date.now(),
      players: {
        [this.uid]: this._playerPayload(username, weapon, true),
      },
    };

    await this.db.ref(`warfront_rooms/${code}`).set(roomData);
    this.roomRef = this.db.ref(`warfront_rooms/${code}`);
    this._listen();
    return code;
  }

  /**
   * Join an existing room.
   * @param {string} code
   * @param {string} username
   * @param {string} weapon
   */
  async joinRoom(code, username, weapon) {
    const snap = await this.db.ref(`warfront_rooms/${code}`).once('value');
    if (!snap.exists()) throw new Error('Room not found. Check the code.');

    const data = snap.val();
    if (data.status !== 'waiting') throw new Error('Game has already started.');

    const count = Object.keys(data.players || {}).length;
    if (count >= MAX_PLAYERS) throw new Error('Room is full.');

    this.roomCode = code;
    this.isHost   = false;

    await this.db.ref(`warfront_rooms/${code}/players/${this.uid}`)
      .set(this._playerPayload(username, weapon, false));

    this.roomRef = this.db.ref(`warfront_rooms/${code}`);
    this._listen();
  }

  // ─── GAME LIFECYCLE ──────────────────────────────────
  startGame() {
    if (this.isHost && this.roomRef) {
      this.roomRef.child('status').set('playing');
    }
  }

  // ─── REAL-TIME DATA PUSH ─────────────────────────────
  updatePosition(x, y, z, rotY) {
    if (!this.roomRef) return;
    this.db.ref(`warfront_rooms/${this.roomCode}/players/${this.uid}`)
      .update({ x, y, z, rotY });
  }

  updateHealth(health) {
    if (!this.roomRef) return;
    this.db.ref(`warfront_rooms/${this.roomCode}/players/${this.uid}`)
      .update({ health, alive: health > 0 });
  }

  updateKills(kills, deaths) {
    if (!this.roomRef) return;
    this.db.ref(`warfront_rooms/${this.roomCode}/players/${this.uid}`)
      .update({ kills, deaths });
  }

  sendHit(targetUid, damage) {
    if (!this.roomRef) return;
    this.roomRef.child('events').push({
      type:    'hit',
      target:  targetUid,
      shooter: this.uid,
      damage,
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
    }));
  }

  // ─── CLEANUP ─────────────────────────────────────────
  leave() {
    if (this.roomRef && this.uid) {
      this.db.ref(`warfront_rooms/${this.roomCode}/players/${this.uid}`).remove();
      this.roomRef.off();
      this.roomRef = null;
    }
  }

  // ─── PRIVATE ─────────────────────────────────────────
  _genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no ambiguous O/0/I/1
    return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  _playerPayload(username, weapon, isHost) {
    return {
      name:   username,
      weapon,
      isHost: isHost ? true : false,
      x: 0, y: 0, z: 0, rotY: 0,
      health: 100,
      kills:  0,
      deaths: 0,
      alive:  true,
    };
  }

  _listen() {
    const playersRef = this.roomRef.child('players');

    // Player list (lobby + position sync)
    playersRef.on('value', snap => {
      const all = snap.val() || {};
      const seenUids = new Set(Object.keys(all));

      // Removals
      for (const uid of this.players.keys()) {
        if (!seenUids.has(uid) && uid !== this.uid) {
          this.players.delete(uid);
          this.onPlayerRemoved?.(uid);
        }
      }

      // Updates / additions
      for (const [uid, data] of Object.entries(all)) {
        this.players.set(uid, data);
        if (uid !== this.uid) {
          this.onPlayerUpdate?.(uid, data);
        }
      }

      this.onLobbyUpdate?.(this.getLobbyPlayers());
    });

    // Game status
    this.roomRef.child('status').on('value', snap => {
      if (snap.val() === 'playing') {
        this.onGameStart?.();
      }
    });

    // Incoming hit events
    this.roomRef.child('events').on('child_added', snap => {
      const evt = snap.val();
      if (evt?.target === this.uid) {
        this.onHitReceived?.(evt);
      }
      // Remove after reading so the list stays small
      snap.ref.remove();
    });

    // Auto-remove on disconnect
    this.db
      .ref(`warfront_rooms/${this.roomCode}/players/${this.uid}`)
      .onDisconnect()
      .remove();
  }
}
