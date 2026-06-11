/* =============================================================================
 * data-loader.js — Fetches the card dataset + metadata at runtime.
 *
 * Loads manifest -> all tournament files (in parallel) -> flattens into one
 * card pool. Also loads countries.json and the optional calibration.json
 * (Monte-Carlo breakpoints). Browser-only (uses fetch). Exposed as WCU.Data.
 * ========================================================================== */
(function (root) {
  'use strict';
  root.WCU = root.WCU || {};

  const BASE = 'data/';

  async function getJSON(path) {
    const res = await fetch(BASE + path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json();
  }

  async function loadAll() {
    const manifest = await getJSON('manifest.json');

    const [countries, calibration, ...tournaments] = await Promise.all([
      getJSON('countries.json').catch(() => ({})),
      getJSON('calibration.json').catch(() => null),
      ...manifest.tournaments.map((t) => getJSON(t.file)),
    ]);

    const cards = [];
    const byId = {};
    for (const t of tournaments) {
      for (const c of t.cards) {
        cards.push(c);
        byId[c.id] = c;
      }
    }

    return {
      manifest,
      countries,
      calibration,
      cards,
      byId,
      tournaments: manifest.tournaments.map((t) => t.year),
      cardById: (id) => byId[id],
    };
  }

  root.WCU.Data = { loadAll, getJSON };
})(typeof self !== 'undefined' ? self : this);
