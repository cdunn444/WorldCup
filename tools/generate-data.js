#!/usr/bin/env node
/* =============================================================================
 * generate-data.js — Compile curated rosters into the runtime JSON dataset.
 *
 *   node tools/generate-data.js
 *
 * Emits:
 *   data/tournaments/<year>.json   one file per World Cup
 *   data/manifest.json             index of tournaments + counts
 *   data/countries.json            flag/colour metadata
 *
 * Stats are synthesized deterministically from a hash of each card id, so the
 * output is stable across runs (good for the validator and the simulator).
 * Real names / positions / stages / honors come from tools/rosters.js.
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const Rules = require('../js/rules.js');
const { TOURNAMENTS } = require('./rosters.js');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const TDIR = path.join(DATA, 'tournaments');

/* --- deterministic RNG keyed by string -------------------------------- */
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --- slug / id -------------------------------------------------------- */
function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/* --- flag parsing ----------------------------------------------------- */
function parseFlags(str) {
  const f = { starter: true, honors: {}, overrides: {} };
  for (const tok of (str || '').split(/\s+/).filter(Boolean)) {
    if (tok === 'sub') f.starter = false;
    else if (tok === 'capt') f.captain = true;
    else if (tok === 'gb') f.honors.goldenBall = true;
    else if (tok === 'gboot') f.honors.goldenBoot = true;
    else if (tok === 'at') f.honors.allTournament = true;
    else if (tok === 'fg') f.honors.finalGoalscorer = true;
    else if (/^g\d+$/.test(tok)) f.overrides.goals = +tok.slice(1);
    else if (/^a\d+$/.test(tok)) f.overrides.assists = +tok.slice(1);
    else if (/^cs\d+$/.test(tok)) f.overrides.cleanSheets = +tok.slice(2);
    else if (/^age\d+$/.test(tok)) f.overrides.age = +tok.slice(3);
  }
  return f;
}

/* --- team-level honors from stage ------------------------------------- */
function stageHonors(stage) {
  const h = {};
  const deep = Rules.STAGES.indexOf(stage);
  const idx = (s) => Rules.STAGES.indexOf(s);
  if (deep <= idx('Champion')) h.tournamentWinner = true;
  if (deep <= idx('Finalist')) h.finalist = true;
  if (deep <= idx('Semifinalist')) h.semifinalist = true;
  if (deep <= idx('Quarterfinalist')) h.quarterfinalist = true;
  return h;
}

const MATCHES_BY_STAGE = {
  'Champion': 7, 'Finalist': 7, 'Semifinalist': 7,
  'Quarterfinalist': 5, 'Round of 16': 4, 'Group Stage': 3,
};

function r1(n) { return Math.round(n * 10) / 10; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/* --- synthesize stats ------------------------------------------------- */
function buildStats(card, stars, ov, teamMatches) {
  const rng = mulberry32(hashStr(card.id));
  const n = (spread) => (rng() - 0.5) * 2 * spread; // +/- spread

  const matches = card.starter
    ? clamp(Math.round(teamMatches - rng() * 1.2), 1, teamMatches)
    : clamp(Math.round(1 + rng() * (teamMatches / 2)), 1, teamMatches);

  const minutes = card.starter
    ? Math.round(matches * (84 + n(6)))
    : Math.round(matches * (22 + rng() * 22));

  const s = { matches, minutes };

  switch (card.position) {
    case 'GK': {
      s.cleanSheets = ov.cleanSheets != null ? ov.cleanSheets
        : clamp(Math.round(matches * (0.25 + stars * 0.07) + n(0.5)), 0, matches);
      s.savesPerGame = r1(clamp(2 + stars * 0.5 + n(0.6), 0.5, 6));
      s.goalsAgainst = clamp(Math.round(matches * (1.1 - stars * 0.12) + n(0.6)), 0, matches * 3);
      break;
    }
    case 'DEF': {
      s.tacklesPerGame = r1(clamp(1.4 + stars * 0.45 + n(0.5), 0.3, 5));
      s.interceptionsPerGame = r1(clamp(1.0 + stars * 0.4 + n(0.4), 0.3, 5));
      s.cleanSheets = ov.cleanSheets != null ? ov.cleanSheets
        : clamp(Math.round(matches * (0.2 + stars * 0.06)), 0, matches);
      s.goalsScored = ov.goals != null ? ov.goals
        : (rng() < 0.12 + stars * 0.03 ? 1 : 0);
      break;
    }
    case 'MID': {
      s.goals = ov.goals != null ? ov.goals
        : Math.max(0, Math.round((stars - 3) * 0.5 + n(0.6)));
      s.assists = ov.assists != null ? ov.assists
        : Math.max(0, Math.round((stars - 3) * 0.4 + n(0.6)));
      s.keyPassesPerGame = r1(clamp(0.8 + stars * 0.5 + n(0.4), 0.2, 4));
      s.tacklesPerGame = r1(clamp(0.8 + stars * 0.35 + n(0.4), 0.2, 4));
      break;
    }
    case 'FWD': {
      s.goals = ov.goals != null ? ov.goals
        : Math.max(0, Math.round((stars - 2.5) * 0.8 + n(0.7)));
      s.assists = ov.assists != null ? ov.assists
        : Math.max(0, Math.round((stars - 3) * 0.5 + n(0.6)));
      s.shotsOnTarget = Math.max(s.goals, Math.round(s.goals * 1.6 + stars + n(1.2)));
      s.minutesPerGoal = s.goals > 0 ? Math.round(minutes / s.goals) : minutes;
      break;
    }
  }
  return s;
}

/* --- build all cards -------------------------------------------------- */
const usedIds = new Set();
function makeId(name, year, country) {
  let base = `${slug(name)}-${year}`;
  if (!usedIds.has(base)) { usedIds.add(base); return base; }
  let id = `${slug(name)}-${slug(country)}-${year}`;
  let i = 2;
  while (usedIds.has(id)) { id = `${slug(name)}-${slug(country)}-${year}-${i++}`; }
  usedIds.add(id);
  return id;
}

const countriesUsed = new Set();
const manifest = { generatedAt: new Date().toISOString(), totalCards: 0, tournaments: [] };

for (const t of TOURNAMENTS) {
  const teamMatches = {};
  const cards = [];
  for (const team of t.teams) {
    countriesUsed.add(team.country);
    const th = stageHonors(team.stage);
    const tm = MATCHES_BY_STAGE[team.stage] || 4;
    for (const tok of team.players) {
      const [name, position, stars, flagStr] = tok;
      const f = parseFlags(flagStr);
      const id = makeId(name, t.year, team.country);
      const honors = Object.assign({}, th, f.honors);
      const card = {
        id, name, country: team.country, year: t.year,
        position, stage: team.stage,
        starter: f.starter,
        age: f.overrides.age || (24 + Math.round(mulberry32(hashStr(id + 'age'))() * 8)),
        honors,
      };
      card.stats = buildStats(card, stars, f.overrides, tm);
      card.rarity = Rules.deriveRarity(card);
      if (f.captain) card.captain = true;
      // Tidy field order for readable JSON.
      cards.push({
        id: card.id, name: card.name, country: card.country, year: card.year,
        position: card.position, stage: card.stage, starter: card.starter,
        age: card.age, stats: card.stats, honors: card.honors,
        rarity: card.rarity, captain: card.captain || undefined,
      });
    }
  }
  const file = `tournaments/${t.year}.json`;
  const payload = { year: t.year, host: t.host, cards };
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(payload, null, 2) + '\n');
  manifest.tournaments.push({ year: t.year, host: t.host, file, cardCount: cards.length });
  manifest.totalCards += cards.length;
  console.log(`  ${t.year} ${t.host}: ${cards.length} cards`);
}

/* --- countries.json --------------------------------------------------- */
const FLAGS = {
  'Argentina': { flag: '🇦🇷', primary: '#6cb1e1', secondary: '#ffffff' },
  'Brazil': { flag: '🇧🇷', primary: '#ffd700', secondary: '#009b3a' },
  'Italy': { flag: '🇮🇹', primary: '#0066b3', secondary: '#ffffff' },
  'West Germany': { flag: '🇩🇪', primary: '#111111', secondary: '#dd0000' },
  'Germany': { flag: '🇩🇪', primary: '#111111', secondary: '#dd0000' },
  'Uruguay': { flag: '🇺🇾', primary: '#5b9bd5', secondary: '#ffffff' },
  'England': { flag: '🏴', primary: '#ffffff', secondary: '#cf142b' },
  'Peru': { flag: '🇵🇪', primary: '#d91023', secondary: '#ffffff' },
  'France': { flag: '🇫🇷', primary: '#0055a4', secondary: '#ef4135' },
  'Belgium': { flag: '🇧🇪', primary: '#c8102e', secondary: '#fdda24' },
  'Croatia': { flag: '🇭🇷', primary: '#d11e2a', secondary: '#ffffff' },
  'Netherlands': { flag: '🇳🇱', primary: '#ff6200', secondary: '#21468b' },
  'Turkey': { flag: '🇹🇷', primary: '#e30a17', secondary: '#ffffff' },
  'South Korea': { flag: '🇰🇷', primary: '#cd2e3a', secondary: '#0047a0' },
  'Spain': { flag: '🇪🇸', primary: '#aa151b', secondary: '#f1bf00' },
  'Colombia': { flag: '🇨🇴', primary: '#fcd116', secondary: '#003893' },
  'Morocco': { flag: '🇲🇦', primary: '#c1272d', secondary: '#006233' },
  'Portugal': { flag: '🇵🇹', primary: '#da291c', secondary: '#046a38' },
};
const countries = {};
for (const c of [...countriesUsed].sort()) {
  countries[c] = FLAGS[c] || { flag: '🏳️', primary: '#888888', secondary: '#cccccc' };
}
fs.writeFileSync(path.join(DATA, 'countries.json'), JSON.stringify(countries, null, 2) + '\n');

/* --- manifest.json ---------------------------------------------------- */
manifest.tournaments.sort((a, b) => a.year - b.year);
fs.writeFileSync(path.join(DATA, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`\nTotal: ${manifest.totalCards} cards across ${manifest.tournaments.length} tournaments.`);
console.log(`Countries: ${Object.keys(countries).length}`);
