#!/usr/bin/env node
/* =============================================================================
 * simulate.js — Monte-Carlo calibration of outcome thresholds + rating ranges.
 *
 *   node tools/simulate.js [iterations]
 *
 * Model: each session opens 3 packs, the player keeps every card, then builds
 * the strongest legal XI from the kept hand (greedy by card score, respecting
 * unique-name + position/flex rules). We score that XI and collect the
 * teamTotal / attack / defend distributions, then write percentile breakpoints
 * to data/calibration.json. Because evaluateOutcome maps percentile bands to
 * tiers, calibrating the breakpoints makes the realized outcome probabilities
 * track the targets in Rules.OUTCOME_TIERS by construction.
 *
 * Deterministic (fixed base seed) so CI reproduces the same calibration.
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const Rules = require('../js/rules.js');
const Scoring = require('../js/scoring.js');
const PackEngine = require('../js/pack-engine.js');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

function loadPool() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
  const cards = [];
  for (const t of manifest.tournaments) {
    const j = JSON.parse(fs.readFileSync(path.join(DATA, t.file), 'utf8'));
    cards.push(...j.cards);
  }
  return cards;
}

/** Build the best legal XI from a kept hand. Returns scored team or null. */
function bestEleven(hand) {
  // Keep the highest-scoring card per unique name (a name fills one slot only).
  const byName = new Map();
  for (const c of hand) {
    const sc = Scoring.scoreCard(c);
    const cur = byName.get(c.name);
    if (!cur || sc > cur._score) byName.set(c.name, c);
  }
  const pool = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const c of byName.values()) pool[c.position].push(c);
  for (const k in pool) pool[k].sort((a, b) => Scoring.scoreCard(b) - Scoring.scoreCard(a));

  if (pool.GK.length < 1 || pool.DEF.length < 4 || pool.MID.length < 3 ||
      pool.FWD.length < 2 || (pool.MID.length + pool.FWD.length) < 6) {
    return null; // can't field a legal XI
  }

  const xi = [];
  xi.push(pool.GK[0]);
  xi.push(...pool.DEF.slice(0, 4));
  const mid = pool.MID.slice();
  const fwd = pool.FWD.slice();
  xi.push(...mid.splice(0, 3));
  xi.push(...fwd.splice(0, 2));
  // flex: best remaining MID or FWD
  const flex = (mid[0] && fwd[0]) ? (Scoring.scoreCard(mid[0]) >= Scoring.scoreCard(fwd[0]) ? mid[0] : fwd[0])
             : (mid[0] || fwd[0]);
  xi.push(flex);

  return Scoring.scoreTeam(xi.map((c) => ({ card: c, position: c.position })));
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(p * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}

function run() {
  const N = parseInt(process.argv[2], 10) || 100000;
  const cards = loadPool();
  console.log(`Simulating ${N} sessions over ${cards.length} cards…`);

  const totals = [], attacks = [], defends = [];
  let dnq = 0;
  for (let i = 0; i < N; i++) {
    const packs = PackEngine.openSession(cards, 0x9e3779b9 ^ (i * 2654435761));
    const hand = packs.flat();
    const team = bestEleven(hand);
    if (!team) { dnq++; continue; }
    totals.push(team.total);
    attacks.push(team.attack);
    defends.push(team.defend);
  }
  totals.sort((a, b) => a - b);
  attacks.sort((a, b) => a - b);
  defends.sort((a, b) => a - b);

  // Breakpoints at the percentile boundaries used by the outcome tiers.
  const pts = [0, 0.13, 0.38, 0.63, 0.78, 0.88, 0.95, 1];
  const breakpoints = {};
  for (const p of pts) breakpoints[p] = round2(percentile(totals, p));

  const calibration = {
    generatedAt: new Date().toISOString(),
    iterations: N,
    dnqRate: round4(dnq / N),
    total: { breakpoints, min: totals[0], max: totals[totals.length - 1] },
    attack: { min: round2(percentile(attacks, 0.01)), max: round2(percentile(attacks, 0.99)) },
    defend: { min: round2(percentile(defends, 0.01)), max: round2(percentile(defends, 0.99)) },
  };

  fs.writeFileSync(path.join(DATA, 'calibration.json'), JSON.stringify(calibration, null, 2) + '\n');

  // Report realized outcome distribution as a sanity check.
  const fakeCal = calibration;
  const counts = {};
  for (const t of totals) {
    const ev = Scoring.evaluateOutcome({ total: t, attack: 0, defend: 0 }, fakeCal);
    counts[ev.outcome] = (counts[ev.outcome] || 0) + 1;
  }
  console.log(`DNQ rate: ${(calibration.dnqRate * 100).toFixed(1)}%`);
  console.log('Realized outcome distribution (of fielded teams):');
  for (const t of Rules.OUTCOME_TIERS) {
    const c = counts[t.id] || 0;
    console.log(`  ${t.label.padEnd(20)} ${(100 * c / totals.length).toFixed(1)}%  (target ~${(t.prob * 100).toFixed(0)}%)`);
  }
  console.log('\nWrote data/calibration.json');
}

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }

run();
