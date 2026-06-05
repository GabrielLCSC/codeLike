// ═══════════════════════════════════════════════════════════
//  WARFRONT — Lodibidon mode (2v2 rounds, flag capture)
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import {
  PLAYER_HEIGHT,
  LODIBIDON_ROUND_TIME_S,
  LODIBIDON_PREP_TIME_S,
  LODIBIDON_CAPTURE_TIME_S,
  LODIBIDON_CAPTURE_RADIUS,
  LODIBIDON_ROUNDS_TO_WIN,
  LODIBIDON_ROUND_PAUSE_S,
} from './config.js';
import { sound } from './sound.js';

/** @typedef {'alpha'|'omega'} LodTeam */
/** @typedef {'prep'|'live'|'flag'|'round_end'|'match_over'} LodPhase */

export function yawToward(fromX, fromZ, toX, toZ) {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

export function enemyTeam(team) {
  return team === 'alpha' ? 'omega' : 'alpha';
}

/**
 * Round / flag / spectate controller — host authoritative in multiplayer.
 */
export class LodibidonController {
  /** @param {import('./game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.playerTeam = /** @type {LodTeam} */ (game.opts.team ?? 'alpha');

    this.roundNumber = 1;
    this.scores = { alpha: 0, omega: 0 };
    this.phase = /** @type {LodPhase} */ ('prep');
    this.phaseEndsAt = 0;
    this.flagActive = false;
    this.captureProgress = 0;
    /** @type {LodTeam|null} */
    this.captureTeam = null;
    this.roundWinner = /** @type {LodTeam|null} */ (null);
    this.matchWinner = /** @type {LodTeam|null} */ (null);
    this.winReason = '';

    this.spectating = false;
    /** @type {{ type:'bot', index:number }|{ type:'player', uid:string }|null} */
    this.spectateTarget = null;

    /** @type {THREE.Group|null} */
    this.flagMesh = null;
    this._appliedMatchKey = '';
    this._roundEndUiRound = -1;
    this._matchOverUiShown = false;
  }

  static isMode(opts) {
    return opts?.gameType === 'lodibidon';
  }

  /** @returns {LodTeam} */
  getTeam() {
    return this.playerTeam;
  }

  /** Combat/movement allowed (prep freezes body, not look). */
  canAct() {
    const now = Date.now();
    if (this.phase === 'round_end' || this.phase === 'match_over') return false;
    if (this.phase === 'prep' && now < this.phaseEndsAt) return false;
    if (!this.game.alive || this.spectating) return false;
    return this.phase === 'live' || this.phase === 'flag';
  }

  canMove() { return this.canAct(); }
  canShoot() { return this.canAct(); }
  canJump() { return this.canAct(); }

  /** @param {LodTeam} team */
  isAllyTeam(team) {
    return team === this.playerTeam;
  }

  /** @param {LodTeam} team */
  isEnemyTeam(team) {
    return team !== this.playerTeam;
  }

  startRound() {
    this.roundWinner = null;
    this.winReason = '';
    this.flagActive = false;
    this.captureProgress = 0;
    this.captureTeam = null;
    this.spectating = false;
    this.spectateTarget = null;
    this.phase = 'prep';
    this.phaseEndsAt = Date.now() + LODIBIDON_PREP_TIME_S * 1000;
    this._roundEndUiRound = -1;
    this._hideFlag();
    this.game.hud.hideLodibidonRoundEnd();
    this.game.hud.setLodibidonAlive(null);
    this.game.hud.hideDeathScreen();
    this.game._lodibidonLastOneVoicePlayed = false;
    this.game.hud.setLodibidonPrep(Math.ceil(LODIBIDON_PREP_TIME_S));
  }

  /** MP clients: drive prep / round timer HUD from synced wall-clock deadline. */
  syncHudTimers() {
    const now = Date.now();
    if (this.phase === 'prep') {
      const left = Math.ceil((this.phaseEndsAt - now) / 1000);
      this.game.hud.setLodibidonPrep(Math.max(0, left));
    } else if (this.phase === 'live') {
      const left = Math.max(0, Math.ceil((this.phaseEndsAt - now) / 1000));
      this.game.hud.setLodibidonTimer(left);
    } else {
      this.game.hud.hideLodibidonPrep();
      if (this.phase !== 'live') this.game.hud.setLodibidonTimer(null);
    }
  }

  _matchStateKey(data) {
    const { ts, ...rest } = data;
    return JSON.stringify(rest);
  }

  /** Host / solo: advance phases, flag, capture, wins. */
  tick(delta, nowMs) {
    if (this.phase === 'match_over') return;

    const now = Date.now();

    if (this.phase === 'prep') {
      const left = Math.ceil((this.phaseEndsAt - now) / 1000);
      this.game.hud.setLodibidonPrep(Math.max(0, left));
      if (now >= this.phaseEndsAt) {
        this.phase = 'live';
        this.phaseEndsAt = now + LODIBIDON_ROUND_TIME_S * 1000;
        this.game.hud.hideLodibidonPrep();
      }
      return;
    }

    if (this.phase === 'round_end') {
      if (now >= this.phaseEndsAt) {
        if (this.matchWinner) {
          this.phase = 'match_over';
          this.game._enterLodibidonMatchOver();
          this._showMatchOverUi();
          this.game.mp?.syncMatch(this.buildMatchState());
          return;
        }
        this.roundNumber += 1;
        this.game._lodibidonResetRound();
      }
      return;
    }

    const elim = this._checkElimination();
    if (elim) {
      this._endRound(elim, 'elimination');
      return;
    }

    if (this.phase === 'live' && now >= this.phaseEndsAt) {
      this.phase = 'flag';
      this.flagActive = true;
      this._showFlag();
      this.game.hud.setLodibidonFlagActive(true);
    }

    if (this.phase === 'flag') {
      this._updateCapture(delta, nowMs);
    }

    this._updateRoundTimer();
    this._updateSpectate(delta);
  }

  _showMatchOverUi() {
    if (this._matchOverUiShown) return;
    this._matchOverUiShown = true;
    this.game.hud.showLodibidonMatchOver(
      this.matchWinner,
      this.scores,
      this.game.getLodibidonMatchStats(),
      this.playerTeam,
    );
  }

  /** Apply Firebase match snapshot (clients). */
  applyMatchState(data) {
    if (!data) return;
    const key = this._matchStateKey(data);
    if (key === this._appliedMatchKey) return;
    this._appliedMatchKey = key;

    this.roundNumber = data.round ?? this.roundNumber;
    this.scores = { alpha: data.scores?.alpha ?? 0, omega: data.scores?.omega ?? 0 };
    this.phase = data.phase ?? this.phase;
    this.phaseEndsAt = data.phaseEndsAt ?? this.phaseEndsAt;
    this.flagActive = !!data.flagActive;
    this.captureProgress = data.captureProgress ?? 0;
    this.captureTeam = data.captureTeam ?? null;
    this.roundWinner = data.roundWinner ?? null;
    this.matchWinner = data.matchWinner ?? null;
    this.winReason = data.winReason ?? '';

    if (this.flagActive) this._showFlag();
    else this._hideFlag();

    this.game.hud.setLodibidonScore(this.scores, this.roundNumber);
    this.game.hud.setLodibidonCapture(this.captureTeam, this.captureProgress);
    this.game.hud.setLodibidonFlagActive(this.flagActive);

    this.syncHudTimers();

    if (this.phase === 'round_end' && this.roundWinner && this.roundNumber !== this._roundEndUiRound) {
      this._roundEndUiRound = this.roundNumber;
      this.game.hud.showLodibidonRoundEnd(
        this.roundWinner, this.winReason, this.scores, this.roundNumber, this.playerTeam,
      );
      this.game._playLodibidonRoundEndSound(this.roundNumber);
    }
    if (this.phase === 'match_over' && this.matchWinner) {
      this.game._enterLodibidonMatchOver();
      this._showMatchOverUi();
    }
  }

  buildMatchState() {
    return {
      round:           this.roundNumber,
      scores:          { ...this.scores },
      phase:           this.phase,
      phaseEndsAt:     this.phaseEndsAt,
      flagActive:      this.flagActive,
      captureProgress: this.captureProgress,
      captureTeam:     this.captureTeam,
      roundWinner:     this.roundWinner,
      matchWinner:     this.matchWinner,
      winReason:       this.winReason,
      ts:              Date.now(),
    };
  }

  /** @param {LodTeam} winner */
  _endRound(winner, reason) {
    if (this.phase === 'round_end' || this.phase === 'match_over') return;
    const now = Date.now();
    this.phase = 'round_end';
    this.phaseEndsAt = now + LODIBIDON_ROUND_PAUSE_S * 1000;
    this.roundWinner = winner;
    this.winReason = reason;
    this.scores[winner] += 1;

    if (this.scores[winner] >= LODIBIDON_ROUNDS_TO_WIN) {
      this.matchWinner = winner;
    }

    this.game.hud.showLodibidonRoundEnd(
      winner, reason, this.scores, this.roundNumber, this.playerTeam,
    );
    this.game.hud.setLodibidonAlive(null);
    this.game._playLodibidonRoundEndSound(this.roundNumber);
    this._roundEndUiRound = this.roundNumber;
    this.game.mp?.syncMatch(this.buildMatchState());
  }

  /** @returns {LodTeam|null} */
  _checkElimination() {
    const alphaAlive = this.game._lodibidonTeamAliveCount('alpha');
    const omegaAlive = this.game._lodibidonTeamAliveCount('omega');
    if (alphaAlive <= 0 && omegaAlive > 0) return 'omega';
    if (omegaAlive <= 0 && alphaAlive > 0) return 'alpha';
    if (alphaAlive <= 0 && omegaAlive <= 0) return this.playerTeam === 'alpha' ? 'omega' : 'alpha';
    return null;
  }

  _updateCapture(delta, nowMs) {
    const flag = this.game.map.lodibidonCenter;
    const r2 = LODIBIDON_CAPTURE_RADIUS * LODIBIDON_CAPTURE_RADIUS;
    /** @type {LodTeam|null} */
    let capTeam = null;
    let capperCount = 0;

    const inZone = (x, z) => {
      const dx = x - flag.x;
      const dz = z - flag.z;
      return dx * dx + dz * dz <= r2;
    };

    if (this.game.alive && !this.spectating && inZone(this.game.camera.position.x, this.game.camera.position.z)) {
      capTeam = this.playerTeam;
      capperCount++;
    }

    for (const bot of this.game.bots) {
      if (!bot.alive) continue;
      if (!inZone(bot.mesh.position.x, bot.mesh.position.z)) continue;
      if (!capTeam) capTeam = bot.team;
      if (bot.team === capTeam) capperCount++;
    }

    for (const [uid, rp] of this.game.remotePlayers) {
      if (!rp.mesh.visible || !(rp.data.alive ?? true)) continue;
      const pTeam = rp.data.team;
      if (!pTeam || !inZone(rp.mesh.position.x, rp.mesh.position.z)) continue;
      if (!capTeam) capTeam = /** @type {LodTeam} */ (pTeam);
      if (pTeam === capTeam) capperCount++;
    }

    if (!capTeam || capperCount === 0) {
      this.captureProgress = Math.max(0, this.captureProgress - delta * 0.65);
      if (this.captureProgress <= 0) this.captureTeam = null;
    } else {
      this.captureTeam = capTeam;
      this.captureProgress += (delta / LODIBIDON_CAPTURE_TIME_S) * capperCount;
    }

    this.game.hud.setLodibidonCapture(this.captureTeam, this.captureProgress);

    if (this.captureProgress >= 1) {
      this._endRound(capTeam, 'capture');
    }
  }

  _updateRoundTimer() {
    if (this.phase !== 'live') {
      this.game.hud.setLodibidonTimer(null);
      return;
    }
    const left = Math.max(0, Math.ceil((this.phaseEndsAt - Date.now()) / 1000));
    this.game.hud.setLodibidonTimer(left);
  }

  onLocalDeath(killerName) {
    this.game.alive = false;
    this.game.deaths++;
    this.game._killStreak = 0;
    this.game.mp?.updateStats(this.game.kills, this.game.deaths);
    this.game.mp?.updateHealth(0);
    this.game.mp?.setSpectating(true);

    sound.play('die', { volume: 1.0 });
    this.game.controls.unlock();
    this.game.grenades?.reset();
    this.game.weapon.setADS(false);
    this.game._applyADSState(false);
    this.game.hud.addKillFeed(killerName, this.game.username);
    this.game.hud.setScore(this.game.kills, this.game.deaths);
    this.game.hud.showLodibidonSpectate(killerName);

    this.spectating = true;
    this.spectateTarget = this._findTeammateTarget();
  }

  /** @returns {{ type:'bot', index:number }|{ type:'player', uid:string }|null} */
  _findTeammateTarget() {
    for (const bot of this.game._lodibidonBots()) {
      if (bot.alive && bot.team === this.playerTeam) {
        return { type: 'bot', index: bot.index };
      }
    }
    for (const [uid, rp] of this.game.remotePlayers) {
      if (uid === this.game.mp?.uid) continue;
      if ((rp.data.team === this.playerTeam) && (rp.data.alive ?? true)) {
        return { type: 'player', uid };
      }
    }
    if (this.game.mp) {
      for (const [uid, p] of this.game.mp.players) {
        if (uid === this.game.mp.uid) continue;
        if (p.team === this.playerTeam && (p.alive ?? true)) {
          return { type: 'player', uid };
        }
      }
    }
    return null;
  }

  _updateSpectate() {
    if (!this.spectating) return;

    let target = this.spectateTarget;
    if (target?.type === 'bot') {
      const bot = this.game._getLodibidonBot(target.index);
      if (!bot?.alive) target = this._findTeammateTarget();
    } else if (target?.type === 'player') {
      const rp = this.game.remotePlayers.get(target.uid);
      const pdata = this.game.mp?.players.get(target.uid);
      const alive = rp?.mesh.visible ?? pdata?.alive;
      if (!alive) target = this._findTeammateTarget();
    } else {
      target = this._findTeammateTarget();
    }

    this.spectateTarget = target;
    if (!target) {
      this.game.hud.setLodibidonSpectateName('No teammate alive');
      return;
    }

    if (target.type === 'bot') {
      const bot = this.game._getLodibidonBot(target.index);
      if (!bot) return;
      const p = bot.mesh.position;
      this.game.camera.position.set(p.x, PLAYER_HEIGHT, p.z);
      this.game.camera.rotation.y = bot.mesh.rotation.y;
      this.game.hud.setLodibidonSpectateName(`Bot-${bot.index + 1}`);
    } else {
      const rp = this.game.remotePlayers.get(target.uid);
      const pdata = this.game.mp?.players.get(target.uid);
      const pos = rp?.mesh.position ?? pdata;
      if (!pos) return;
      this.game.camera.position.set(pos.x ?? 0, pdata?.y ?? PLAYER_HEIGHT, pos.z ?? 0);
      this.game.camera.rotation.y = rp?.mesh.rotation.y ?? pdata?.rotY ?? 0;
      this.game.hud.setLodibidonSpectateName(pdata?.name ?? 'Teammate');
    }
  }

  _showFlag() {
    if (this.flagMesh) {
      this.flagMesh.visible = true;
      return;
    }
    const flag = this.game.map.lodibidonCenter;
    const g = new THREE.Group();
    g.position.set(flag.x, 0, flag.z);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 3.2, 8),
      new THREE.MeshLambertMaterial({ color: 0x888890 }),
    );
    pole.position.y = 1.6;
    g.add(pole);

    const cloth = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.9, 0.06),
      new THREE.MeshLambertMaterial({ color: 0xffcc22, emissive: 0x665500, emissiveIntensity: 0.35 }),
    );
    cloth.position.set(0.75, 2.55, 0);
    g.add(cloth);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(LODIBIDON_CAPTURE_RADIUS - 0.15, LODIBIDON_CAPTURE_RADIUS, 32),
      new THREE.MeshBasicMaterial({ color: 0xffcc22, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    g.add(ring);

    this.game.scene.add(g);
    this.flagMesh = g;
  }

  _hideFlag() {
    if (this.flagMesh) this.flagMesh.visible = false;
  }

  dispose() {
    if (this.flagMesh) {
      this.game.scene?.remove(this.flagMesh);
      this.flagMesh = null;
    }
  }
}
