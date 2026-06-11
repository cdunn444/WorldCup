/* =============================================================================
 * collection.js — Persistent binder + session history in localStorage.
 *
 * Rules of the road (per spec):
 *  - state.collection is the ONLY thing persisted.
 *  - We never write mid-session (no save-scumming); the game calls
 *    depositSession() exactly once when a session ends.
 *  - Export/import as JSON for backup.
 *
 * Exposed as WCU.Collection.
 * ========================================================================== */
(function (root) {
  'use strict';
  root.WCU = root.WCU || {};

  const KEY = 'worldcup-u.collection.v1';

  function emptyState() {
    return {
      version: 1,
      collection: {},          // id -> { owned, firstSeen }
      sessions: [],            // session summaries
      stats: {
        sessionsPlayed: 0,
        championships: 0,
        totalCardsCollected: 0,
        uniqueCardsCollected: 0,
      },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      return migrate(parsed);
    } catch (e) {
      console.warn('Collection load failed, starting fresh:', e);
      return emptyState();
    }
  }

  function migrate(state) {
    const base = emptyState();
    return Object.assign(base, state, {
      collection: state.collection || {},
      sessions: state.sessions || [],
      stats: Object.assign(base.stats, state.stats || {}),
    });
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('Collection save failed (quota?):', e);
      return false;
    }
  }

  /**
   * Deposit every kept card from a completed session and record the result.
   * @param {object} state - the loaded collection state (mutated + saved)
   * @param {object} session - { keptIds:[], outcome, outcomeLabel,
   *                             attackRating, defendRating, teamSnapshot:[] }
   */
  function depositSession(state, session) {
    const now = new Date().toISOString();
    let newUnique = 0;

    for (const id of session.keptIds) {
      if (!state.collection[id]) {
        state.collection[id] = { owned: 0, firstSeen: now };
        newUnique++;
      }
      state.collection[id].owned += 1;
    }

    state.stats.sessionsPlayed += 1;
    state.stats.totalCardsCollected += session.keptIds.length;
    state.stats.uniqueCardsCollected = Object.keys(state.collection).length;
    if (session.outcome === 'champion') state.stats.championships += 1;

    state.sessions.unshift({
      date: now,
      outcome: session.outcome,
      outcomeLabel: session.outcomeLabel,
      attackRating: session.attackRating,
      defendRating: session.defendRating,
      teamSnapshot: session.teamSnapshot || [],
      kept: session.keptIds.length,
    });
    // Keep history bounded so localStorage stays well under budget.
    if (state.sessions.length > 200) state.sessions.length = 200;

    save(state);
    return { newUnique };
  }

  function owned(state, id) {
    return (state.collection[id] && state.collection[id].owned) || 0;
  }

  function reset() {
    localStorage.removeItem(KEY);
    return emptyState();
  }

  /* --- export / import -------------------------------------------------- */
  function exportJSON(state) {
    return JSON.stringify(state, null, 2);
  }

  function importJSON(text) {
    const parsed = JSON.parse(text); // throws on bad JSON -> caller handles
    if (typeof parsed !== 'object' || !parsed.collection) {
      throw new Error('Not a valid World Cup U backup file.');
    }
    const state = migrate(parsed);
    save(state);
    return state;
  }

  root.WCU.Collection = {
    KEY, emptyState, load, save, depositSession, owned, reset,
    exportJSON, importJSON,
  };
})(typeof self !== 'undefined' ? self : this);
