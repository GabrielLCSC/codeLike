// ═══════════════════════════════════════════════════════════
//  WARFRONT — Classic FFA match timer (2 min) + end state
// ═══════════════════════════════════════════════════════════

import { CLASSIC_MATCH_TIME_S } from './config.js';

export class ClassicMatchController {
  /** @param {import('./game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.phase = 'live';
    this.phaseEndsAt = 0;
    this._syncedRemainingMs = 0;
    this._syncedRemainingAt = 0;
    this._hasState = false;
    this._ended = false;
  }

  start() {
    const now = Date.now();
    this.phase = 'live';
    this.phaseEndsAt = now + CLASSIC_MATCH_TIME_S * 1000;
    this._ended = false;
    this._hasState = true;

    if (this.game._isMpHost() || !this.game._isMultiplayer()) {
      this.game.mp?.syncClassic(this.buildState());
    }
    this.game.hud.showClassicTimer(true);
    this.game.hud.setClassicTimer(CLASSIC_MATCH_TIME_S);
  }

  buildState() {
    const now = Date.now();
    return {
      phase:            this.phase,
      phaseEndsAt:      this.phaseEndsAt,
      phaseRemainingMs: Math.max(0, this.phaseEndsAt - now),
      serverNow:        now,
    };
  }

  /** @param {object} data */
  applyState(data) {
    if (!data) return;
    this._hasState = true;
    if (data.phase) this.phase = data.phase;
    if (data.phaseEndsAt) this.phaseEndsAt = data.phaseEndsAt;
    this._applySyncedRemaining(data);

    if (this.phase === 'live') {
      this.game.hud.showClassicTimer(true);
      this.game.hud.setClassicTimer(Math.max(0, Math.ceil(this._phaseRemainingMs() / 1000)));
    }

    if (this.phase === 'over' && !this._ended) {
      this._ended = true;
      this.game.hud.setClassicTimer(0);
      this.game._enterClassicMatchOver(false);
    }
  }

  _applySyncedRemaining(data) {
    if (data?.phaseRemainingMs == null) return;
    this._syncedRemainingMs = Math.max(0, data.phaseRemainingMs);
    this._syncedRemainingAt = Date.now();
  }

  _phaseRemainingMs() {
    if (this.game._isMpClient()) {
      const elapsed = Date.now() - this._syncedRemainingAt;
      return Math.max(0, this._syncedRemainingMs - elapsed);
    }
    return Math.max(0, this.phaseEndsAt - Date.now());
  }

  canAct() {
    return this.phase === 'live' && this.game.alive;
  }

  isOver() {
    return this.phase === 'over';
  }

  tick(nowMs) {
    if (this.phase === 'over') return;

    const leftSec = Math.ceil(this._phaseRemainingMs() / 1000);
    this.game.hud.setClassicTimer(Math.max(0, leftSec));

    if (this.game._isMpHost() || !this.game._isMultiplayer()) {
      if (this._phaseRemainingMs() <= 0) {
        this._endMatch();
        return;
      }
      if (nowMs - (this.game._lastClassicSyncMs ?? 0) >= 1000) {
        this.game._lastClassicSyncMs = nowMs;
        this.game.mp?.syncClassic(this.buildState());
      }
    } else if (this._hasState && this._phaseRemainingMs() <= 0) {
      this._endMatch();
    }
  }

  _endMatch() {
    if (this._ended) return;
    this._ended = true;
    this.phase = 'over';
    this.game.hud.setClassicTimer(0);

    if (this.game._isMpHost() || !this.game._isMultiplayer()) {
      this.game.mp?.syncClassic({ ...this.buildState(), phase: 'over', phaseRemainingMs: 0 });
    }
    this.game._enterClassicMatchOver(true);
  }

  dispose() {
    this.game.hud.showClassicTimer(false);
  }
}
