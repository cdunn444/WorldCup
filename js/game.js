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

  function cardHTML(card) {
    const meta = Rules.RARITY_META[card.rarity];
    return `
      <div class="card r-${card.rarity}" data-id="${card.id}">
        <div class="c-foil"></div>
        <div class="c-top">
          <span class="c-flag">${flagOf(card.country)}</span>
          <span class="c-pos">${card.position}</span>
        </div>
        <div class="c-name">${esc(card.name)}</div>
        <div class="c-sub">${esc(card.country)} · ${card.year} · ${esc(card.stage)}</div>
        <div class="c-stats">${statRows(card)}</div>
        <div class="c-honors">${honorBadges(card)}</div>
        <div class="c-rarity">${meta.label}</div>
      </div>`;
  }

  function miniCardHTML(card, opts) {
    opts = opts || {};
    const key = keyStat(card);
    return `
      <div class="mini-card r-${card.rarity}">
        <div class="m-top"><span class="m-flag">${flagOf(card.country)}</span><span>${card.position}</span></div>
        <div class="m-name">${esc(opts.hideName ? '???' : card.name)}</div>
        <div class="m-bot"><span>${card.year}</span><span>${key}</span></div>
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
        <div class="tag">Open packs · keep the legends · field your XI</div>
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
   * SESSION START — roll 3 packs
   * =================================================================== */
  function startSession() {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const packs = PackEngine.openSession(S.data.cards, seed);
    S.session = {
      seed, packs,
      packIndex: 0, cardIndex: 0,
      kept: [],            // array of card objects (dups across packs allowed)
      packKept: 0, packDiscarded: 0,
      phase: 'opening',
    };
    showPackIcon();
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
    topbar(`Pack ${ses.packIndex + 1} of ${Rules.NUM_PACKS}`, `Kept ${ses.kept.length}`);
    screenEl().innerHTML = `
      <div class="pack-stage">
        ${hudHTML()}
        <div class="pack-icon" id="pack-icon">
          <div class="pk-emoji">🎴</div>
          <div class="pk-label">PACK ${ses.packIndex + 1}</div>
        </div>
        <p class="muted center">Tap the pack to open · 10 cards · keep or discard each</p>
      </div>`;
    $('#pack-icon').onclick = () => { ses.cardIndex = 0; ses.packKept = 0; ses.packDiscarded = 0; revealCard(); };
  }

  function hudHTML() {
    const ses = S.session;
    const pct = (seenCount() / totalCards()) * 100;
    return `
      <div style="width:100%">
        <div class="hud">
          <span class="pill">Cards seen: <b>${seenCount()}</b> / ${totalCards()}</span>
          <span class="pill">Kept: <b>${ses.kept.length}</b></span>
        </div>
        <div class="progress"><i style="width:${pct}%"></i></div>
      </div>`;
  }

  function revealCard() {
    const ses = S.session;
    const pack = ses.packs[ses.packIndex];
    const card = pack[ses.cardIndex];
    topbar(`Pack ${ses.packIndex + 1} of ${Rules.NUM_PACKS}`, `Kept ${ses.kept.length}`);
    screenEl().innerHTML = `
      <div class="pack-stage">
        ${hudHTML()}
        <div class="reveal-area">
          <div id="card-host" class="flip-in">${cardHTML(card)}</div>
          <div class="kd-buttons">
            <button class="btn green" id="btn-keep">KEEP</button>
            <button class="btn red" id="btn-discard">DISCARD</button>
          </div>
        </div>
        ${keptTrayHTML()}
      </div>`;
    $('#btn-keep').onclick = () => decide(true);
    $('#btn-discard').onclick = () => decide(false);
    wireThumbs();
  }

  function keptTrayHTML() {
    const ses = S.session;
    if (!ses.kept.length) return `<div class="kept-tray"><div class="tray-label">Kept cards appear here</div></div>`;
    const thumbs = ses.kept.map((c, i) =>
      `<div class="thumb" data-i="${i}" title="${esc(c.name)}">${flagOf(c.country)}<span class="tpos">${c.position}</span></div>`
    ).join('');
    return `<div class="kept-tray"><div class="tray-label">Kept (${ses.kept.length}) · tap to peek</div><div class="thumbs">${thumbs}</div></div>`;
  }

  function wireThumbs() {
    screenEl().querySelectorAll('.thumb').forEach((t) => {
      t.onclick = () => {
        const c = S.session.kept[+t.dataset.i];
        openCardModal(c);
      };
    });
  }

  function decide(keep) {
    const ses = S.session;
    const pack = ses.packs[ses.packIndex];
    const card = pack[ses.cardIndex];
    const host = $('#card-host');
    if (keep) { ses.kept.push(card); ses.packKept++; host.classList.add('kept-fly'); }
    else { ses.packDiscarded++; host.classList.add('discard-fade'); }

    // Disable buttons during the brief animation.
    $('#btn-keep').disabled = true; $('#btn-discard').disabled = true;

    setTimeout(() => {
      ses.cardIndex++;
      if (ses.cardIndex >= pack.length) showPackSummary();
      else revealCard();
    }, 320);
  }

  function showPackSummary() {
    const ses = S.session;
    const last = ses.packIndex >= Rules.NUM_PACKS - 1;
    topbar(`Pack ${ses.packIndex + 1} complete`);
    screenEl().innerHTML = `
      <div class="summary">
        <h2>Pack ${ses.packIndex + 1} complete</h2>
        <div class="big">✅ ${ses.packKept} &nbsp; ❌ ${ses.packDiscarded}</div>
        <p class="muted">Kept ${ses.packKept}, discarded ${ses.packDiscarded}. Total kept so far: <b>${ses.kept.length}</b>.</p>
        <div class="mt"><button class="btn lg" id="next">${last ? 'Build your team →' : 'Open Pack ' + (ses.packIndex + 2) + ' →'}</button></div>
      </div>`;
    $('#next').onclick = () => {
      if (last) startBuild();
      else { ses.packIndex++; showPackIcon(); }
    };
  }

  /* =====================================================================
   * TEAM BUILD
   * =================================================================== */
  function startBuild() {
    const ses = S.session;
    ses.phase = 'build';
    ses.hand = ses.kept.map((card, uid) => ({ uid, card }));
    ses.slots = {};            // slotId -> uid
    ses.selectedUid = null;
    showBuild();
  }

  function positionCounts(cards) {
    const c = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    const seen = { GK: new Set(), DEF: new Set(), MID: new Set(), FWD: new Set() };
    for (const card of cards) seen[card.position] && seen[card.position].add(card.name);
    for (const k in seen) c[k] = seen[k].size;
    return c;
  }

  function canFieldTeam() {
    const c = positionCounts(S.session.kept);
    const need = Rules.POSITION_REQUIREMENTS;
    const flexOk = (c.MID + c.FWD) >= (need.MID + need.FWD + 1);
    return c.GK >= need.GK && c.DEF >= need.DEF && c.MID >= need.MID && c.FWD >= need.FWD && flexOk;
  }

  const ROW_TOP = [88, 67, 45, 22];

  function showBuild() {
    const ses = S.session;
    topbar('Build your XI', `${ses.kept.length} cards`);
    const slotsHTML = Rules.FORMATION.map((slot) => {
      const left = (slot.col + 0.5) * 20;
      const top = ROW_TOP[slot.row];
      const uid = ses.slots[slot.id];
      const filled = uid != null;
      const inner = filled
        ? miniCardHTML(ses.hand[uid].card)
        : `<span>${slot.label}</span>`;
      return `<div class="slot ${filled ? 'filled' : ''}" data-slot="${slot.id}" style="left:${left}%;top:${top}%">
                <div class="dot">${inner}</div>
                <div class="slot-label">${slot.label}</div>
              </div>`;
    }).join('');

    const placedUids = new Set(Object.values(ses.slots));
    const handHTML = ses.hand.map((h) => {
      const placed = placedUids.has(h.uid);
      return `<div class="hand-card ${placed ? 'placed' : ''} ${ses.selectedUid === h.uid ? 'selected' : ''}"
                   data-uid="${h.uid}" draggable="${!placed}">${miniCardHTML(h.card)}</div>`;
    }).join('');

    const complete = isComplete();
    const fieldable = canFieldTeam();

    screenEl().innerHTML = `
      <div class="pitch">${slotsHTML}</div>
      <div class="build-bar">
        <button class="btn green" id="submit" ${complete ? '' : 'disabled'}>SUBMIT TEAM</button>
        <button class="btn ghost" id="clear">Clear</button>
      </div>
      ${!fieldable ? forfeitNoticeHTML() : ''}
      <div class="section-label">Your hand · tap a card then tap a slot (or drag)</div>
      <div class="hand">${handHTML || '<p class="muted">You kept no cards.</p>'}</div>`;

    wireBuild();
  }

  function forfeitNoticeHTML() {
    const c = positionCounts(S.session.kept);
    const need = Rules.POSITION_REQUIREMENTS;
    const missing = [];
    if (c.GK < need.GK) missing.push('a goalkeeper');
    if (c.DEF < need.DEF) missing.push(`${need.DEF} defenders (have ${c.DEF})`);
    if (c.MID < need.MID) missing.push(`${need.MID} midfielders (have ${c.MID})`);
    if (c.FWD < need.FWD) missing.push(`${need.FWD} forwards (have ${c.FWD})`);
    if ((c.MID + c.FWD) < need.MID + need.FWD + 1) missing.push('enough MID/FWD for the flex slot');
    return `
      <div class="hud" style="display:block;border-color:var(--red)">
        <b>Cannot field a full team.</b> You're missing ${missing.join(', ')}.
        <div class="grid-2 mt">
          <button class="btn red" id="dnq">Submit anyway (Did Not Qualify)</button>
          <button class="btn ghost" id="cancel">Cancel session</button>
        </div>
        <div class="muted mt">Either way, your kept cards still deposit to your collection.</div>
      </div>`;
  }

  function isComplete() {
    return Rules.FORMATION.every((s) => S.session.slots[s.id] != null);
  }

  function slotById(id) { return Rules.FORMATION.find((s) => s.id === id); }

  function canPlace(uid, slotId) {
    const ses = S.session;
    const card = ses.hand[uid].card;
    const slot = slotById(slotId);
    if (!slot.accepts.includes(card.position)) return { ok: false, reason: 'Wrong position for this slot' };
    for (const sid in ses.slots) {
      if (sid === slotId) continue;
      const other = ses.hand[ses.slots[sid]];
      if (other && other.card.name === card.name) return { ok: false, reason: 'Already on team' };
    }
    return { ok: true };
  }

  function placeCard(uid, slotId) {
    const ses = S.session;
    // If this card is already in another slot, vacate it.
    for (const sid in ses.slots) if (ses.slots[sid] === uid) delete ses.slots[sid];
    ses.slots[slotId] = uid;
    ses.selectedUid = null;
    showBuild();
  }

  function wireBuild() {
    const ses = S.session;
    // hand selection + drag
    screenEl().querySelectorAll('.hand-card').forEach((el) => {
      const uid = +el.dataset.uid;
      if (el.classList.contains('placed')) return;
      el.onclick = () => { ses.selectedUid = ses.selectedUid === uid ? null : uid; showBuild(); };
      el.ondragstart = (e) => { e.dataTransfer.setData('text/uid', String(uid)); ses.selectedUid = uid; };
    });
    // slots
    screenEl().querySelectorAll('.slot').forEach((el) => {
      const slotId = el.dataset.slot;
      el.onclick = () => {
        const uid = ses.slots[slotId];
        if (uid != null) { delete ses.slots[slotId]; showBuild(); return; } // tap placed card to clear
        if (ses.selectedUid == null) { toast('Pick a card first'); return; }
        tryPlace(ses.selectedUid, slotId, el);
      };
      el.ondragover = (e) => {
        const uid = ses.selectedUid;
        if (uid != null && canPlace(uid, slotId).ok) { e.preventDefault(); el.classList.add('valid-target'); }
      };
      el.ondragleave = () => el.classList.remove('valid-target');
      el.ondrop = (e) => {
        e.preventDefault(); el.classList.remove('valid-target');
        const uid = +(e.dataTransfer.getData('text/uid') || ses.selectedUid);
        tryPlace(uid, slotId, el);
      };
    });

    const submit = $('#submit'); if (submit) submit.onclick = submitTeam;
    const clear = $('#clear'); if (clear) clear.onclick = () => { ses.slots = {}; ses.selectedUid = null; showBuild(); };
    const dnq = $('#dnq'); if (dnq) dnq.onclick = () => submitTeam(true);
    const cancel = $('#cancel'); if (cancel) cancel.onclick = () => { depositAndEnd('cancelled'); showMenu(); };
  }

  function tryPlace(uid, slotId, el) {
    const res = canPlace(uid, slotId);
    if (!res.ok) {
      el.classList.add('shake');
      toast(res.reason);
      setTimeout(() => el.classList.remove('shake'), 320);
      return;
    }
    placeCard(uid, slotId);
  }

  /* =====================================================================
   * SUBMIT + RESULT
   * =================================================================== */
  function submitTeam(forfeit) {
    const ses = S.session;
    if (!forfeit && !isComplete()) { toast('Fill all 11 slots'); return; }

    let result;
    if (forfeit) {
      result = { outcome: 'dnq', outcomeLabel: 'Did Not Qualify', attackRating: null, defendRating: null, percentile: 0 };
      result.team = { attack: 0, defend: 0, total: 0 };
      result.placements = [];
    } else {
      const placements = Rules.FORMATION.map((slot) => {
        const card = ses.hand[ses.slots[slot.id]].card;
        return { card, position: card.position };
      });
      const team = Scoring.scoreTeam(placements);
      const evald = Scoring.evaluateOutcome(team, S.data.calibration);
      result = Object.assign({ team, placements }, evald);
    }

    // Deposit + record once.
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
    const ses = S.session;
    topbar('Result');
    const tierClass = result.outcome === 'dnq' ? 'tier-dnq' : `tier-${result.outcome}`;
    const ratings = result.outcome === 'dnq'
      ? `<p class="muted">Your squad couldn't field a legal XI, so it did not qualify. The cards are yours to keep.</p>`
      : `<div class="ratings">
           <div class="rating-box attack"><div class="rlabel">ATTACK</div><div class="rval">${result.attackRating}</div></div>
           <div class="rating-box defend"><div class="rlabel">DEFEND</div><div class="rval">${result.defendRating}</div></div>
         </div>
         <div class="meta">Team total ${result.team.total} · top ${Math.round((1 - result.percentile) * 100)}% of simulated squads</div>`;

    const teamCards = (result.placements || []).map((p) =>
      `<div class="binder-card" data-id="${p.card.id}">${miniCardHTML(p.card)}</div>`).join('');

    screenEl().innerHTML = `
      <div class="result ${tierClass}">
        <div class="outcome-label">Your tournament ends as</div>
        <div class="outcome">${esc(result.outcomeLabel)}</div>
        ${ratings}
        ${teamCards ? `<div class="section-label">Your XI</div><div class="result-team">${teamCards}</div>` : ''}
        <div class="grid-2 mt">
          <button class="btn green" id="again">Play again</button>
          <button class="btn ghost" id="tomenu">Main menu</button>
        </div>
        <div class="mt"><button class="btn ghost full" id="tobinder">View binder</button></div>
      </div>`;

    screenEl().querySelectorAll('.result-team .binder-card').forEach((el) => {
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
                ${miniCardHTML(c, { hideName: !own })}
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
        <li>Open <b>3 packs</b> of 10 cards. For each card, <b>KEEP</b> or <b>DISCARD</b> before the next is revealed.</li>
        <li>From everything you kept, fill an <b>11-player XI</b>: 1 GK, 4 DEF, 3 MID, 2 FWD, and 1 flex (MID or FWD).</li>
        <li>One slot per player <b>name</b> — no two versions of the same player.</li>
        <li><b>SUBMIT</b> to score your Attack & Defend ratings and see how deep your tournament run goes.</li>
        <li>Every kept card — used or not — is deposited into your <b>Binder</b>.</li>
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
