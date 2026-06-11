/* =============================================================================
 * game.js — UI rendering, session state, screen routing.
 *
 * Depends on WCU.Rules, WCU.Scoring, WCU.PackEngine, WCU.Data, WCU.Collection.
 * Single in-memory session; collection persisted only when a session ends.
 * ========================================================================== */
(function (root) {
  'use strict';
  const { Rules, Scoring, PackEngine, Data, Collection } = root.WCU;

  /* --- tiny DOM helpers ------------------------------------------------- */
  const $ = (sel) => document.querySelector(sel);
  const screenEl = () => $('#screen');
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  /* --- global state ----------------------------------------------------- */
  const S = {
    data: null,
    collection: null,
    session: null,
    route: 'menu',
  };

  function flagOf(country) {
    const c = S.data.countries[country];
    return (c && c.flag) || '🏳️';
  }

  /* --- country colour skinning ----------------------------------------- */
  function colorsOf(country) {
    const c = S.data.countries[country] || {};
    return { primary: c.primary || '#3a4570', secondary: c.secondary || '#1f2950' };
  }
  // Relative luminance of a #rrggbb colour (0 dark … 1 light).
  function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 0.5;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  // Readable ink colour for text sitting on `bg`.
  function inkOn(bg) { return luminance(bg) > 0.6 ? '#0b1020' : '#ffffff'; }

  /* =====================================================================
   * Card rendering
   * =================================================================== */
  function statRows(card) {
    const s = card.stats || {};
    const r = (k, v) => `<div class="k">${k}</div><div class="v">${v}</div>`;
    switch (card.position) {
      case 'GK':
        return r('Matches', s.matches) + r('Clean sheets', s.cleanSheets) +
               r('Saves/game', s.savesPerGame) + r('Goals against', s.goalsAgainst);
      case 'DEF':
        return r('Matches', s.matches) + r('Tackles/game', s.tacklesPerGame) +
               r('Intercept/game', s.interceptionsPerGame) + r('Clean sheets', s.cleanSheets) +
               r('Goals', s.goalsScored);
      case 'MID':
        return r('Matches', s.matches) + r('Goals', s.goals) + r('Assists', s.assists) +
               r('Key passes/game', s.keyPassesPerGame) + r('Tackles/game', s.tacklesPerGame);
      case 'FWD':
        return r('Matches', s.matches) + r('Goals', s.goals) + r('Assists', s.assists) +
               r('Shots on target', s.shotsOnTarget) + r('Mins/goal', s.minutesPerGoal);
      default: return '';
    }
  }

  function honorBadges(card) {
    const h = card.honors || {};
    const b = [];
    if (h.tournamentWinner) b.push('🏆 Champion');
    else if (h.finalist) b.push('Finalist');
    else if (h.semifinalist) b.push('Semifinalist');
    if (h.goldenBall) b.push('Golden Ball');
    if (h.goldenBoot) b.push('Golden Boot');
    if (h.allTournament) b.push('All-Tournament');
    if (h.finalGoalscorer) b.push('Final goal');
    return b.map((x) => `<span class="badge">${esc(x)}</span>`).join('');
  }

  // Full card, skinned in the country's colours. Rarity is intentionally NOT
  // shown here — knowing the tier would give away which cards to keep.
  function cardHTML(card) {
    const { primary, secondary } = colorsOf(card.country);
    const headInk = inkOn(primary);
    const style = `border-color:${primary};box-shadow:0 10px 30px rgba(0,0,0,.5),0 0 0 2px ${secondary} inset`;
    return `
      <div class="card kit" data-id="${card.id}" style="${style}">
        <div class="c-head" style="background:${primary};color:${headInk}">
          <span class="c-flag">${flagOf(card.country)}</span>
          <span class="c-pos" style="border-color:${headInk}">${card.position}</span>
        </div>
        <div class="c-body">
          <div class="c-name">${esc(card.name)}</div>
          <div class="c-sub">${esc(card.country)} · ${card.year} · ${esc(card.stage)}</div>
          <div class="c-stats">${statRows(card)}</div>
          <div class="c-honors">${honorBadges(card)}</div>
        </div>
        <div class="c-stripe" style="background:linear-gradient(90deg,${primary},${secondary})"></div>
      </div>`;
  }

  function miniCardHTML(card, opts) {
    opts = opts || {};
    const { primary, secondary } = colorsOf(card.country);
    const headInk = inkOn(primary);
    const dot = opts.showRarity
      ? `<span class="r-dot" title="${Rules.RARITY_META[card.rarity].label}" style="background:${Rules.RARITY_META[card.rarity].accent}"></span>`
      : '';
    return `
      <div class="mini-card kit" style="border-color:${primary}">
        ${dot}
        <div class="m-top" style="background:${primary};color:${headInk}">
          <span class="m-flag">${flagOf(card.country)}</span><span>${card.position}</span>
        </div>
        <div class="m-name">${esc(opts.hideName ? '???' : card.name)}</div>
        <div class="m-bot" style="border-top:2px solid ${secondary}"><span>${card.year}</span><span>${keyStat(card)}</span></div>
      </div>`;
  }

  function keyStat(card) {
    const s = card.stats || {};
    switch (card.position) {
      case 'GK': return `${s.cleanSheets}CS`;
      case 'DEF': return `${s.tacklesPerGame}T`;
      case 'MID': return `${s.goals}G`;
      case 'FWD': return `${s.goals}G`;
      default: return '';
    }
  }

  /* =====================================================================
   * MENU
   * =================================================================== */
  function showMenu() {
    S.route = 'menu';
    $('#topbar').classList.add('hidden');
    const st = S.collection.stats;
    screenEl().innerHTML = `
      <div class="menu">
        <div class="trophy">🏆</div>
        <div class="logo">FIFA Card Collector</div>
        <h1>World Cup U</h1>
        <div class="tag">Open packs · build your XI live · win the World Cup</div>
        <div class="actions">
          <button class="btn lg green" id="m-play">▶ PLAY</button>
          <button class="btn ghost" id="m-binder">📒 Binder</button>
          <button class="btn ghost" id="m-stats">📊 Stats</button>
          <button class="btn ghost" id="m-help">❔ How to play</button>
        </div>
        <div class="stat-strip">
          <span><b>${st.sessionsPlayed}</b> played</span>
          <span><b>${st.championships}</b> 🏆</span>
          <span><b>${st.uniqueCardsCollected}</b>/${S.data.cards.length} cards</span>
        </div>
      </div>`;
    $('#m-play').onclick = startSession;
    $('#m-binder').onclick = showBinder;
    $('#m-stats').onclick = showStats;
    $('#m-help').onclick = showHelp;

    if (!localStorage.getItem('worldcup-u.seen-intro')) {
      localStorage.setItem('worldcup-u.seen-intro', '1');
      showHelp();
    }
  }

  function topbar(title, rightText) {
    const tb = $('#topbar');
    tb.classList.remove('hidden');
    $('#topbar-title').textContent = title;
    $('#topbar-right').textContent = rightText || '';
    $('#btn-home').onclick = confirmLeaveToMenu;
  }

  function confirmLeaveToMenu() {
    if (S.session && S.session.phase !== 'done') {
      if (!confirm('Leave this session? Cards you have kept so far will still be deposited to your collection.')) return;
      // Treat as cancel: deposit kept cards, no result recorded as a played session? Spec: cancel deposits cards.
      depositAndEnd('cancelled');
    }
    showMenu();
  }

  /* =====================================================================
   * SESSION START — roll up to 3 packs; assign players to the team key as you
   * flip. Groups lock when full; the result fires the moment the XI is full
   * (or the cards run out).
   * =================================================================== */
  function startSession() {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const packs = PackEngine.openSession(S.data.cards, seed);
    S.session = {
      seed, packs,
      packIndex: 0, cardIndex: 0,
      groups: { GK: [], DEF: [], MID: [], FWD: [] }, // assigned cards by group
      kept: [],            // flat list of assigned cards (for deposit)
      packAssigned: 0, packDeclined: 0,
      phase: 'opening',
    };
    showPackIcon();
  }

  const cap = (pos) => Rules.POSITION_GROUPS[pos];
  const squadCount = () => S.session.kept.length;
  const squadFull = () => squadCount() >= 11;
  function nameOnTeam(name) {
    return S.session.kept.some((c) => c.name === name);
  }
  // How a card may interact with its position group right now.
  function assignState(card) {
    const g = S.session.groups[card.position];
    if (g.length >= cap(card.position)) return 'full';   // group locked
    if (nameOnTeam(card.name)) return 'dup';             // player already in XI
    return 'open';                                        // assignable
  }

  function seenCount() {
    let n = 0;
    for (let p = 0; p < S.session.packIndex; p++) n += S.session.packs[p].length;
    n += S.session.cardIndex;
    return n;
  }
  const totalCards = () => Rules.NUM_PACKS * Rules.PACK_SIZE;

  function showPackIcon() {
    const ses = S.session;
    topbar(`Pack ${ses.packIndex + 1} of ${Rules.NUM_PACKS}`, `XI ${squadCount()}/11`);
    screenEl().innerHTML = `
      <div class="pack-stage">
        ${hudHTML()}
        <div class="pack-icon" id="pack-icon">
          <div class="pk-emoji">🎴</div>
          <div class="pk-label">PACK ${ses.packIndex + 1}</div>
        </div>
        <p class="muted center">Tap the pack to open · 10 cards · assign each to your XI or decline</p>
      </div>`;
    $('#pack-icon').onclick = () => { ses.cardIndex = 0; ses.packAssigned = 0; ses.packDeclined = 0; revealCard(); };
  }

  function hudHTML() {
    const pct = (squadCount() / 11) * 100;
    return `
      <div style="width:100%">
        <div class="hud">
          <span class="pill">Cards seen: <b>${seenCount()}</b> / ${totalCards()}</span>
          <span class="pill">Squad: <b>${squadCount()}</b> / 11</span>
        </div>
        <div class="progress"><i style="width:${pct}%"></i></div>
      </div>`;
  }

  function revealCard() {
    const ses = S.session;
    const pack = ses.packs[ses.packIndex];
    const card = pack[ses.cardIndex];
    const state = assignState(card);
    const hint = state === 'open' ? `Tap ${card.position} below to add`
               : state === 'full' ? `${card.position} is full — decline`
               : 'Already on your team — decline';
    topbar(`Pack ${ses.packIndex + 1} of ${Rules.NUM_PACKS}`, `XI ${squadCount()}/11`);
    screenEl().innerHTML = `
      <div class="pack-stage">
        ${hudHTML()}
        <div class="reveal-area">
          <div id="card-host" class="flip-in">${cardHTML(card)}</div>
          <div class="assign-hint ${state}">${hint}</div>
          <div class="kd-buttons">
            <button class="btn red" id="btn-decline">DECLINE</button>
          </div>
        </div>
        ${teamKeyHTML(card)}
      </div>`;
    $('#btn-decline').onclick = () => resolveCard(null);
    wireTeamKey(card);
  }

  /* The anchored team key: 4 position groups with capacity pips. The current
   * card's group lights up; tapping it assigns the card. */
  function teamKeyHTML(card) {
    const groups = Rules.GROUP_ORDER.map((pos) => {
      const assigned = S.session.groups[pos];
      const capacity = cap(pos);
      const isCurrent = card && card.position === pos;
      const state = isCurrent ? assignState(card) : '';
      const cls = ['key-group'];
      if (isCurrent) cls.push('lit', 'lit-' + state);
      if (assigned.length >= capacity) cls.push('full');

      let pips = '';
      for (let i = 0; i < capacity; i++) {
        const c = assigned[i];
        pips += c
          ? `<span class="pip on" style="background:${colorsOf(c.country).primary};color:${inkOn(colorsOf(c.country).primary)}">${flagOf(c.country)}</span>`
          : `<span class="pip"></span>`;
      }
      const tag = isCurrent && state === 'open' ? '＋'
                : isCurrent && state === 'full' ? '🔒'
                : isCurrent && state === 'dup' ? '⛔' : '';
      return `<div class="${cls.join(' ')}" data-group="${pos}">
                <div class="kg-head"><span class="kg-label">${pos}</span><span class="kg-count">${assigned.length}/${capacity}</span><span class="kg-tag">${tag}</span></div>
                <div class="kg-pips">${pips}</div>
              </div>`;
    }).join('');
    return `<div class="team-key"><div class="tk-title">YOUR XI · tap a glowing position to add</div><div class="tk-groups">${groups}</div></div>`;
  }

  function wireTeamKey(card) {
    screenEl().querySelectorAll('.key-group').forEach((el) => {
      const pos = el.dataset.group;
      el.onclick = () => {
        if (card.position !== pos) { toast(`That's a ${card.position} — add to ${card.position}`); return; }
        const state = assignState(card);
        if (state === 'full') { shake(el); toast(`${pos} is full`); return; }
        if (state === 'dup') { shake(el); toast(`${card.name} is already on your team`); return; }
        resolveCard(pos);
      };
    });
  }

  function shake(el) { el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 320); }

  // Resolve the current card: assign to `pos` (group) or decline (pos == null).
  function resolveCard(pos) {
    const ses = S.session;
    const pack = ses.packs[ses.packIndex];
    const card = pack[ses.cardIndex];
    const host = $('#card-host');

    if (pos) {
      ses.groups[pos].push(card);
      ses.kept.push(card);
      ses.packAssigned++;
      host.classList.add('kept-fly');
    } else {
      ses.packDeclined++;
      host.classList.add('discard-fade');
    }
    const decline = $('#btn-decline'); if (decline) decline.disabled = true;

    setTimeout(() => {
      // XI complete -> straight to the result, no matter how many cards remain.
      if (squadFull()) { finalize(); return; }
      ses.cardIndex++;
      if (ses.cardIndex >= pack.length) {
        const last = ses.packIndex >= Rules.NUM_PACKS - 1;
        if (last) finalize();          // out of cards
        else showPackSummary();
      } else {
        revealCard();
      }
    }, 320);
  }

  function showPackSummary() {
    const ses = S.session;
    topbar(`Pack ${ses.packIndex + 1} complete`);
    screenEl().innerHTML = `
      <div class="summary">
        <h2>Pack ${ses.packIndex + 1} complete</h2>
        <div class="big">＋ ${ses.packAssigned} &nbsp; ✕ ${ses.packDeclined}</div>
        <p class="muted">Added ${ses.packAssigned}, declined ${ses.packDeclined}. Squad so far: <b>${squadCount()}</b> / 11.</p>
        <div class="mt"><button class="btn lg" id="next">Open Pack ${ses.packIndex + 2} →</button></div>
      </div>`;
    $('#next').onclick = () => { ses.packIndex++; showPackIcon(); };
  }

  /* =====================================================================
   * FINALIZE + RESULT
   * The XI is built live during the flip. When it's full (or the cards run
   * out) we score it straight away — no separate build screen.
   * =================================================================== */
  const ROW_TOP = [88, 67, 45, 22];

  // Pair the assigned cards with on-pitch formation slots, in group order.
  function buildPlacements() {
    const ses = S.session;
    const queue = { GK: ses.groups.GK.slice(), DEF: ses.groups.DEF.slice(),
                    MID: ses.groups.MID.slice(), FWD: ses.groups.FWD.slice() };
    const placements = [];
    for (const slot of Rules.FORMATION) {
      const card = queue[slot.position].shift();
      if (card) placements.push({ card, position: card.position, slot });
    }
    return placements;
  }

  function missingPositions() {
    const need = Rules.POSITION_REQUIREMENTS;
    const out = [];
    for (const pos of Rules.GROUP_ORDER) {
      const have = S.session.groups[pos].length;
      if (have < need[pos]) out.push(`${need[pos] - have} ${pos}`);
    }
    return out;
  }

  function finalize() {
    const ses = S.session;
    let result;
    if (squadFull()) {
      const placements = buildPlacements();
      const team = Scoring.scoreTeam(placements);
      const evald = Scoring.evaluateOutcome(team, S.data.calibration);
      result = Object.assign({ team, placements }, evald);
    } else {
      result = {
        outcome: 'dnq', outcomeLabel: 'Did Not Qualify',
        attackRating: null, defendRating: null, percentile: 0,
        team: { attack: 0, defend: 0, total: 0 },
        placements: buildPlacements(),
        missing: missingPositions(),
      };
    }

    // Deposit + record once, at session end.
    const keptIds = ses.kept.map((c) => c.id);
    const teamSnapshot = result.placements.map((p) => p.card.id);
    Collection.depositSession(S.collection, {
      keptIds,
      outcome: result.outcome,
      outcomeLabel: result.outcomeLabel,
      attackRating: result.attackRating,
      defendRating: result.defendRating,
      teamSnapshot,
    });
    ses.phase = 'done';
    ses.result = result;
    showResult(result);
  }

  function depositAndEnd(reason) {
    // Used for cancel / leave: deposit kept cards but DON'T record a session result.
    const ses = S.session;
    if (!ses || ses.phase === 'done') { S.session = null; return; }
    const now = new Date().toISOString();
    for (const c of ses.kept) {
      if (!S.collection.collection[c.id]) S.collection.collection[c.id] = { owned: 0, firstSeen: now };
      S.collection.collection[c.id].owned += 1;
    }
    S.collection.stats.totalCardsCollected += ses.kept.length;
    S.collection.stats.uniqueCardsCollected = Object.keys(S.collection.collection).length;
    Collection.save(S.collection);
    if (ses.kept.length) toast(`${ses.kept.length} cards deposited to your binder`);
    ses.phase = 'done';
    S.session = null;
  }

  function showResult(result) {
    topbar('Result');
    const dnq = result.outcome === 'dnq';
    const tierClass = dnq ? 'tier-dnq' : `tier-${result.outcome}`;
    const ratings = dnq
      ? `<p class="muted">You couldn't complete a full XI${result.missing && result.missing.length ? ` (short ${result.missing.join(', ')})` : ''}, so your squad did not qualify. Every player you added is still yours to keep.</p>`
      : `<div class="ratings">
           <div class="rating-box attack"><div class="rlabel">ATTACK</div><div class="rval">${result.attackRating}</div></div>
           <div class="rating-box defend"><div class="rlabel">DEFEND</div><div class="rval">${result.defendRating}</div></div>
         </div>
         <div class="meta">Team total ${result.team.total} · top ${Math.round((1 - result.percentile) * 100)}% of simulated squads</div>`;

    // On-pitch layout of the placed XI.
    const slots = (result.placements || []).map((p) => {
      const left = (p.slot.col + 0.5) * 20;
      const top = ROW_TOP[p.slot.row];
      return `<div class="slot filled" data-id="${p.card.id}" style="left:${left}%;top:${top}%">
                <div class="dot">${miniCardHTML(p.card)}</div>
              </div>`;
    }).join('');

    screenEl().innerHTML = `
      <div class="result ${tierClass}">
        <div class="outcome-label">Your tournament ends as</div>
        <div class="outcome">${esc(result.outcomeLabel)}</div>
        ${ratings}
        ${slots ? `<div class="section-label">Your XI</div><div class="pitch result-pitch">${slots}</div>` : ''}
        <div class="grid-2 mt">
          <button class="btn green" id="again">Play again</button>
          <button class="btn ghost" id="tomenu">Main menu</button>
        </div>
        <div class="mt"><button class="btn ghost full" id="tobinder">View binder</button></div>
      </div>`;

    screenEl().querySelectorAll('.result-pitch .slot').forEach((el) => {
      el.onclick = () => openCardModal(S.data.byId[el.dataset.id]);
    });
    $('#again').onclick = () => { S.session = null; startSession(); };
    $('#tomenu').onclick = () => { S.session = null; showMenu(); };
    $('#tobinder').onclick = () => { S.session = null; showBinder(); };
  }

  /* =====================================================================
   * BINDER
   * =================================================================== */
  const binderState = { country: '', year: '', position: '', rarity: '', owned: '', q: '' };

  function showBinder() {
    S.route = 'binder';
    topbar('Binder', `${S.collection.stats.uniqueCardsCollected}/${S.data.cards.length}`);

    const countries = [...new Set(S.data.cards.map((c) => c.country))].sort();
    const years = [...new Set(S.data.cards.map((c) => c.year))].sort();

    const opt = (val, label, sel) => `<option value="${esc(val)}" ${sel === val ? 'selected' : ''}>${esc(label)}</option>`;
    screenEl().innerHTML = `
      <div class="filters">
        <input id="f-q" placeholder="Search name…" value="${esc(binderState.q)}" />
        <select id="f-country"><option value="">All countries</option>${countries.map((c) => opt(c, c, binderState.country)).join('')}</select>
        <select id="f-year"><option value="">All years</option>${years.map((y) => opt(String(y), String(y), binderState.year)).join('')}</select>
        <select id="f-position"><option value="">All positions</option>${Rules.POSITIONS.map((p) => opt(p, p, binderState.position)).join('')}</select>
        <select id="f-rarity"><option value="">All rarities</option>${Rules.RARITIES.map((r) => opt(r, Rules.RARITY_META[r].label, binderState.rarity)).join('')}</select>
        <select id="f-owned"><option value="">All cards</option>${opt('owned', 'Owned only', binderState.owned)}${opt('missing', 'Missing only', binderState.owned)}</select>
      </div>
      <div id="binder-body"></div>`;

    ['f-q', 'f-country', 'f-year', 'f-position', 'f-rarity', 'f-owned'].forEach((id) => {
      const el = $('#' + id);
      const ev = id === 'f-q' ? 'input' : 'change';
      el.addEventListener(ev, () => {
        binderState.q = $('#f-q').value.toLowerCase();
        binderState.country = $('#f-country').value;
        binderState.year = $('#f-year').value;
        binderState.position = $('#f-position').value;
        binderState.rarity = $('#f-rarity').value;
        binderState.owned = $('#f-owned').value;
        renderBinderBody();
      });
    });
    renderBinderBody();
  }

  function filteredCards() {
    return S.data.cards.filter((c) => {
      if (binderState.country && c.country !== binderState.country) return false;
      if (binderState.year && String(c.year) !== binderState.year) return false;
      if (binderState.position && c.position !== binderState.position) return false;
      if (binderState.rarity && c.rarity !== binderState.rarity) return false;
      const own = Collection.owned(S.collection, c.id);
      if (binderState.owned === 'owned' && !own) return false;
      if (binderState.owned === 'missing' && own) return false;
      if (binderState.q && !c.name.toLowerCase().includes(binderState.q)) return false;
      return true;
    }).sort((a, b) =>
      a.country.localeCompare(b.country) || a.year - b.year ||
      Rules.POSITIONS.indexOf(a.position) - Rules.POSITIONS.indexOf(b.position) ||
      a.name.localeCompare(b.name)
    );
  }

  function renderBinderBody() {
    const cards = filteredCards();
    const ownedCount = cards.filter((c) => Collection.owned(S.collection, c.id)).length;

    // Completion meters (respect current country/year filter context).
    let comp = '';
    if (binderState.country) comp += completionRow(binderState.country, (c) => c.country === binderState.country);
    if (binderState.year) comp += completionRow(`${binderState.year} World Cup`, (c) => String(c.year) === binderState.year);
    if (!binderState.country && !binderState.year) comp += completionRow('Overall collection', () => true);

    const grid = cards.map((c) => {
      const own = Collection.owned(S.collection, c.id);
      return `<div class="binder-card ${own ? '' : 'unowned'}" data-id="${c.id}">
                ${miniCardHTML(c, { hideName: !own, showRarity: !!own })}
                ${own > 1 ? `<span class="owned-x">×${own}</span>` : ''}
              </div>`;
    }).join('');

    $('#binder-body').innerHTML = `
      <div class="completion">${comp}</div>
      <div class="binder-stats">${ownedCount}/${cards.length} shown owned · silhouettes are still to be discovered</div>
      <div class="binder-grid">${grid || '<p class="muted">No cards match these filters.</p>'}</div>`;

    $('#binder-body').querySelectorAll('.binder-card').forEach((el) => {
      el.onclick = () => {
        const card = S.data.byId[el.dataset.id];
        const own = Collection.owned(S.collection, card.id);
        if (own) openCardModal(card);
        else openSilhouetteModal(card);
      };
    });
  }

  function completionRow(label, pred) {
    const pool = S.data.cards.filter(pred);
    const owned = pool.filter((c) => Collection.owned(S.collection, c.id)).length;
    const pct = pool.length ? (owned / pool.length) * 100 : 0;
    return `<div class="comp-row"><span>${esc(label)}: <b>${owned} / ${pool.length}</b></span>
              <div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }

  /* =====================================================================
   * MODALS
   * =================================================================== */
  function modal(innerHTML) {
    closeModal();
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal">${innerHTML}</div>`;
    back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
    document.body.appendChild(back);
    const close = back.querySelector('.close');
    if (close) close.onclick = closeModal;
    return back;
  }
  function closeModal() { const m = $('.modal-backdrop'); if (m) m.remove(); }

  function openCardModal(card) {
    const own = Collection.owned(S.collection, card.id);
    const meta = Rules.RARITY_META[card.rarity];
    const used = S.collection.sessions.filter((s) => (s.teamSnapshot || []).includes(card.id));
    const usedHTML = used.length
      ? used.slice(0, 8).map((s) => `<div>${new Date(s.date).toLocaleDateString()} — ${esc(s.outcomeLabel)}</div>`).join('')
      : '<div>Not yet fielded in a submitted XI.</div>';
    modal(`
      <button class="btn ghost close" style="padding:6px 10px">✕</button>
      <h3>${esc(card.name)}</h3>
      <div class="muted">${flagOf(card.country)} ${esc(card.country)} · ${card.year} · ${esc(card.stage)}</div>
      <div class="mt" style="display:flex;justify-content:center">${cardHTML(card)}</div>
      <div class="detail-grid">
        <div class="k">Position</div><div class="v">${card.position}</div>
        <div class="k">Rarity</div><div class="v" style="color:${meta.accent}">${meta.label}</div>
        <div class="k">Owned</div><div class="v">×${own}</div>
        <div class="k">Card score</div><div class="v">${Math.round(Scoring.scoreCard(card))}</div>
      </div>
      <div class="section-label">Fielded in</div>
      <div class="session-list">${usedHTML}</div>
    `);
  }

  function openSilhouetteModal(card) {
    modal(`
      <button class="btn ghost close" style="padding:6px 10px">✕</button>
      <h3>Undiscovered card</h3>
      <div class="muted mt">${flagOf(card.country)} ${esc(card.country)} · ${card.year} · ${card.position}</div>
      <p class="mt">Who is this? Open packs and keep this card to reveal their name and stats.</p>
    `);
  }

  function showHelp() {
    modal(`
      <button class="btn ghost close" style="padding:6px 10px">✕</button>
      <h3>How to play</h3>
      <ol style="line-height:1.6;padding-left:18px">
        <li>Open up to <b>3 packs</b> of 10 cards. Flip them one at a time.</li>
        <li>Your XI sits in the <b>team key</b> at the bottom: 1 GK, 4 DEF, 3 MID, 3 FWD. The card's position lights up — <b>tap it to add</b> the player, or <b>DECLINE</b> to skip. Every choice is final.</li>
        <li>A group <b>locks</b> once it's full, and one slot per player <b>name</b>.</li>
        <li>The instant your XI is complete you get your <b>Attack & Defend</b> ratings and tournament result. Run out of cards first and you <b>Did Not Qualify</b>.</li>
        <li>Every player you added lands in your <b>Binder</b>.</li>
      </ol>
      <button class="btn full mt close">Got it</button>
    `);
  }

  /* =====================================================================
   * STATS
   * =================================================================== */
  function showStats() {
    S.route = 'stats';
    topbar('Stats');
    const st = S.collection.stats;
    const sessions = S.collection.sessions;
    const history = sessions.slice(0, 30).map((s) =>
      `<div class="h-row"><span class="o">${esc(s.outcomeLabel)}</span>
        <span class="muted">${new Date(s.date).toLocaleDateString()}</span>
        <span>${s.attackRating != null ? `A ${s.attackRating} / D ${s.defendRating}` : '—'}</span></div>`
    ).join('') || '<p class="muted">No sessions played yet.</p>';

    screenEl().innerHTML = `
      <div class="stat-cards">
        <div class="stat-card"><div class="num">${st.sessionsPlayed}</div><div class="lbl">Sessions played</div></div>
        <div class="stat-card"><div class="num">${st.championships}</div><div class="lbl">Championships</div></div>
        <div class="stat-card"><div class="num">${st.totalCardsCollected}</div><div class="lbl">Cards collected</div></div>
        <div class="stat-card"><div class="num">${st.uniqueCardsCollected}</div><div class="lbl">Unique cards</div></div>
      </div>
      <div class="grid-2 mt">
        <button class="btn ghost" id="export">⬇ Export backup</button>
        <button class="btn ghost" id="import">⬆ Import backup</button>
      </div>
      <button class="btn ghost full mt" id="reset" style="color:var(--red)">Reset all data</button>
      <div class="history">
        <div class="section-label">Recent sessions</div>
        ${history}
      </div>
      <input type="file" id="import-file" accept="application/json" class="hidden" />`;

    $('#export').onclick = exportBackup;
    $('#import').onclick = () => $('#import-file').click();
    $('#import-file').onchange = importBackup;
    $('#reset').onclick = () => {
      if (confirm('Erase your entire collection and history? This cannot be undone.')) {
        S.collection = Collection.reset();
        toast('Collection reset');
        showStats();
      }
    };
  }

  function exportBackup() {
    const blob = new Blob([Collection.exportJSON(S.collection)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `worldcup-u-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded');
  }

  function importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        S.collection = Collection.importJSON(reader.result);
        toast('Backup restored');
        showStats();
      } catch (err) {
        toast('Import failed: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  /* =====================================================================
   * BOOT
   * =================================================================== */
  async function boot() {
    screenEl().innerHTML = `<div class="loading"><div class="spinner"></div>Loading the card pool…</div>`;
    try {
      S.data = await Data.loadAll();
      S.collection = Collection.load();
      showMenu();
    } catch (err) {
      console.error(err);
      screenEl().innerHTML = `<div class="loading">Failed to load card data.<br><span class="muted">${esc(err.message)}</span></div>`;
    }
  }

  root.WCU.Game = { boot, _state: S };
  document.addEventListener('DOMContentLoaded', boot);
})(typeof self !== 'undefined' ? self : this);
