// ═══════════════════════════════════════════════════════════
//  WARFRONT — Accounts (Firebase Auth + Realtime Database)
// ═══════════════════════════════════════════════════════════

import { FIREBASE_CONFIG } from './config.js';

const PSEUDO_RE = /^[a-zA-Z0-9_]{3,16}$/;
const MIN_PASSWORD = 4;

function pseudoKey(pseudo) {
  return pseudo.trim().toLowerCase();
}

function authEmail(pseudo) {
  return `${pseudoKey(pseudo)}@players.warfront`;
}

function emptyProfile(pseudo) {
  return {
    pseudo,
    pseudoLower: pseudoKey(pseudo),
    kills:   0,
    deaths:  0,
    assists: 0,
    createdAt: Date.now(),
  };
}

/** Default gameplay / UI preferences (stored per user under users/{uid}/settings). */
export const USER_SETTINGS_DEFAULTS = {
  sensitivity: 2.0,
  fov:         75,
  volume:      1.0,
  weapon:      'assault_rifle',
  adsMode:     'toggle',
  botCount:    3,
  botLevel:    'corporal',
  team:        'alpha',
  gameType:    'ffa',
  mapId:       'city',
};

const ADS_MODES    = new Set(['toggle', 'hold']);
const BOT_LEVELS   = new Set(['private', 'corporal', 'commando', 'veteran']);
const GAME_TYPES   = new Set(['ffa', 'lodibidon']);
const WEAPON_KEYS  = new Set(['assault_rifle', 'ak47', 'shotgun', 'sniper']);
const TEAM_KEYS    = new Set(['alpha', 'omega']);

/** @param {object|null|undefined} raw */
export function sanitizeUserSettings(raw) {
  const s = { ...USER_SETTINGS_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  s.sensitivity = Math.min(5, Math.max(0.5, Number(s.sensitivity) || USER_SETTINGS_DEFAULTS.sensitivity));
  s.fov         = Math.min(110, Math.max(60, parseInt(s.fov, 10) || USER_SETTINGS_DEFAULTS.fov));
  s.volume      = Math.min(1, Math.max(0, Number(s.volume) ?? USER_SETTINGS_DEFAULTS.volume));
  s.weapon      = WEAPON_KEYS.has(s.weapon) ? s.weapon : USER_SETTINGS_DEFAULTS.weapon;
  s.adsMode     = ADS_MODES.has(s.adsMode) ? s.adsMode : USER_SETTINGS_DEFAULTS.adsMode;
  s.botCount    = Math.min(10, Math.max(0, parseInt(s.botCount, 10) || USER_SETTINGS_DEFAULTS.botCount));
  s.botLevel    = BOT_LEVELS.has(s.botLevel) ? s.botLevel : USER_SETTINGS_DEFAULTS.botLevel;
  s.team        = TEAM_KEYS.has(s.team) ? s.team : USER_SETTINGS_DEFAULTS.team;
  s.gameType    = GAME_TYPES.has(s.gameType) ? s.gameType : USER_SETTINGS_DEFAULTS.gameType;
  s.mapId       = typeof s.mapId === 'string' && s.mapId.length ? s.mapId : USER_SETTINGS_DEFAULTS.mapId;
  return s;
}

export class AuthManager {
  constructor() {
    this.auth    = null;
    this.db      = null;
    this.user    = null;
    this.profile = null;
    this._ready  = null;
  }

  /** @returns {Promise<void>} */
  init() {
    if (this._ready) return this._ready;
    this._ready = new Promise((resolve, reject) => {
      try {
        if (!firebase?.apps?.length) {
          firebase.initializeApp(FIREBASE_CONFIG);
        }
        this.auth = firebase.auth();
        this.db   = firebase.database();
        this.auth.onAuthStateChanged(user => {
          this.user = user;
          if (!user) {
            this.profile = null;
            resolve();
            return;
          }
          this.loadProfile()
            .catch(() => { this.profile = null; })
            .finally(resolve);
        });
      } catch (e) {
        reject(e);
      }
    });
    return this._ready;
  }

  get uid() { return this.user?.uid ?? null; }
  get isLoggedIn() { return !!this.user; }
  get displayName() { return this.profile?.pseudo ?? 'Soldier'; }

  get ratio() {
    const k = this.profile?.kills ?? 0;
    const d = this.profile?.deaths ?? 0;
    return k / Math.max(1, d);
  }

  /** @param {(user: firebase.User|null) => void} cb */
  onAuthChange(cb) {
    return this.auth.onAuthStateChanged(async user => {
      this.user = user;
      if (user) await this.loadProfile().catch(() => { this.profile = null; });
      else this.profile = null;
      cb(user);
    });
  }

  async signUp(pseudo, password) {
    const p = pseudo.trim();
    if (!PSEUDO_RE.test(p)) {
      throw new Error('Pseudo: 3–16 letters, numbers or underscore.');
    }
    if (!password || password.length < MIN_PASSWORD) {
      throw new Error(`Password: at least ${MIN_PASSWORD} characters.`);
    }

    const key = pseudoKey(p);
    let taken;
    try {
      taken = await this.db.ref(`users_by_pseudo/${key}`).once('value');
    } catch (e) {
      if (e?.code === 'PERMISSION_DENIED') {
        throw new Error(
          'Database rules blocked sign-up. In Firebase Console → Realtime Database → Rules, publish database.rules.json from this project.',
        );
      }
      throw e;
    }
    if (taken.exists()) throw new Error('This pseudo is already taken.');

    const cred = await this.auth.createUserWithEmailAndPassword(authEmail(p), password);
    const uid  = cred.user.uid;
    const data = emptyProfile(p);

    try {
      await this.db.ref(`users/${uid}`).set(data);
      await this.db.ref(`users_by_pseudo/${key}`).set(uid);
      await this.db.ref(`users/${uid}/settings`).set({
        ...USER_SETTINGS_DEFAULTS,
        updatedAt: Date.now(),
      });
    } catch (e) {
      try { await cred.user.delete(); } catch { /* ignore */ }
      if (e?.code === 'PERMISSION_DENIED') {
        throw new Error(
          'Could not save profile. Publish database.rules.json in Firebase Realtime Database rules.',
        );
      }
      throw e;
    }
    this.profile = data;
    return cred.user;
  }

  async signIn(pseudo, password) {
    const p = pseudo.trim();
    if (!PSEUDO_RE.test(p)) throw new Error('Invalid pseudo.');
    if (!password) throw new Error('Enter your password.');

    const cred = await this.auth.signInWithEmailAndPassword(authEmail(p), password);
    await this.loadProfile();
    return cred.user;
  }

  async signOut() {
    await this.auth.signOut();
    this.profile = null;
  }

  async loadProfile() {
    if (!this.uid) {
      this.profile = null;
      return null;
    }
    const snap = await this.db.ref(`users/${this.uid}`).once('value');
    if (!snap.exists()) {
      const pseudo = this.user.email?.split('@')[0] ?? 'Soldier';
      const data   = emptyProfile(pseudo);
      await this.db.ref(`users/${this.uid}`).set(data);
      await this.db.ref(`users_by_pseudo/${data.pseudoLower}`).set(this.uid);
      this.profile = data;
      return data;
    }
    this.profile = snap.val();
    return this.profile;
  }

  /** Load persisted preferences for the signed-in user. */
  async loadUserSettings() {
    if (!this.uid) return { ...USER_SETTINGS_DEFAULTS };
    const snap = await this.db.ref(`users/${this.uid}/settings`).once('value');
    return sanitizeUserSettings(snap.val());
  }

  /**
   * Save preferences to Realtime Database (users/{uid}/settings).
   * @param {object} settings — gameplay prefs only (no username)
   */
  async saveUserSettings(settings) {
    if (!this.uid) return;
    const payload = sanitizeUserSettings(settings);
    await this.db.ref(`users/${this.uid}/settings`).set({
      ...payload,
      updatedAt: Date.now(),
    });
  }

  async updatePseudo(newPseudo) {
    if (!this.uid || !this.profile) throw new Error('Not logged in.');
    const p = newPseudo.trim();
    if (!PSEUDO_RE.test(p)) throw new Error('Pseudo: 3–16 letters, numbers or underscore.');

    const newKey = pseudoKey(p);
    const oldKey = this.profile.pseudoLower;

    if (newKey === oldKey) {
      this.profile.pseudo = p;
      return this.profile;
    }

    const taken = await this.db.ref(`users_by_pseudo/${newKey}`).once('value');
    if (taken.exists() && taken.val() !== this.uid) {
      throw new Error('This pseudo is already taken.');
    }

    const updates = {};
    updates[`users/${this.uid}/pseudo`]      = p;
    updates[`users/${this.uid}/pseudoLower`] = newKey;
    updates[`users_by_pseudo/${newKey}`]     = this.uid;
    updates[`users_by_pseudo/${oldKey}`]     = null;

    await this.db.ref().update(updates);
    this.profile.pseudo      = p;
    this.profile.pseudoLower = newKey;
    return this.profile;
  }

  /**
   * Add match stats to lifetime profile (call when leaving a game).
   * @param {{ kills?: number, deaths?: number, assists?: number }} delta
   */
  async addMatchStats(delta) {
    if (!this.uid) return;
    const ref = this.db.ref(`users/${this.uid}`);
    await ref.transaction(cur => {
      const base = cur ?? emptyProfile(this.displayName);
      return {
        ...base,
        kills:   (base.kills   ?? 0) + (delta.kills   ?? 0),
        deaths:  (base.deaths  ?? 0) + (delta.deaths  ?? 0),
        assists: (base.assists ?? 0) + (delta.assists ?? 0),
        updatedAt: Date.now(),
      };
    });
    await this.loadProfile();
  }
}

export const auth = new AuthManager();
