# World Cup U ⚽🏆

A web-based World Cup **card-collection game**. Open three packs, decide
**KEEP** or **DISCARD** on each card one at a time, then assemble an 11-player
XI from everything you kept. Your roster's Attack and Defend ratings decide how
deep your tournament run goes — from *Did Not Qualify* all the way to *World Cup
Champion*. Every kept card lands in your permanent **Binder**.

Built per [`requirements`](#) as vanilla **HTML/CSS/JS** with no framework, all
data loaded from JSON at runtime, and deployable straight to **GitHub Pages**.

---

## Play

Any static file server works (the game only needs to `fetch` the JSON in
`data/`). From the repo root:

```bash
npm run serve        # -> http://localhost:8080
# or
python3 -m http.server 8080
```

Then open the URL. No build step, no dependencies to run the game itself.
To deploy: push to GitHub and enable **Pages** for the branch — the root
`index.html` is the entry point.

---

## Game loop

1. **PLAY** → open Pack 1, reveal 10 cards one at a time; KEEP or DISCARD each
   before the next is shown.
2. Repeat for Pack 2 and Pack 3 (30 cards seen total).
3. **Build your XI** — drag or tap kept cards into the formation:
   `1 GK · 4 DEF · 3 MID · 2 FWD · 1 MID/FWD flex`.
   - Position must match the slot (the flex slot takes MID *or* FWD).
   - One slot per player **name** (no two versions of the same player).
4. **SUBMIT** → see your Attack/Defend ratings (45–99, Madden-style) and the
   tournament outcome tier.
5. All kept cards — used or not — deposit into your Binder. Discards are gone
   for that session.

If you can't field a legal XI (e.g. you kept no goalkeeper) you may submit for a
**Did Not Qualify** result or cancel — either way the cards still deposit.

---

## Architecture

```
worldcup-u/
├── index.html              UI shell
├── README.md
├── validate.js             data-integrity checks (run in CI)
├── package.json            convenience scripts
├── css/
│   └── game.css
├── js/
│   ├── rules.js            scoring constants, rarity criteria, formation, pack rules
│   ├── scoring.js          card + team scoring, outcome tiers, ratings
│   ├── pack-engine.js      seedable pack composition (position → rarity rolls)
│   ├── data-loader.js      fetches JSON at runtime
│   ├── collection.js       localStorage binder + session history
│   └── game.js             screens, session state, UI rendering
├── data/
│   ├── manifest.json       index of tournaments
│   ├── calibration.json    Monte-Carlo outcome breakpoints + rating ranges
│   ├── countries.json      flag + colour metadata
│   └── tournaments/*.json   one file per World Cup (generated)
├── tools/
│   ├── rosters.js          human-authored squad data (real players)
│   ├── generate-data.js    compiles rosters → data/*.json
│   └── simulate.js         Monte-Carlo calibration → data/calibration.json
└── .github/workflows/
    └── validate.yml
```

The engine modules (`rules`, `scoring`, `pack-engine`) are pure and run in both
the browser (via `window.WCU.*`) and Node (via `module.exports`), so the
validator and simulator share the exact same logic the game uses.

### State separation

- `state.session` — current game, **memory only**. Never written mid-session
  (no save-scumming).
- `state.collection` — persisted to `localStorage` once per finished session.
  Export/Import JSON backups from the **Stats** screen (5 MB browser budget).

---

## Data pipeline

Card identities (name, country, year, position, tournament stage, honors) are
**human-authored** in `tools/rosters.js` for real World Cup squads. Exact
match-level stats are **synthesized deterministically** from a hash of each card
id, so the dataset is fully reproducible. Rarity is then derived purely by the
algorithm in `rules.js` — never hand-tagged.

```bash
npm run generate     # rosters.js      -> data/tournaments/*.json, manifest, countries
npm run simulate     # 200k Monte-Carlo -> data/calibration.json
npm run validate     # data integrity + distribution check
npm run build        # all three in order
```

### Rarity tiers (derived, any one criterion qualifies)

| Tier | Criteria |
|------|----------|
| **Iconic** | Winner + Golden Ball · or Winner with 5+ goals · or Winner who started at 35+ |
| **Legendary** | Tournament winner (starter) · Golden Ball · Golden Boot · scored in the final |
| **Rare** | Finalist starter · All-Tournament selection · Semifinalist with 3+ goals |
| **Uncommon** | Semifinalist starter · QF starter with 2+ G/A · GK with 3+ clean sheets |
| **Common** | everyone else |

### Pack composition

Each pack is 10 cards: exactly **1 GK**, **3–4 DEF**, **3 MID**, **2–3 FWD**.
Position is rolled first, then rarity conditional on slot index (cards 1–7 lean
Common/Uncommon, 8–9 Uncommon/Rare, card 10 the "stud" is Rare→Iconic), plus a
3% Common→Uncommon and 1% Uncommon→Rare pack-wide upgrade. No duplicate player
within a single pack; duplicates across packs (and in your binder, shown `×N`)
are allowed.

### Outcome calibration

`tools/simulate.js` runs 200,000 Monte-Carlo sessions (open 3 packs → build the
best legal XI → score) and writes percentile breakpoints to
`data/calibration.json`. Because `evaluateOutcome` maps percentile bands to
tiers, the realized probabilities track the design targets by construction:

| Outcome | Target | Simulated |
|---------|-------:|----------:|
| World Cup Champion | ~5% | 5% |
| Finalist | ~7% | 7% |
| Semifinalist | ~10% | 10% |
| Quarterfinalist | ~15% | 15% |
| Round of 16 | ~25% | 25% |
| Group Stage (3rd) | ~25% | 25% |
| Group Stage (4th) | ~13% | 13% |

---

## Dataset scope

This build ships a **curated marquee subset** — the deepest-run squads of the
headline teams across **6 World Cups** (1970, 1986, 1998, 2002, 2014, 2022),
**464 cards** over **18 countries**, including the iconic chase cards (Pelé '70,
Maradona '86, Ronaldo '02, Messi '22, …). Because it's curated to strong teams,
the rarity mix skews richer than the full-pool target in the spec.

The pipeline is built to scale to the full ~5,500-card scope: add a tournament
(or more teams) to `tools/rosters.js`, run `npm run build`, and commit. The CI
workflow regenerates the data and fails if the committed JSON is out of sync.

---

## Roadmap (architected for, not yet built)

Set chase collections, a daily free pack, a guaranteed-Legendary+ trophy pack
for winning the World Cup, streak tracking, and a post-game share card. The data
model and collection schema already leave room for these.

## License

MIT.
