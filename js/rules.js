/* =============================================================================
 * rules.js — Scoring constants, rarity criteria, pack rules, formation config.
 *
 * Pure data + small pure helpers. No DOM, no I/O. Shared by the browser game,
 * the data generator, and the validator (which imports it via the UMD shim at
 * the bottom of the file so the same source of truth runs in Node and browser).
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WCU = root.WCU || {};
    root.WCU.Rules = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* --- Positions -------------------------------------------------------- */
  const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'];

  /* --- Tournament stages (deepest run reached by the player's team) ------ */
  const STAGES = [
    'Champion',
    'Finalist',
    'Semifinalist',
    'Quarterfinalist',
    'Round of 16',
    'Group Stage',
  ];

  /* --- Rarity tiers (ordered low -> high) ------------------------------- */
  const RARITIES = ['common', 'uncommon', 'rare', 'legendary', 'iconic'];

  const RARITY_META = {
    common:    { label: 'Common',    color: '#9aa0a6', accent: '#c2c7cc' },
    uncommon:  { label: 'Uncommon',  color: '#2e9e5b', accent: '#54d489' },
    rare:      { label: 'Rare',      color: '#2f6df0', accent: '#6fa0ff' },
    legendary: { label: 'Legendary', color: '#e8b416', accent: '#ffd95c' },
    iconic:    { label: 'Iconic',    color: '#111111', accent: '#f5d77a' },
  };

  const rarityRank = (r) => RARITIES.indexOf(r);

  /* =====================================================================
   * Rarity algorithm — derived purely from outcome + honors. No manual tags.
   * Each tier lists criteria where ANY ONE qualifies. We evaluate high -> low
   * and take the first match.
   * =================================================================== */
  function deriveRarity(card) {
    const h = card.honors || {};
    const winner = !!h.tournamentWinner;
    const starter = !!card.starter; // true = part of the starting XI of deepest run
    const goals = (card.stats && card.stats.goals) || 0;
    const age = card.age || 0;

    // ICONIC
    if (winner && h.goldenBall) return 'iconic';
    if (winner && goals >= 5) return 'iconic';
    if (winner && starter && age >= 35) return 'iconic';

    // LEGENDARY
    if (winner && starter) return 'legendary';
    if (h.goldenBall) return 'legendary';
    if (h.goldenBoot) return 'legendary';
    if (h.finalGoalscorer) return 'legendary';

    // RARE
    if (h.finalist && starter) return 'rare'; // finalist (lost) starter
    if (h.allTournament) return 'rare';
    if (h.semifinalist && goals >= 3) return 'rare';

    // UNCOMMON
    if (h.semifinalist && starter) return 'uncommon';
    if (h.quarterfinalist && starter && (goals + ((card.stats && card.stats.assists) || 0)) >= 2) return 'uncommon';
    if (card.position === 'GK' && card.stats && (card.stats.cleanSheets || 0) >= 3) return 'uncommon';

    // COMMON
    return 'common';
  }

  /* =====================================================================
   * Per-card score (0–100-ish by position) + honor bonuses.
   * minutes_factor = (minutes / maxMinutes) * 10
   * maxMinutes is passed in (the deepest possible playing time that
   * tournament); defaults to a sensible full-tournament value.
   * =================================================================== */
  const HONOR_BONUS = {
    goldenBall: 25,
    goldenBoot: 20,
    allTournament: 15,
    tournamentWinner: 12,
    finalistLost: 6,
    semifinalist: 3,
  };

  function minutesFactor(minutes, maxMinutes) {
    const m = maxMinutes || 720; // ~ a full 8-game run
    return (Math.min(minutes || 0, m) / m) * 10;
  }

  function baseScore(card, maxMinutes) {
    const s = card.stats || {};
    const mf = minutesFactor(s.minutes, maxMinutes);
    switch (card.position) {
      case 'GK':
        return (s.cleanSheets || 0) * 15
             + (s.savesPerGame || 0) * 5
             - (s.goalsAgainst || 0) * 3
             + mf;
      case 'DEF':
        return (s.tacklesPerGame || 0) * 6
             + (s.interceptionsPerGame || 0) * 5
             + (s.cleanSheets || 0) * 8
             + (s.goalsScored || 0) * 10
             + mf;
      case 'MID':
        return (s.goals || 0) * 12
             + (s.assists || 0) * 8
             + (s.keyPassesPerGame || 0) * 4
             + (s.tacklesPerGame || 0) * 3
             + mf;
      case 'FWD':
        return (s.goals || 0) * 14
             + (s.assists || 0) * 6
             + (s.shotsOnTarget || 0) * 1.5
             + mf;
      default:
        return mf;
    }
  }

  function honorBonus(card) {
    const h = card.honors || {};
    let b = 0;
    if (h.goldenBall) b += HONOR_BONUS.goldenBall;
    if (h.goldenBoot) b += HONOR_BONUS.goldenBoot;
    if (h.allTournament) b += HONOR_BONUS.allTournament;
    if (h.tournamentWinner) b += HONOR_BONUS.tournamentWinner;
    // "Finalist (lost)" — finalist but NOT the winner
    if (h.finalist && !h.tournamentWinner) b += HONOR_BONUS.finalistLost;
    if (h.semifinalist) b += HONOR_BONUS.semifinalist;
    return b;
  }

  /** Full card score (base + honors). maxMinutes optional. */
  function cardScore(card, maxMinutes) {
    return baseScore(card, maxMinutes) + honorBonus(card);
  }

  /* =====================================================================
   * Roster scoring — Attack / Defend split by position weight.
   * The flex slot is scored by the placed card's REAL position.
   * =================================================================== */
  const POSITION_WEIGHTS = {
    GK:  { attack: 0.10, defend: 0.90 },
    DEF: { attack: 0.20, defend: 0.80 },
    MID: { attack: 0.50, defend: 0.50 },
    FWD: { attack: 0.80, defend: 0.20 },
  };

  /* =====================================================================
   * Formation — 11 slots. The flex slot accepts MID or FWD.
   * Sums to 11: 1 GK + 4 DEF + 3 MID + 2 FWD + 1 FLEX.
   * `accepts` lists which card positions the slot will take.
   * `row` drives the on-pitch layout (0 = keeper line at the back).
   * =================================================================== */
  const FORMATION = [
    { id: 'GK',    label: 'GK',   accepts: ['GK'],          row: 0, col: 2 },

    { id: 'LB',    label: 'LB',   accepts: ['DEF'],         row: 1, col: 0 },
    { id: 'LCB',   label: 'CB',   accepts: ['DEF'],         row: 1, col: 1 },
    { id: 'RCB',   label: 'CB',   accepts: ['DEF'],         row: 1, col: 3 },
    { id: 'RB',    label: 'RB',   accepts: ['DEF'],         row: 1, col: 4 },

    { id: 'LCM',   label: 'CM',   accepts: ['MID'],         row: 2, col: 1 },
    { id: 'CM',    label: 'CM',   accepts: ['MID'],         row: 2, col: 2 },
    { id: 'RCM',   label: 'CM',   accepts: ['MID'],         row: 2, col: 3 },

    { id: 'LW',    label: 'FWD',  accepts: ['FWD'],         row: 3, col: 1 },
    { id: 'ST',    label: 'FWD',  accepts: ['FWD'],         row: 3, col: 3 },
    { id: 'FLEX',  label: 'M/F',  accepts: ['MID', 'FWD'],  row: 3, col: 2 },
  ];

  const FORMATION_ROWS = 4; // GK, DEF, MID, FWD lines
  const FORMATION_COLS = 5;

  /** Minimum cards of each position required to even fill the formation. */
  const POSITION_REQUIREMENTS = (function () {
    // Flex can be MID or FWD; the hard minimums are the non-flex slots.
    return { GK: 1, DEF: 4, MID: 3, FWD: 2 }; // + 1 flex (MID or FWD)
  })();

  /* =====================================================================
   * Pack composition rules.
   * =================================================================== */
  const PACK_SIZE = 10;

  // Position quota per pack. GK fixed at 1; the rest sum (with GK) to 10.
  // DEF 3–4, MID 3, FWD 2–3. We resolve exact counts at roll time.
  const PACK_POSITION_QUOTA = {
    GK:  { min: 1, max: 1 },
    DEF: { min: 3, max: 4 },
    MID: { min: 3, max: 3 },
    FWD: { min: 2, max: 3 },
  };

  // Rarity distribution per pack slot index (0-based).
  // Each entry is a weighted table {rarity: weight}.
  function packSlotRarityTable(slotIndex) {
    if (slotIndex <= 6) {
      // Cards 1–7: 80% Common, 20% Uncommon
      return { common: 80, uncommon: 20 };
    }
    if (slotIndex <= 8) {
      // Cards 8–9: 60% Uncommon, 40% Rare
      return { uncommon: 60, rare: 40 };
    }
    // Card 10 (the "stud"): 70% Rare, 25% Legendary, 5% Iconic
    return { rare: 70, legendary: 25, iconic: 5 };
  }

  // Pack-wide bonuses (independent rolls).
  const PACK_BONUS = {
    commonToUncommon: 0.03, // 3% chance one Common slot upgrades to Uncommon
    uncommonToRare: 0.01,   // 1% chance one Uncommon slot upgrades to Rare
  };

  const NUM_PACKS = 3;

  /* =====================================================================
   * Tournament outcome tiers. Thresholds are percentile bands over the
   * simulated teamTotal distribution (see tools/simulate.js, which writes
   * data/calibration.json). These act as fallbacks if calibration is absent.
   *
   * Order matters: highest tier first.
   * =================================================================== */
  const OUTCOME_TIERS = [
    { id: 'champion',       label: 'World Cup Champion', percentile: 0.95, prob: 0.05 },
    { id: 'finalist',       label: 'Finalist',           percentile: 0.88, prob: 0.07 },
    { id: 'semifinalist',   label: 'Semifinalist',       percentile: 0.78, prob: 0.10 },
    { id: 'quarterfinalist',label: 'Quarterfinalist',    percentile: 0.63, prob: 0.15 },
    { id: 'roundof16',      label: 'Round of 16',        percentile: 0.38, prob: 0.25 },
    { id: 'group3',         label: 'Group Stage (3rd)',  percentile: 0.13, prob: 0.25 },
    { id: 'group4',         label: 'Group Stage (4th)',  percentile: 0.0,  prob: 0.13 },
  ];

  // Madden-style rating range.
  const RATING_MIN = 45;
  const RATING_MAX = 99;

  return {
    POSITIONS, STAGES, RARITIES, RARITY_META, rarityRank,
    deriveRarity,
    HONOR_BONUS, minutesFactor, baseScore, honorBonus, cardScore,
    POSITION_WEIGHTS,
    FORMATION, FORMATION_ROWS, FORMATION_COLS, POSITION_REQUIREMENTS,
    PACK_SIZE, PACK_POSITION_QUOTA, packSlotRarityTable, PACK_BONUS, NUM_PACKS,
    OUTCOME_TIERS, RATING_MIN, RATING_MAX,
  };
});
