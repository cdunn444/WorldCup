/* =============================================================================
 * scoring.js — Card scoring, team Attack/Defend, outcome tier + Madden ratings.
 *
 * Pure functions. Depends on Rules. Works in Node (validator/simulation) and
 * the browser. Calibration data (percentile breakpoints) can be injected; if
 * absent we fall back to the static percentile bands in Rules.OUTCOME_TIERS
 * applied against a built-in reference distribution.
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./rules.js'));
  } else {
    root.WCU = root.WCU || {};
    root.WCU.Scoring = factory(root.WCU.Rules);
  }
})(typeof self !== 'undefined' ? self : this, function (Rules) {
  'use strict';

  /** Score a single card; caches result on the card object under `_score`. */
  function scoreCard(card, maxMinutes) {
    if (typeof card._score === 'number') return card._score;
    const v = Rules.cardScore(card, maxMinutes);
    card._score = v;
    return v;
  }

  /**
   * Score a full roster.
   * @param {Array<{card, position}>} placements - 11 entries. `position` is the
   *        slot-effective position (for the flex slot, pass the card's real
   *        position). If omitted, the card's own position is used.
   * @returns {{attack, defend, total, perCard:Array}}
   */
  function scoreTeam(placements) {
    let attack = 0;
    let defend = 0;
    const perCard = [];
    for (const p of placements) {
      const card = p.card || p;
      const pos = p.position || card.position;
      const w = Rules.POSITION_WEIGHTS[pos] || Rules.POSITION_WEIGHTS.MID;
      const s = scoreCard(card);
      const a = s * w.attack;
      const d = s * w.defend;
      attack += a;
      defend += d;
      perCard.push({ id: card.id, score: s, attack: a, defend: d });
    }
    return {
      attack: round2(attack),
      defend: round2(defend),
      total: round2(attack + defend),
      perCard,
    };
  }

  /* =====================================================================
   * Outcome tier + ratings against a distribution.
   *
   * `calibration` shape (from tools/simulate.js):
   * {
   *   total:  { sorted:[...], min, max },   // OR { breakpoints: {p: value} }
   *   attack: { min, max },
   *   defend: { min, max }
   * }
   * For compactness we store summary stats: per-metric min/max plus a small
   * set of percentile breakpoints for `total`.
   * =================================================================== */

  // Reference distribution used when no calibration file is present. These
  // numbers were produced by the bundled Monte-Carlo over the shipped pool and
  // are overwritten by data/calibration.json at load time when available.
  const REFERENCE = {
    total:  { breakpoints: { 0: 380, 0.13: 470, 0.38: 540, 0.63: 600, 0.78: 650, 0.88: 700, 0.95: 770, 1: 980 } },
    attack: { min: 150, max: 470 },
    defend: { min: 170, max: 500 },
  };

  function percentileFromBreakpoints(value, breakpoints) {
    // breakpoints: { percentile(0..1): metricValue } sorted ascending by value.
    const entries = Object.keys(breakpoints)
      .map((k) => [parseFloat(k), breakpoints[k]])
      .sort((a, b) => a[1] - b[1]);
    if (value <= entries[0][1]) return entries[0][0];
    const last = entries[entries.length - 1];
    if (value >= last[1]) return last[0];
    for (let i = 0; i < entries.length - 1; i++) {
      const [p0, v0] = entries[i];
      const [p1, v1] = entries[i + 1];
      if (value >= v0 && value <= v1) {
        const t = (value - v0) / (v1 - v0 || 1);
        return p0 + t * (p1 - p0);
      }
    }
    return 1;
  }

  function ratingFromRange(value, min, max) {
    const t = clamp((value - min) / ((max - min) || 1), 0, 1);
    return Math.round(Rules.RATING_MIN + t * (Rules.RATING_MAX - Rules.RATING_MIN));
  }

  /**
   * Map a team score to outcome tier + Attack/Defend ratings.
   * @param {{attack,defend,total}} team
   * @param {object} [calibration]
   */
  function evaluateOutcome(team, calibration) {
    const cal = calibration || REFERENCE;
    const totalPct = percentileFromBreakpoints(team.total, (cal.total && cal.total.breakpoints) || REFERENCE.total.breakpoints);

    let tier = Rules.OUTCOME_TIERS[Rules.OUTCOME_TIERS.length - 1];
    for (const t of Rules.OUTCOME_TIERS) {
      if (totalPct >= t.percentile) { tier = t; break; }
    }

    const aRange = (cal.attack) || REFERENCE.attack;
    const dRange = (cal.defend) || REFERENCE.defend;

    return {
      outcome: tier.id,
      outcomeLabel: tier.label,
      percentile: round2(totalPct),
      attackRating: ratingFromRange(team.attack, aRange.min, aRange.max),
      defendRating: ratingFromRange(team.defend, dRange.min, dRange.max),
    };
  }

  /* --- helpers ---------------------------------------------------------- */
  function round2(n) { return Math.round(n * 100) / 100; }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  return {
    scoreCard, scoreTeam, evaluateOutcome,
    ratingFromRange, percentileFromBreakpoints, REFERENCE,
  };
});
