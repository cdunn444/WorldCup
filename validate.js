#!/usr/bin/env node
/* =============================================================================
 * validate.js — Data integrity checks for the World Cup U dataset.
 *
 *   node validate.js
 *
 * Checks (per build requirements §10):
 *   1. No duplicate player IDs across the entire dataset.
 *   2. Every card has all required fields populated (per-position stats too).
 *   3. Stored rarity matches the algorithmic criteria (catches manual drift).
 *   4. Pack composition is satisfiable: enough cards of each position+rarity
 *      to fill packs without exhausting the pool.
 *   5. Outcome distribution from a quick simulation lands within target ranges.
 *
 * Exit code 0 on success, 1 on any error. Warnings don't fail the build.
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const Rules = require('./js/rules.js');
const Scoring = require('./js/scoring.js');
const PackEngine = require('./js/pack-engine.js');

const DATA = path.join(__dirname, 'data');
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

/* --- load ------------------------------------------------------------- */
function loadManifest() {
  const p = path.join(DATA, 'manifest.json');
  if (!fs.existsSync(p)) { err('data/manifest.json missing — run `node tools/generate-data.js`'); return null; }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const REQUIRED_FIELDS = ['id', 'name', 'country', 'year', 'position', 'stage', 'rarity', 'stats', 'honors'];
const STAT_FIELDS = {
  GK: ['matches', 'cleanSheets', 'savesPerGame', 'goalsAgainst', 'minutes'],
  DEF: ['matches', 'tacklesPerGame', 'interceptionsPerGame', 'cleanSheets', 'goalsScored', 'minutes'],
  MID: ['matches', 'goals', 'assists', 'keyPassesPerGame', 'tacklesPerGame', 'minutes'],
  FWD: ['matches', 'goals', 'assists', 'shotsOnTarget', 'minutesPerGoal', 'minutes'],
};

function main() {
  const manifest = loadManifest();
  if (!manifest) return finish();

  const cards = [];
  for (const t of manifest.tournaments) {
    const fp = path.join(DATA, t.file);
    if (!fs.existsSync(fp)) { err(`Tournament file missing: ${t.file}`); continue; }
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!Array.isArray(j.cards)) { err(`${t.file}: no cards array`); continue; }
    if (j.cards.length !== t.cardCount) warn(`${t.file}: manifest says ${t.cardCount} cards, file has ${j.cards.length}`);
    cards.push(...j.cards);
  }
  console.log(`Loaded ${cards.length} cards from ${manifest.tournaments.length} tournaments.`);

  checkIdsAndFields(cards);
  checkRarity(cards);
  checkPackSatisfiable(cards);
  checkDistribution(cards);

  finish();
}

/* --- 1 & 2: ids + required fields ------------------------------------- */
function checkIdsAndFields(cards) {
  const seen = new Set();
  for (const c of cards) {
    if (!c.id) { err(`Card with no id: ${JSON.stringify(c).slice(0, 80)}`); continue; }
    if (seen.has(c.id)) err(`Duplicate card id: ${c.id}`);
    seen.add(c.id);

    for (const f of REQUIRED_FIELDS) {
      if (c[f] === undefined || c[f] === null || c[f] === '') err(`${c.id}: missing field "${f}"`);
    }
    if (!Rules.POSITIONS.includes(c.position)) err(`${c.id}: bad position "${c.position}"`);
    if (!Rules.STAGES.includes(c.stage)) err(`${c.id}: bad stage "${c.stage}"`);
    if (!Rules.RARITIES.includes(c.rarity)) err(`${c.id}: bad rarity "${c.rarity}"`);

    const need = STAT_FIELDS[c.position] || [];
    for (const f of need) {
      if (!c.stats || typeof c.stats[f] !== 'number') err(`${c.id}: missing/invalid stat "${f}"`);
    }
  }
}

/* --- 3: rarity matches the algorithm ---------------------------------- */
function checkRarity(cards) {
  let mismatches = 0;
  for (const c of cards) {
    const derived = Rules.deriveRarity(c);
    if (derived !== c.rarity) {
      mismatches++;
      err(`${c.id}: stored rarity "${c.rarity}" != derived "${derived}"`);
    }
  }
  if (!mismatches) console.log('Rarity check: all stored rarities match the algorithm.');
}

/* --- 4: pack composition satisfiable ---------------------------------- */
function checkPackSatisfiable(cards) {
  const idx = PackEngine.indexPool(cards);

  // Each pack needs exactly 1 GK and up to 4 DEF / 3 MID / 3 FWD, distinct
  // players within the pack. We need at least that many distinct cards per
  // position to ever fill a pack.
  const need = { GK: 1, DEF: 4, MID: 3, FWD: 3 };
  for (const pos of Rules.POSITIONS) {
    const count = Rules.RARITIES.reduce((n, r) => n + idx[pos][r].length, 0);
    if (count < need[pos]) err(`Not enough ${pos} cards (${count}) to fill a pack (need ${need[pos]}).`);
  }

  // The stud slot (card 10) needs Rare+ availability; warn if any tier in the
  // ceiling is empty for a position, since nearest-rarity fallback will be used.
  for (const pos of Rules.POSITIONS) {
    const rarePlus = idx[pos].rare.length + idx[pos].legendary.length + idx[pos].iconic.length;
    if (rarePlus === 0) warn(`No Rare+ ${pos} cards — stud slots will fall back to lower rarities for ${pos}.`);
  }

  // Smoke test: actually open 500 packs and confirm none come back short or
  // with duplicate players.
  let short = 0, dupes = 0;
  for (let i = 0; i < 500; i++) {
    const pack = PackEngine.openPack(idx, PackEngine.makeRng(1000 + i));
    if (pack.length !== Rules.PACK_SIZE) short++;
    const names = new Set();
    for (const c of pack) { if (names.has(c.id)) dupes++; names.add(c.id); }
  }
  if (short) err(`${short}/500 test packs came back with fewer than ${Rules.PACK_SIZE} cards.`);
  if (dupes) err(`${dupes} duplicate players appeared within single test packs.`);
  if (!short && !dupes) console.log('Pack composition: 500 test packs all valid (full size, no in-pack dupes).');
}

/* --- 5: outcome distribution within target ranges --------------------- */
function checkDistribution(cards) {
  const calPath = path.join(DATA, 'calibration.json');
  let cal = null;
  if (fs.existsSync(calPath)) cal = JSON.parse(fs.readFileSync(calPath, 'utf8'));
  else { warn('data/calibration.json missing — run `node tools/simulate.js`. Using reference distribution.'); }

  const N = 20000;
  const counts = {};
  let fielded = 0;
  for (let i = 0; i < N; i++) {
    const packs = PackEngine.openSession(cards, 0x12345 ^ (i * 2654435761));
    const team = bestEleven(packs.flat());
    if (!team) continue;
    fielded++;
    const ev = Scoring.evaluateOutcome(team, cal);
    counts[ev.outcome] = (counts[ev.outcome] || 0) + 1;
  }

  console.log(`Distribution check over ${fielded} fielded teams:`);
  for (const t of Rules.OUTCOME_TIERS) {
    const got = (counts[t.id] || 0) / fielded;
    const target = t.prob;
    const tol = Math.max(0.03, target * 0.4); // generous tolerance
    const flag = Math.abs(got - target) > tol ? '  <-- OUT OF RANGE' : '';
    console.log(`  ${t.label.padEnd(20)} ${(got * 100).toFixed(1)}%  (target ~${(target * 100).toFixed(0)}%)${flag}`);
    if (flag) warn(`Outcome "${t.label}" at ${(got * 100).toFixed(1)}% is outside target ~${(target * 100).toFixed(0)}%.`);
  }
}

// Mirror of tools/simulate.js bestEleven (kept local so validate has no dep on tools/).
function bestEleven(hand) {
  const byName = new Map();
  for (const c of hand) {
    const sc = Scoring.scoreCard(c);
    const cur = byName.get(c.name);
    if (!cur || sc > Scoring.scoreCard(cur)) byName.set(c.name, c);
  }
  const pool = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const c of byName.values()) pool[c.position].push(c);
  for (const k in pool) pool[k].sort((a, b) => Scoring.scoreCard(b) - Scoring.scoreCard(a));
  if (pool.GK.length < 1 || pool.DEF.length < 4 || pool.MID.length < 3 || pool.FWD.length < 3) return null;
  const xi = [pool.GK[0], ...pool.DEF.slice(0, 4), ...pool.MID.slice(0, 3), ...pool.FWD.slice(0, 3)];
  return Scoring.scoreTeam(xi.map((c) => ({ card: c, position: c.position })));
}

function finish() {
  console.log('');
  for (const w of warnings) console.log('WARN  ' + w);
  if (errors.length) {
    for (const e of errors) console.log('ERROR ' + e);
    console.log(`\n✗ Validation FAILED with ${errors.length} error(s), ${warnings.length} warning(s).`);
    process.exit(1);
  }
  console.log(`\n✓ Validation passed${warnings.length ? ` with ${warnings.length} warning(s)` : ''}.`);
  process.exit(0);
}

main();
