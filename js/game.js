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
        <div class="tag">Open 3 decks · build your XI · win the World Cup</div>
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
      if (!confirm('Leave this session? You will lose this draw — nothing is added to your collection until you submit an XI.')) return;
      S.session = null;
    }
    showMenu();
  }

  /* =====================================================================
   * SESSION FLOW
   * Open three decks and swipe through every card — nothing is committed during
   * the reveal. All 30 cards land in your pool, then you build a 4-3-3 XI from
   * any combination. Seeing everything first means you can always field a team.
   * =================================================================== */
  function startSession() {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const decks = PackEngine.openSession(S.data.cards, seed);
    S.session = {
      seed, decks,
      deckIndex: 0, cardIndex: 0,
      pool: [],          // [{uid, card}] every revealed card — all usable
      slots: {},         // formation slot id -> uid
      phase: 'reveal',
    };
    showDeckIcon();
  }

  const totalCards = () => Rules.NUM_PACKS * Rules.PACK_SIZE;
  const revealedCount = () => S.session.pool.length;

  /* --- reveal ----------------------------------------------------------- */
  function showDeckIcon() {
    const ses = S.session;
    topbar(`Deck ${ses.deckIndex + 1} of ${Rules.NUM_PACKS}`, `${revealedCount()}/${totalCards()}`);
    screenEl().innerHTML = `
      <div class="pack-stage">
        ${revealHud()}
        <div class="pack-icon" id="pack-icon">
          <div class="pk-emoji">🎴</div>
          <div class="pk-label">DECK ${ses.deckIndex + 1}</div>
        </div>
        <p class="muted center">Tap to open · swipe through all 10 cards · they all join your pool for team building</p>
      </div>`;
    $('#pack-icon').onclick = () => { ses.cardIndex = 0; revealCard(); };
  }

  function revealHud() {
    const pct = (revealedCount() / totalCards()) * 100;
    return `
      <div style="width:100%">
        <div class="hud">
          <span class="pill">Deck <b>${S.session.deckIndex + 1}</b> / ${Rules.NUM_PACKS}</span>
          <span class="pill">Players: <b>${revealedCount()}</b> / ${totalCards()}</span>
        </div>
        <div class="progress"><i style="width:${pct}%"></i></div>
      </div>`;
  }

  function revealCard() {
    const ses = S.session;
    const deck = ses.decks[ses.deckIndex];
    const card = deck[ses.cardIndex];
    const lastInDeck = ses.cardIndex >= deck.length - 1;
    const lastDeck = ses.deckIndex >= Rules.NUM_PACKS - 1;
    const nextLabel = lastInDeck ? (lastDeck ? 'BUILD YOUR XI →' : `OPEN DECK ${ses.deckIndex + 2} →`) : 'NEXT ›';
    topbar(`Deck ${ses.deckIndex + 1} of ${Rules.NUM_PACKS}`, `Card ${ses.cardIndex + 1}/${deck.length}`);
    screenEl().innerHTML = `
      <div class="pack-stage">
        ${revealHud()}
        <div class="reveal-area">
          <div id="card-host" class="flip-in">${cardHTML(card)}</div>
          <div class="kd-buttons">
            <button class="btn" id="btn-next">${nextLabel}</button>
          </div>
          <p class="muted center" style="margin-top:8px">Tap the card or NEXT to continue</p>
        </div>
        ${revealStrip()}
      </div>`;
    $('#btn-next').onclick = advanceReveal;
    $('#card-host').onclick = advanceReveal;
  }

  function revealStrip() {
    const pool = S.session.pool;
    if (!pool.length) return `<div class="reveal-strip"><div class="rs-label">Revealed players collect here</div></div>`;
    const chips = pool.slice().reverse().map(({ card }) => {
      const { primary } = colorsOf(card.country);
      return `<span class="rs-chip" style="background:${primary};color:${inkOn(primary)}" title="${esc(card.name)}">${flagOf(card.country)}<i>${card.position}</i></span>`;
    }).join('');
    return `<div class="reveal-strip"><div class="rs-label">Your players (${pool.length})</div><div class="rs-row">${chips}</div></div>`;
  }

  function advanceReveal() {
    const ses = S.session;
    const deck = ses.decks[ses.deckIndex];
    const card = deck[ses.cardIndex];
    ses.pool.push({ uid: ses.pool.length, card });
    const host = $('#card-host'); if (host) { host.onclick = null; host.classList.add('kept-fly'); }
    const btn = $('#btn-next'); if (btn) btn.disabled = true;
    setTimeout(() => {
      ses.cardIndex++;
      if (ses.cardIndex >= deck.length) {
        ses.deckIndex++;
        if (ses.deckIndex >= Rules.NUM_PACKS) startBuild();
        else showDeckIcon();
      } else {
        revealCard();
      }
    }, 300);
  }

  /* =====================================================================
   * BUILD — assemble a 4-3-3 from the full 30-card pool.
   * Tap a player to drop them into the first open slot of their position;
   * tap a player already on the pitch to remove them. Swap freely, submit at 11.
   * =================================================================== */
  const ROW_TOP = [88, 67, 45, 22];

  function startBuild() {
    S.session.phase = 'build';
    S.session.slots = {};
    showBuild();
  }

  function poolCard(uid) { const e = S.session.pool[uid]; return e && e.card; }
  function xiCount() { return Object.keys(S.session.slots).length; }
  function xiComplete() { return Rules.FORMATION.every((s) => S.session.slots[s.id] != null); }
  function isPlaced(uid) { for (const k in S.session.slots) if (S.session.slots[k] === uid) return true; return false; }
  function nameInXI(name) {
    for (const sid in S.session.slots) {
      const c = poolCard(S.session.slots[sid]);
      if (c && c.name === name) return true;
    }
    return false;
  }
  function firstOpenSlot(pos) {
    return Rules.FORMATION.find((s) => s.position === pos && S.session.slots[s.id] == null);
  }
  function shake(el) { el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 320); }

  function showBuild() {
    const ses = S.session;
    topbar('Build your XI', `${xiCount()}/11`);

    const slotsHTML = Rules.FORMATION.map((slot) => {
      const left = (slot.col + 0.5) * 20, top = ROW_TOP[slot.row];
      const uid = ses.slots[slot.id];
      const filled = uid != null;
      const inner = filled ? miniCardHTML(poolCard(uid)) : `<span>${slot.label}</span>`;
      return `<div class="slot ${filled ? 'filled' : ''}" data-slot="${slot.id}" style="left:${left}%;top:${top}%">
                <div class="dot">${inner}</div>
                ${filled ? '' : `<div class="slot-label">${slot.label}</div>`}
              </div>`;
    }).join('');

    const placed = new Set(Object.values(ses.slots));
    let poolHTML = '';
    for (const pos of Rules.GROUP_ORDER) {
      const items = ses.pool.filter((e) => e.card.position === pos);
      if (!items.length) continue;
      const haveSlot = !!firstOpenSlot(pos);
      const cards = items.map((e) => {
        const isP = placed.has(e.uid);
        const dup = !isP && nameInXI(e.card.name);
        return `<div class="pool-card ${isP ? 'placed' : ''} ${dup ? 'dup' : ''}" data-uid="${e.uid}">${miniCardHTML(e.card)}</div>`;
      }).join('');
      poolHTML += `<div class="pool-group">
          <div class="pg-head"><span>${pos}</span><span class="muted">${Rules.POSITION_GROUPS[pos]} in XI${haveSlot ? '' : ' · full'}</span></div>
          <div class="pool-row">${cards}</div>
        </div>`;
    }

    screenEl().innerHTML = `
      <div class="pitch build-pitch">${slotsHTML}</div>
      <div class="build-bar">
        <button class="btn green" id="submit" ${xiComplete() ? '' : 'disabled'}>SUBMIT XI · ${xiCount()}/11</button>
        <button class="btn ghost" id="clear">Clear</button>
      </div>
      <div class="section-label">Your players · tap to add · tap a player on the pitch to remove</div>
      <div class="pool">${poolHTML}</div>`;

    wireBuild();
  }

  function wireBuild() {
    const ses = S.session;
    screenEl().querySelectorAll('.pool-card').forEach((el) => {
      const uid = +el.dataset.uid;
      el.onclick = () => {
        if (isPlaced(uid)) { toast('Already in your XI — tap them on the pitch to remove'); return; }
        const card = poolCard(uid);
        if (nameInXI(card.name)) { shake(el); toast(`${card.name} is already on your team`); return; }
        const slot = firstOpenSlot(card.position);
        if (!slot) { shake(el); toast(`All ${card.position} slots are full`); return; }
        ses.slots[slot.id] = uid;
        showBuild();
      };
    });
    screenEl().querySelectorAll('.slot').forEach((el) => {
      el.onclick = () => {
        const sid = el.dataset.slot;
        if (ses.slots[sid] != null) { delete ses.slots[sid]; showBuild(); }
      };
    });
    const submit = $('#submit'); if (submit) submit.onclick = submitXI;
    const clear = $('#clear'); if (clear) clear.onclick = () => { ses.slots = {}; showBuild(); };
  }

  function submitXI() {
    const ses = S.session;
    if (!xiComplete()) { toast('Fill all 11 slots'); return; }
    const placements = Rules.FORMATION.map((slot) => {
      const card = poolCard(ses.slots[slot.id]);
      return { card, position: card.position, slot };
    });
    const team = Scoring.scoreTeam(placements);
    const evald = Scoring.evaluateOutcome(team, S.data.calibration);
    const result = Object.assign({ team, placements }, evald);

    const xiIds = placements.map((p) => p.card.id);
    Collection.depositSession(S.collection, {
      keptIds: xiIds,
      outcome: result.outcome,
      outcomeLabel: result.outcomeLabel,
      attackRating: result.attackRating,
      defendRating: result.defendRating,
      teamSnapshot: xiIds,
    });
    ses.phase = 'done';
    ses.result = result;
    showResult(result);
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
        <li>Open <b>3 decks</b> and swipe through all 10 cards in each. Nothing is locked in — every card joins your pool.</li>
        <li>Build a <b>4-3-3 XI</b> (1 GK, 4 DEF, 3 MID, 3 FWD) from <b>any mix</b> of your 30 players. Tap a player to add them; tap a player on the pitch to remove. One per <b>name</b>.</li>
        <li>Card <b>rarity is hidden</b> while you play — judge on stats and honors, not on a colour.</li>
        <li><b>SUBMIT</b> for your <b>Attack & Defend</b> ratings and tournament result.</li>
        <li>The XI you field lands in your <b>Binder</b>, where rarity is revealed.</li>
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
