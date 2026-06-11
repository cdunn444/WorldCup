/* =============================================================================
 * pack-engine.js — Pack composition. Position rolls first, rarity rolls second
 * (conditional on position), then pack-wide upgrade bonuses, then card picks
 * with no duplicate players inside a single pack.
 *
 * Uses a seedable RNG so simulations are reproducible. Pure (no DOM).
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./rules.js'));
  } else {
    root.WCU = root.WCU || {};
    root.WCU.PackEngine = factory(root.WCU.Rules);
  }
})(typeof self !== 'undefined' ? self : this, function (Rules) {
  'use strict';

  /* --- Seedable RNG (mulberry32) --------------------------------------- */
  function makeRng(seed) {
    let a = (seed >>> 0) || (Date.now() >>> 0);
    return function rng() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function weightedPick(table, rng) {
    const keys = Object.keys(table);
    let total = 0;
    for (const k of keys) total += table[k];
    let r = rng() * total;
    for (const k of keys) {
      r -= table[k];
      if (r <= 0) return k;
    }
    return keys[keys.length - 1];
  }

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* =====================================================================
   * Build a fast lookup index: pool[position][rarity] = [cards...]
   * =================================================================== */
  function indexPool(cards) {
    const idx = {};
    for (const pos of Rules.POSITIONS) {
      idx[pos] = {};
      for (const r of Rules.RARITIES) idx[pos][r] = [];
    }
    for (const c of cards) {
      if (idx[c.position] && idx[c.position][c.rarity]) {
        idx[c.position][c.rarity].push(c);
      }
    }
    return idx;
  }

  /* Resolve the exact per-position counts for one pack (sums to PACK_SIZE). */
  function rollPositionCounts(rng) {
    // GK=1, MID=3 fixed. DEF+FWD must total 6 with DEF in 3–4, FWD in 2–3.
    // Two valid combos: {DEF4,FWD2} or {DEF3,FWD3}.
    const combos = [
      { GK: 1, DEF: 4, MID: 3, FWD: 2 },
      { GK: 1, DEF: 3, MID: 3, FWD: 3 },
    ];
    return combos[Math.floor(rng() * combos.length)];
  }

  /* Pick a card of `position` at or near `rarity`, excluding used ids. */
  function pickCard(idx, position, rarity, usedIds, rng) {
    const tryRarities = nearestRarityOrder(rarity);
    for (const r of tryRarities) {
      const bucket = idx[position][r];
      if (!bucket || bucket.length === 0) continue;
      const available = bucket.filter((c) => !usedIds.has(c.id));
      if (available.length) {
        return available[Math.floor(rng() * available.length)];
      }
    }
    return null; // pool exhausted for this position (validator should prevent)
  }

  // Search the requested rarity first, then expand outward (down, then up).
  function nearestRarityOrder(rarity) {
    const i = Rules.rarityRank(rarity);
    const order = [Rules.RARITIES[i]];
    for (let d = 1; d < Rules.RARITIES.length; d++) {
      if (i - d >= 0) order.push(Rules.RARITIES[i - d]);
      if (i + d < Rules.RARITIES.length) order.push(Rules.RARITIES[i + d]);
    }
    return order;
  }

  /* =====================================================================
   * Open a single pack. Returns an array of PACK_SIZE cards in reveal order.
   * =================================================================== */
  function openPack(idx, rng) {
    const counts = rollPositionCounts(rng);

    // 1) Lay positions across the 10 slots, then shuffle their order so the
    //    "stud" slot isn't always the same position.
    const positions = [];
    for (const pos of Rules.POSITIONS) {
      for (let i = 0; i < counts[pos]; i++) positions.push(pos);
    }
    const slotPositions = shuffle(positions, rng);

    // 2) Roll a target rarity per slot index (conditional table by index).
    const slotRarities = [];
    for (let i = 0; i < Rules.PACK_SIZE; i++) {
      slotRarities.push(weightedPick(Rules.packSlotRarityTable(i), rng));
    }

    // 3) Pack-wide upgrade bonuses (independent rolls).
    if (rng() < Rules.PACK_BONUS.commonToUncommon) {
      const i = slotRarities.indexOf('common');
      if (i >= 0) slotRarities[i] = 'uncommon';
    }
    if (rng() < Rules.PACK_BONUS.uncommonToRare) {
      const i = slotRarities.indexOf('uncommon');
      if (i >= 0) slotRarities[i] = 'rare';
    }

    // 4) Fill slots; no duplicate player (by id) within a single pack.
    const used = new Set();
    const cards = [];
    for (let i = 0; i < Rules.PACK_SIZE; i++) {
      const card = pickCard(idx, slotPositions[i], slotRarities[i], used, rng);
      if (card) {
        used.add(card.id);
        cards.push(card);
      }
    }
    // 5) Randomize reveal order so the "stud" slot isn't always revealed last
    //    and players can't infer card quality from its position in the pack.
    return shuffle(cards, rng);
  }

  /* =====================================================================
   * Open a full session of NUM_PACKS packs. Duplicate players ACROSS packs
   * are allowed (each pack tracks its own used-set).
   * @returns {Array<Array<card>>} one inner array per pack.
   * =================================================================== */
  function openSession(cards, seed) {
    const rng = makeRng(seed);
    const idx = indexPool(cards);
    const packs = [];
    for (let p = 0; p < Rules.NUM_PACKS; p++) {
      packs.push(openPack(idx, rng));
    }
    return packs;
  }

  return {
    makeRng, weightedPick, shuffle, indexPool,
    rollPositionCounts, openPack, openSession,
  };
});
