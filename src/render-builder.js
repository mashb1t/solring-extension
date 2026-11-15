// Guided Deck Builder build view (Layout A "Inline tiers") on a Commander deck page: a rules bar
// (Bracket / Game Changers / Budget / Power chips, "+ rule", "Only cards I own", Auto-complete),
// tiered suggestions (① key incl. ≤ 3 combos, ② theme, ③ lands), per-row checkboxes on Moxfield's
// decklist with "Remove selected", and an Auto-complete preview that writes nothing before confirm.
//
// Every write is ONE request — the same PUT Moxfield's own Bulk Edit "Save" sends
// (moxfield-ui.applyBulkEdit). No navigation: after a write the view re-reads the deck, re-renders
// in place and runs the one post-write Power check; applyBulkEdit has already told Moxfield's deck
// view to refetch. The in-flight write is a MODULE-level promise so a remount (SPA nav) can't start
// a second write while one is pending. Edits made in Moxfield itself (or another tab) arrive on its
// `moxfield-sync-{ownerUserId}` BroadcastChannel and trigger a debounced, version-gated refresh.
// No innerHTML anywhere.

import { el, registerDisposable, isDark, chevronSvg } from './dom.js';
import { parseDeckId } from './moxfield.js';
import { getOptions } from './prefs.js';
import { getDeckBuild, setDeckBuild, peekPendingBuild, takePendingBuild, getPricingProvider, setPricingProvider } from './build-store.js';
import { makeCtx, ruleUsage, effectiveGcCap, comboGuards, RULES_DEFAULT } from './build-rules.js';
import { buildTiers } from './build-rank.js';
import { keyCombos } from './sources/spellbook.js';
import { frontFace } from './sources/scryfall.js';
import { proposeFill } from './autocomplete.js';
import { DEFAULT_PRICING, pricedInfo, approxNote, deckPrices, chooseProvider, pricingFor } from './pricing.js';
import { getBuildData, getCardData, importDeck } from './messaging.js';
import { applyBulkEdit, canEdit } from './moxfield-ui.js';
import { ownedNames } from './moxfield-collection.js';
import { readDeckAny, bulkEditRead } from './moxfield-edit.js';
import { deckMd5, canonicalDeckUrl } from './md5.js';
import * as V from './builder-view.js';
import { cardRefs, cardHoverAttrs } from './render-card-modal.js';
import { comboBracketLabel } from './labels.js';

const ROW_SEL = 'li[data-row-key] a.table-deck-row-link[href^="/cards/"]';
const THEME_SHOWN = 18;
const LANDS_SHOWN = 12;

let mountToken = null; // identity of the live mount; teardown clears it (stale-async guard)
let writing = null; // in-flight applyBulkEdit promise; survives teardown/remount on purpose
let mountDisposers = []; // the live mount's listeners/observers (also registered with the router)

export function teardownBuilder() {
  mountToken = null;
  const fns = mountDisposers; mountDisposers = [];
  for (const fn of fns) { try { fn(); } catch { /* never throw into the page */ } }
  document.querySelectorAll('.solring-builder, .solring-builder-selbar, .solring-builder-modal-back, .solring-builder-pick')
    .forEach((n) => n.remove());
  document.querySelectorAll('.solring-builder-sel').forEach((n) => n.classList.remove('solring-builder-sel'));
}

// Bottom edge of the bars Moxfield pins to the top of the viewport (its deck toolbar appears once the
// page scrolls), so our sticky rules/selection bars stick just below them instead of underneath.
// Fixed AND stuck sticky bars count; bars stacked under each other are followed down (probe again
// just below the last one). 0 when nothing is pinned. Moxfield's purple deck-stats bar is fixed to
// the BOTTOM (LIVE-VERIFY 2026-11-15): it never counts here; the builder's own stacking context
// (z-index 0 in solring.css) keeps the rules bar beneath it when they meet.
function fixedTopBottom() {
  let bottom = 0;
  for (let pass = 0; pass < 3; pass++) {
    const y = bottom + 2;
    let next = bottom;
    for (const fx of [0.25, 0.5, 0.75]) {
      for (const n of document.elementsFromPoint(Math.round(window.innerWidth * fx), y)) {
        if (n.closest('.solring-builder, .solring-builder-selbar')) continue;
        for (let e = n; e && e !== document.body; e = e.parentElement) {
          const pos = getComputedStyle(e).position;
          if (pos !== 'fixed' && pos !== 'sticky') continue;
          const b = e.getBoundingClientRect();
          // pinned to the top edge (or to the bar above it), bar-sized; skips Moxfield's 3px fixed
          // page-progress strip (z 100) at the very top.
          if (b.top <= bottom + 1 && b.bottom > bottom && b.height >= 6 && b.height < 160) next = Math.max(next, b.bottom);
          break;
        }
      }
    }
    if (next <= bottom) break;
    bottom = next;
  }
  return Math.floor(bottom); // floor, not round: a fractional toolbar edge (e.g. 54.6px) must not leave a hairline gap
}

const send = (fn) => fn().catch(() => null);
const ok = (res) => res && !res.error && !res.miss;

const FAIL_TEXT = {
  'not-editable': 'Open the deck in edit mode (logged in) to edit cards',
  session: 'Moxfield session expired — reload the page and try again',
  'ui-changed': 'Couldn’t save through Moxfield’s Bulk Edit',
};
const failText = (r) => (r && r.reason === 'rejected' ? `Moxfield rejected: ${r.message || 'unknown error'}` : FAIL_TEXT[r && r.reason] || FAIL_TEXT['ui-changed']);

// Toast styled like Moxfield's own autosave notification (as recommendations.js does). Its own
// class: recommendations' teardown removes `.solring-autosave` on every route change.
let toastTimer = null; let toastHide = null;
function toast(msg, isError) {
  let box = document.querySelector('.solring-builder-toast');
  if (!box) {
    box = el('div', { class: 'autosave-notification solring-builder-toast', attrs: { role: 'status' } });
    document.body.appendChild(box);
  }
  box.classList.toggle('solring-builder-toast-err', !!isError);
  box.replaceChildren(el('span', {}, [el('span', { class: 'me-2', text: isError ? '⚠️' : '👍' }), msg]));
  requestAnimationFrame(() => box.classList.add('solring-on'));
  clearTimeout(toastTimer); clearTimeout(toastHide);
  toastTimer = setTimeout(() => { box.classList.remove('solring-on'); toastHide = setTimeout(() => box.remove(), 300); }, isError ? 4500 : 2600);
}

// The user's Moxfield price provider. The mount uses the stored value right away (initialPricing,
// a storage read); on a deck they own the Bulk Edit GET (the same GET Bulk Edit itself issues)
// refreshes it in the background at most ONCE per page load (a failed GET isn't retried on SPA
// remounts), stores it for decks they don't own, and reports a change via onChange.
let pageProvider = null; // from this page's Bulk Edit GET
let bulkTried = false;
async function initialPricing() {
  if (pageProvider) return pricingFor(pageProvider);
  return pricingFor(chooseProvider(null, await getPricingProvider().catch(() => null)).provider);
}
function refreshProvider(publicId, editable, onChange) {
  if (pageProvider || bulkTried || !editable) return;
  bulkTried = true;
  (async () => {
    const bulk = await bulkEditRead(publicId);
    const stored = await getPricingProvider().catch(() => null);
    const { provider, fromBulk } = chooseProvider(bulk && bulk.ok ? bulk.json : null, stored);
    if (!fromBulk) return;
    pageProvider = provider;
    if (provider !== stored) setPricingProvider(provider).catch(() => {});
    onChange(pricingFor(provider));
  })().catch(() => {});
}

export async function installBuilder({ waitFor, rebuild = false }) {
  const publicId = parseDeckId(location.href);
  if (!publicId) return;
  const opts = await getOptions().catch(() => ({}));
  if (opts.builderEnabled === false) return; // turned off in the options
  if (opts.sources && opts.sources.edhrec === false) return; // gated on the EDHREC source
  const token = {};
  mountToken = token;
  const live = () => mountToken === token && parseDeckId(location.href) === publicId;
  const own = (fn) => { mountDisposers.push(fn); registerDisposable(fn); };

  if (writing) await writing.catch(() => null); // a write from the previous mount is finishing
  if (!live()) return;
  let deckview = await waitFor('section.deckview');
  if (!deckview || !live()) return;

  let deck = await readDeckAny(publicId);
  // One retry: the read (or the token relay) can transiently fail; on a
  // rebuild (commander just set via the picker) the first read can still predate the commander.
  if ((!deck || (rebuild && !deck.commanders.length)) && live()) { await new Promise((r) => setTimeout(r, 1200)); deck = live() ? await readDeckAny(publicId) : null; }
  if (!live() || !deck || deck.format !== 'commander' || !deck.commanders.length) return;
  const build = await getDeckBuild(publicId).catch(() => ({ theme: null, rules: { ...RULES_DEFAULT } }));
  // Before the first render, so the "+ rule" label / chips never show a stale currency.
  const pricing0 = await initialPricing().catch(() => DEFAULT_PRICING);
  // Owner signal (Bulk Edit link) once the deck subheader has rendered; a late link gets a moment.
  await waitFor(`#subheader-more, a[href="/decks/${publicId}/edit"]`, 3000);
  for (let i = 0; !canEdit() && i < 8 && live(); i++) await new Promise((r) => setTimeout(r, 100));
  const editable = canEdit();
  // Last await before inserting: re-check, so an overlapping mount can't insert an orphan root.
  if (!live()) return;
  deckview = document.querySelector('section.deckview');
  if (!deckview || !deckview.isConnected) return;
  // We are the live mount (the token is ours), so any builder DOM still here belongs to a dead one.
  document.querySelectorAll('.solring-builder, .solring-builder-selbar, .solring-builder-pick').forEach((n) => n.remove());

  // ---- state -------------------------------------------------------------------------------
  const S = {
    build,
    themes: null, theme: null, themeCards: [], comboResults: null, flags: V.flagSets(null), flagsOk: true, info: {},
    pricing: pricing0, // the user's Moxfield price provider (pricing.pricingFor)
    owned: null, ownedState: 'idle', // idle | loading | ready | unavailable
    comp: V.deckComposition(deck), ctx: null, tiers: null, loading: true, busy: null, power: null,
    showAllTheme: false, showAllLands: false, rulesOpen: false, rulesError: null,
  };
  const selected = new Map(); // front-face key → mainboard name (decklist checkboxes)
  // "Only cards I own" is saved on but the collection isn't loaded (yet, or it failed): the rule
  // can't be enforced, so every add (tiles, combos, Auto-complete) is paused. Removes stay allowed.
  // A fresh tick (rule not saved until the load succeeds) pauses adds while it loads, too.
  const addsPaused = () => S.ownedState === 'loading' || (!!S.build.rules.ownedOnly && S.ownedState !== 'ready');
  let syncPicks = () => {}; // set by installRowPicks: re-applies checkbox state to the rows
  let modalKey = null; // the open preview's Escape listener (closeModal removes it)
  let themeSeq = 0; // playstyle-switch sequence: a slower earlier switch must not win
  let started = false; // start() ran (declared before the bar is clickable: no TDZ on an early expand)
  // Manual-edit sync (deck edited in Moxfield itself / another tab). Declared before the channel
  // listener is attached (no TDZ on an early message). syncWant = pending { version, unknown }.
  let syncWant = null; let syncTimer = 0; let refreshing = false; let rowSig = null;
  let readRows = () => []; // set by installRowPicks: the decklist rows that count toward the 100

  // ---- skeleton ------------------------------------------------------------------------------
  const body = el('div', { class: 'solring-panel-body solring-builder-body' });
  const chevron = el('span', { class: 'solring-chevron', attrs: { 'aria-hidden': 'true' } }, [chevronSvg()]);
  const barInfo = el('span', { class: 'solring-synced' });
  const bar = el('div', { class: 'solring-panel-bar', attrs: { role: 'button', tabindex: '0', 'aria-expanded': 'true' } }, [
    el('span', { class: 'solring-wordmark', text: 'Solring Builder' }),
    el('span', { class: 'solring-bar-right' }, [barInfo, chevron]),
  ]);
  const panel = el('div', { class: `solring-panel solring-builder-panel${isDark() ? ' solring-dark' : ''}` }, [bar, body]);
  const root = el('div', { class: 'solring-builder', attrs: { 'data-solring-root': '' } }, [panel]);
  const setOpen = (open) => { panel.classList.toggle('solring-open', open); bar.setAttribute('aria-expanded', String(open)); };
  // A collapsed panel (always on decks you can't edit; per builderPanelDefault otherwise) fetches
  // nothing until the first expand (start()).
  const toggle = () => { const open = !panel.classList.contains('solring-open'); setOpen(open); if (open) start(); };
  deckview.parentElement.insertBefore(root, deckview);
  const startOpen = V.builderStartsOpen({ setting: opts.builderPanelDefault, editable, cards: S.comp.current.cards });
  setOpen(startOpen);
  const alive = () => live() && root.isConnected;
  own(() => closeModal());
  // A later abort of a mount that lost its token removes the root it inserted (no orphan panel).
  const abandon = () => { if (mountToken !== token) root.remove(); };
  render(); // cheap: just the "x / 100 cards" summary until start() has loaded

  // ---- data ----------------------------------------------------------------------------------
  // R4: a build started in Moxfield's New-deck dialog lands here; adopt its playstyle only when
  // its commander is this deck's commander (peek first so another deck's pending build survives).
  if (!S.build.theme) {
    const pending = await peekPendingBuild().catch(() => null);
    if (pending && V.commanderMatches(pending.commanders, deck.commanders)) {
      const took = await takePendingBuild().catch(() => null);
      if (took && took.theme) { S.build.theme = took.theme; await setDeckBuild(publicId, { theme: took.theme }).catch(() => {}); }
    }
    if (!alive()) return abandon();
  }

  const mainNames = () => Object.values(deck.boards.mainboard).map((e) => e.name);
  // Spellbook source off: no fetch, no combo tiles, and no combo guard (comboGuards(null) → []).
  const spellbookOn = !(opts.sources && opts.sources.spellbook === false);
  const loadCombos = () => (spellbookOn ? send(() => getBuildData({ op: 'combos', commanders: deck.commanders, cards: mainNames() })) : Promise.resolve(null))
    .then((r) => (ok(r) ? r.results : null));
  const loadThemeCards = (slug) => (slug ? send(() => getBuildData({ op: 'theme', commanders: deck.commanders, theme: slug })) : Promise.resolve(null))
    .then((r) => (ok(r) && Array.isArray(r.cards) ? r.cards : []));
  const loadInfo = async () => {
    const names = V.infoNames({ deckNames: S.comp.unique, themeCards: S.themeCards, comboResults: S.comboResults })
      .filter((n) => !S.info[frontFace(n)]);
    if (!names.length) return;
    const r = await send(() => getCardData({ op: 'info', names }));
    if (ok(r) && r.info) Object.assign(S.info, r.info);
  };

  function recompute() {
    const rules = { ...S.build.rules, ownedOnly: !!(S.build.rules.ownedOnly && S.owned) };
    S.ctx = makeCtx({ rules, info: pricedInfo(S.info, S.pricing, deckPrices(deck, S.pricing)), pricing: S.pricing, flags: S.flags, owned: S.owned, deckNames: S.comp.names, combos: comboGuards(S.comboResults) });
    const combos = keyCombos(S.comboResults, S.comp.unique, rules.bracket, 3);
    S.tiers = buildTiers({ themeCards: S.themeCards, combos, ctx: S.ctx, keyCount: 15 });
  }

  async function loadAll() {
    const themesP = send(() => getBuildData({ op: 'themes', commanders: deck.commanders }));
    const [themesRes, flagsRes, combos] = await Promise.all([themesP, send(() => getCardData({ op: 'flags' })), loadCombos()]);
    S.themes = ok(themesRes) && Array.isArray(themesRes.themes) ? themesRes.themes : [];
    S.flags = V.flagSets(ok(flagsRes) ? flagsRes : null);
    S.flagsOk = V.flagsAvailable(flagsRes); // false → chip + no Auto-complete (single "+" stays)
    S.comboResults = combos;
    // A stored playstyle wins; otherwise preview the most-played one (not persisted until picked).
    S.theme = S.build.theme || (S.themes[0] && S.themes[0].slug) || null;
    S.themeCards = await loadThemeCards(S.theme);
    await loadInfo();
  }

  async function start() {
    if (started || !alive()) return;
    started = true;
    refreshProvider(publicId, editable, (p) => {
      if (!alive() || p.provider === S.pricing.provider) return;
      S.pricing = p;
      if (!S.loading) { recompute(); render(); } // a re-render also redraws an open "+ rule" form's label
    });
    body.replaceChildren(el('div', { class: 'solring-msg', text: 'Loading suggestions…' }));
    await loadAll();
    if (!alive()) return abandon();
    S.loading = false;
    if (S.build.rules.ownedOnly) S.ownedState = 'loading'; // adds stay paused until it's loaded
    recompute();
    render();
    if (S.build.rules.ownedOnly) setOwnedOnly(true); // persisted: load the collection now (loading state)
  }
  // The bar becomes clickable only now: an expand before this point would run start() ahead of the
  // pending-playstyle adoption and the loader consts above (TDZ → stuck on "Loading suggestions…").
  bar.addEventListener('click', toggle);
  bar.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  // Row checkboxes + "Remove selected" (in the header bar, so also while collapsed) only where you
  // can write. They need just the deck read above, not start()'s suggestion data.
  if (editable) installRowPicks();
  installDeckSync();
  if (startOpen) await start();

  // Re-read the deck and re-render in place: after our own write, or (sync = the pending want) after
  // a manual edit in Moxfield. A sync re-read that finds the version the builder already holds
  // renders nothing (no double refresh after our own write).
  async function refreshDeck(sync = null) {
    refreshing = true;
    try {
      let fresh = await readDeckAny(publicId);
      // Same transient-failure retry as the mount path; a sync read that still predates the
      // announced version (read-after-write lag) gets the same one retry.
      const behind = (d) => sync && Number.isFinite(sync.version) && d && Number.isFinite(d.version) && d.version < sync.version;
      if ((!fresh || behind(fresh)) && alive()) { await new Promise((r) => setTimeout(r, 1200)); fresh = (alive() && await readDeckAny(publicId)) || fresh; }
      if (!alive()) return abandon();
      if (sync && fresh && Number.isFinite(fresh.version) && fresh.version === deck.version) return; // nothing new
      if (sync && !fresh) return; // the view keeps the last good state
      if (fresh) {
        deck = fresh;
        S.comp = V.deckComposition(deck);
        if (started) { // a never-expanded panel stays unloaded: no suggestion fetches after an edit
          S.comboResults = await loadCombos();
          await loadInfo();
          if (!alive()) return abandon();
          recompute();
        }
        // Keep the selection where those cards are still in the deck (removed ones drop out).
        const kept = V.pruneSelection(selected, deck.boards.mainboard);
        selected.clear(); for (const [k, n] of kept) selected.set(k, n);
      }
      render(); syncPicks(); // always leave the busy state, even if the re-read failed
    } finally { refreshing = false; }
  }

  // ---- manual edits (Moxfield's own add/remove/quantity, another tab) ---------------------------
  // Moxfield posts { kind:'deck', publicId, prevVersion, version, … } on BroadcastChannel
  // `moxfield-sync-{ownerUserId}` for its OWN edits too (same tab included; LIVE-VERIFY 2026-11-15 in moxfield-ui.js),
  // and the content script's channel object receives them. Our own applyBulkEdit post arrives here
  // as well: the version gate (syncNeeded vs deck.version) absorbs it once refreshDeck has run.
  // Debounced (a burst → one refresh); deferred while a write / load / modal is in flight.
  function scheduleSync(target) {
    if (!alive()) return;
    syncWant = V.mergeSyncWant(syncWant, target);
    if (!V.syncNeeded(syncWant, deck.version)) { syncWant = null; return; }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, 800);
  }
  function runSync() {
    syncTimer = 0;
    if (!alive()) return;
    // A row-change trigger whose rows are no longer ahead of the state (Moxfield re-rendered our own
    // write, which refreshDeck has applied meanwhile) is moot.
    if (syncWant && syncWant.unknown && syncWant.version == null && !V.rowsAhead(readRows(), deck)) syncWant = null;
    if (!V.syncNeeded(syncWant, deck.version)) { syncWant = null; return; } // e.g. our own write's echo
    if (writing || S.busy || refreshing || (started && S.loading) || modalKey) { syncTimer = setTimeout(runSync, 800); return; }
    const want = syncWant; syncWant = null;
    refreshDeck(want);
  }
  function installDeckSync() {
    if (!deck.ownerUserId || typeof BroadcastChannel === 'undefined') return;
    let ch = null;
    try { ch = new BroadcastChannel(`moxfield-sync-${deck.ownerUserId}`); } catch { return; }
    ch.onmessage = (e) => { try { scheduleSync(V.deckSyncTarget(e && e.data, publicId)); } catch { /* never throw into the page */ } };
    own(() => { ch.onmessage = null; ch.close(); clearTimeout(syncTimer); syncTimer = 0; syncWant = null; });
  }

  // ---- writes --------------------------------------------------------------------------------
  async function write(edit, okMsg, label) {
    if (writing || !live()) return; // a stale panel (SPA move to another deck) must not write there
    if (edit.add && edit.add.length && addsPaused()) return;
    closeModal();
    S.busy = label; render();
    const p = applyBulkEdit({ ...edit, publicId }).catch(() => ({ ok: false, reason: 'ui-changed' }));
    writing = p;
    const res = await p;
    if (writing === p) writing = null;
    if (!res || !res.ok) {
      toast(failText(res), true);
      if (alive()) { S.busy = null; render(); }
      return;
    }
    // Last write wins on Moxfield's side: flag a save that landed between our read and our write.
    if (res.concurrent) toast('This deck changed elsewhere just now — please check it', true);
    else toast(okMsg);
    if (!alive()) return abandon();
    S.busy = null;
    await refreshDeck();
    if (alive() && started) powerCheck(); // a never-opened panel stays unloaded (no CommanderSalt import)
  }

  async function powerCheck() {
    const target = S.build.rules.power;
    if (!target) return;
    S.power = 'Checking power…'; render();
    const url = canonicalDeckUrl(publicId);
    const md5 = deckMd5(url);
    const res = await importDeck(url, md5, md5).catch((e) => ({ error: String(e) })); // single attempt
    if (!alive()) return abandon();
    S.power = V.powerVerdict(res, target); render();
  }

  // ---- rules ---------------------------------------------------------------------------------
  async function saveRules(patch) {
    S.build.rules = { ...S.build.rules, ...patch };
    await setDeckBuild(publicId, { rules: patch }).catch(() => {});
    if (!alive()) return abandon();
    recompute(); render();
  }

  async function setOwnedOnly(on) {
    if (!on) { S.ownedState = S.ownedState === 'unavailable' ? 'unavailable' : 'idle'; return saveRules({ ownedOnly: false }); }
    S.ownedState = 'loading'; render();
    const set = await ownedNames().catch(() => null);
    if (!alive()) return abandon();
    // Keep the saved rule: a failed load must not silently switch it off (adds stay paused instead).
    if (!set) { S.owned = null; S.ownedState = 'unavailable'; recompute(); render(); return; }
    S.owned = set; S.ownedState = 'ready';
    return saveRules({ ownedOnly: true });
  }

  async function setTheme(slug) {
    const seq = ++themeSeq; // a slower earlier switch must not overwrite a newer one
    S.theme = slug; S.build.theme = slug; S.loading = true; render();
    await setDeckBuild(publicId, { theme: slug }).catch(() => {});
    const cards = await loadThemeCards(slug);
    if (seq !== themeSeq) return;
    S.themeCards = cards;
    await loadInfo();
    if (!alive()) return abandon();
    if (seq !== themeSeq) return;
    S.loading = false; S.showAllTheme = false; S.showAllLands = false;
    recompute(); render();
  }

  // ---- render --------------------------------------------------------------------------------
  function render() {
    if (!alive()) return abandon();
    barInfo.textContent = `${S.comp.current.cards} / ${V.DECK_SIZE} cards · ${S.comp.current.lands} / ${V.LAND_TARGET} lands`;
    if (!started) return; // collapsed, not loaded yet: the bar summary is all there is
    if (S.loading || !S.ctx) { body.replaceChildren(rulesBar(), el('div', { class: 'solring-msg', text: 'Loading suggestions…' })); return; }
    const kids = [rulesBar()];
    if (S.rulesOpen) kids.push(rulesForm());
    if (S.power) kids.push(el('div', { class: 'solring-builder-power', text: S.power }));
    if (S.build.rules.ownedOnly && S.ownedState === 'unavailable') {
      kids.push(el('div', { class: 'solring-builder-note solring-builder-err', text: 'Your collection couldn’t load, so adding is paused while “Only cards I own” is on. Untick it to add anyway.' }));
    }
    kids.push(tiersView());
    body.replaceChildren(...kids);
  }

  function rulesBar() {
    const chips = S.ctx ? V.ruleChips(ruleUsage(S.ctx), { flagsMissing: !S.flagsOk }) : [];
    const items = [el('span', { class: 'solring-builder-label', text: 'Rules' })];
    for (const c of chips) {
      const kids = [c.text];
      if (c.pct != null) kids.push(el('span', { class: `solring-builder-meter${c.warn ? ' solring-warn' : ''}` }, [el('i', { style: `width:${Math.round(c.pct * 100)}%` })]));
      if (c.hint) kids.push(el('small', { text: c.hint }));
      items.push(el('span', {
        class: `solring-builder-chip${c.key === 'flags' ? ' solring-builder-err' : ''}`,
        title: c.key === 'flags' ? 'Scryfall’s extra-turn / mass-land-denial / Game Changer lists couldn’t load, so Auto-complete is off. Single adds still check the rest.' : null,
        attrs: { 'data-rule': c.key },
      }, kids));
    }
    const box = el('input', { class: 'form-check-input', attrs: { type: 'checkbox' } });
    const ruleOn = !!S.build.rules.ownedOnly;
    box.checked = S.ownedState === 'loading' || ruleOn;
    // Unavailable + saved on: still uncheckable, so the user can switch the rule off and add again.
    box.disabled = S.ownedState === 'loading' || (S.ownedState === 'unavailable' && !ruleOn);
    box.addEventListener('change', () => setOwnedOnly(box.checked));
    const ownedText = S.ownedState === 'loading' ? 'Loading your collection…'
      : S.ownedState === 'unavailable' && ruleOn ? 'Only cards I own (unavailable)' : 'Only cards I own';
    const owned = el('label', {
      class: `solring-builder-chip solring-builder-owned${box.disabled || S.ownedState === 'unavailable' ? ' solring-disabled' : ''}`,
      title: S.ownedState === 'unavailable' ? 'Log in to Moxfield to use your collection' : null,
    }, [box, S.ownedState === 'loading' ? el('span', { class: 'solring-spin-icon solring-spin', text: '↻' }) : null, ownedText]);
    const ruleBtn = el('button', { class: 'solring-builder-chip solring-builder-rulebtn', text: S.rulesOpen ? 'Close rules' : '+ rule', attrs: { type: 'button' } });
    ruleBtn.addEventListener('click', () => { S.rulesOpen = !S.rulesOpen; S.rulesError = null; render(); });
    const ac = el('button', { class: 'btn btn-primary btn-sm solring-builder-ac', text: S.busy === 'ac' ? 'Adding via Moxfield…' : '⚡ Auto-complete deck', attrs: { type: 'button' } });
    ac.disabled = !!S.busy || !S.ctx || addsPaused() || !S.flagsOk;
    ac.addEventListener('click', openPreview);
    return el('div', { class: 'solring-builder-rules' }, [...items, owned, ruleBtn, el('span', { class: 'solring-builder-spacer' }), ac]);
  }

  function rulesForm() {
    const r = S.build.rules;
    const field = (label, input) => el('label', { class: 'solring-builder-field' }, [el('span', { text: label }), input]);
    const inp = (value, attrs) => { const i = el('input', { class: 'form-control form-control-sm', attrs: { type: 'number', ...attrs } }); i.value = value == null ? '' : String(value); return i; };
    const bracket = el('select', { class: 'form-select form-select-sm' }, [1, 2, 3, 4, 5].map((b) => el('option', { text: `Bracket ${b}`, attrs: { value: String(b) } })));
    bracket.value = String(r.bracket);
    const gc = inp(r.gameChangerCap, { min: '0', step: '1', placeholder: 'bracket default' });
    const pmin = inp(r.power && r.power.min, { min: '1', max: '10', step: '0.5', placeholder: 'min' });
    const pmax = inp(r.power && r.power.max, { min: '1', max: '10', step: '0.5', placeholder: 'max' });
    const budget = inp(r.budget, { min: '1', step: '1', placeholder: 'no limit' });
    const save = el('button', { class: 'btn btn-primary btn-sm', text: 'Save rules', attrs: { type: 'submit' } });
    const form = el('form', { class: 'solring-builder-ruleform' }, [
      field('Bracket', bracket), field('Game Changer cap', gc),
      field('Power target', el('span', { class: 'solring-builder-range' }, [pmin, el('span', { text: '–' }), pmax])),
      field(`Budget (whole deck, ${S.pricing.symbol})`, budget),
      el('div', { class: 'solring-builder-formfoot' }, [
        S.rulesError ? el('span', { class: 'solring-builder-err', text: S.rulesError }) : null, save,
      ]),
    ]);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const res = V.parseRulesForm({ bracket: bracket.value, gcCap: gc.value, powerMin: pmin.value, powerMax: pmax.value, budget: budget.value }, S.pricing);
      if (res.error) { S.rulesError = res.error; render(); return; }
      S.rulesOpen = false; S.rulesError = null;
      if (!res.rules.power) S.power = null;
      saveRules(res.rules);
    });
    return form;
  }

  function tiersView() {
    const t = S.tiers;
    const out = [];
    const themeSel = el('select', { class: 'form-select form-select-sm solring-builder-theme', attrs: { 'aria-label': 'Playstyle' } });
    for (const th of S.themes || []) themeSel.append(el('option', { text: `${th.name} (${th.decks.toLocaleString('en-US')} decks)`, attrs: { value: th.slug } }));
    if (S.theme) themeSel.value = S.theme;
    themeSel.addEventListener('change', () => setTheme(themeSel.value));
    out.push(el('div', { class: 'solring-builder-head' }, [
      el('span', { class: 'solring-builder-label', text: 'Playstyle' }),
      (S.themes || []).length ? themeSel : el('span', { class: 'solring-builder-note', text: 'No playstyles on EDHREC yet: Auto-complete still adds lands, and your rules apply.' }),
    ]));
    const ownedOnly = S.ctx.rules.ownedOnly;
    const key = V.ownedFilter(t.key, ownedOnly);
    const themeF = V.ownedFilter(t.theme, ownedOnly);
    const landF = V.ownedFilter(t.lands, ownedOnly);
    const hidden = key.hidden + themeF.hidden + landF.hidden;
    if (hidden) out.push(el('div', { class: 'solring-builder-note solring-builder-hidden', text: `${hidden} suggestion${hidden === 1 ? '' : 's'} you don’t own hidden (Only cards I own).` }));
    out.push(section('① Key cards · synergy + popularity', [...t.combos.map(comboTile), ...key.shown.map(cardTile)], null));
    const themeAll = themeF.shown;
    const theme = S.showAllTheme ? themeAll : themeAll.slice(0, THEME_SHOWN);
    out.push(section(`② Theme cards (${themeAll.length})`, theme.map(cardTile),
      themeAll.length > THEME_SHOWN ? moreBtn(S.showAllTheme, themeAll.length, () => { S.showAllTheme = !S.showAllTheme; render(); }) : null));
    const landAll = landF.shown;
    const lands = S.showAllLands ? landAll : landAll.slice(0, LANDS_SHOWN);
    const landNote = el('div', { class: 'solring-builder-chip solring-builder-landnote', text:
      `${S.comp.current.lands} / ${V.LAND_TARGET} lands in deck · Auto-complete adds the missing lands (these first, then basics in your colours)` });
    out.push(section(`③ Lands (${landAll.length})`, lands.map(cardTile),
      landAll.length > LANDS_SHOWN ? moreBtn(S.showAllLands, landAll.length, () => { S.showAllLands = !S.showAllLands; render(); }) : null, landNote));
    return el('div', { class: 'solring-builder-tiers' }, out);
  }

  function section(title, tiles, more, note) {
    return el('section', { class: 'solring-builder-tier' }, [
      el('p', { class: 'solring-builder-label', text: title }), note || null,
      tiles.length ? el('div', { class: 'solring-builder-grid' }, tiles) : el('div', { class: 'solring-builder-note', text: 'Nothing to suggest here.' }),
      more,
    ]);
  }
  function moreBtn(all, n, fn) {
    const b = el('button', { class: 'solring-picker-link solring-builder-more', text: all ? 'Show fewer' : `Show all ${n}`, attrs: { type: 'button' } });
    b.addEventListener('click', fn);
    return b;
  }

  // Tile art carries the card-ref hover attrs: enlarged preview on hover, Moxfield's card view on
  // click (the "+" is a sibling, so its clicks never reach the delegated card-ref listener).
  function art(name) {
    const i = S.info[frontFace(name)];
    const image = (i && i.image) || null;
    const hover = cardHoverAttrs(name, image);
    return image
      ? el('img', { class: 'solring-builder-art', attrs: { src: image, alt: name, loading: 'lazy', referrerpolicy: 'no-referrer', ...hover } })
      : el('span', { class: 'solring-builder-art solring-builder-noart', text: name, attrs: hover });
  }

  function addBtn(label, title, blocked, onClick) {
    // A bare "+" is drawn in CSS (.solring-builder-add-icon): font glyphs sit off-centre in a square button.
    const icon = label === '+';
    const b = el('button', { class: `btn btn-primary btn-sm solring-builder-add${icon ? ' solring-builder-add-icon' : ''}`, text: icon ? '' : label, attrs: { type: 'button', title, 'aria-label': title } });
    b.disabled = blocked || !!S.busy || addsPaused();
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  function cardTile(s) {
    const blocked = !s.check.ok;
    const meta = el('div', { class: 'solring-builder-meta' }, [
      el('span', { class: 'solring-builder-syn', text: `syn ${Math.round((s.synergy || 0) * 100)}%`, title: `EDHREC synergy · in ${s.inclusionPct || 0}% of decks` }),
      s.gameChanger ? el('span', { class: 'solring-builder-gc', text: 'GC', title: 'Game Changer' }) : null,
      el('span', { class: 'solring-builder-price', text: V.priceText(s.price, S.pricing), title: approxNote(S.pricing) }),
    ]);
    return el('div', { class: `solring-builder-tile${blocked ? ' solring-blocked' : ''}`, attrs: { 'data-card': s.name } }, [
      art(s.name),
      blocked ? el('span', { class: 'solring-builder-why', text: s.check.reason }) : null,
      addBtn('+', `Add ${s.name} via Moxfield`, blocked, () => write({ add: [{ name: s.name, qty: 1 }] }, `Added ${s.name}`, 'add')),
      el('div', { class: 'solring-builder-name', text: s.name, attrs: cardHoverAttrs(s.name, (S.info[frontFace(s.name)] || {}).image || null, { focus: false }) }),
      meta,
    ]);
  }

  // A combo as a card-sized tile: the pieces fanned like cards on top (missing ones outlined in
  // the accent with a "missing" marker, ones already in the deck muted), then what it produces, the
  // piece names as hoverable card refs, and the bracket label + add pill as the footer.
  function comboTile(combo) {
    const st = V.comboCheck(combo, S.ctx);
    const label = st.add.length > 1 ? '+ both' : '+ add';
    const adding = new Set(st.add.map(frontFace));
    const pieces = combo.pieces.map((p) => {
      const i = S.info[frontFace(p.name)];
      return { name: p.name, image: p.image || (i && i.image) || null, missing: adding.has(frontFace(p.name)) };
    });
    const shown = pieces.slice(0, 3);
    const fan = el('div', { class: 'solring-builder-fan', attrs: { 'aria-hidden': 'true' } }, shown.map((p, idx) => {
      // Decorative duplicate of the focusable name refs below: hover + click, no tab stop.
      const piece = el('span', { class: `solring-builder-fanpiece ${p.missing ? 'solring-missing' : 'solring-indeck'}`, attrs: cardHoverAttrs(p.name, p.image, { focus: false }) }, [
        p.image
          ? el('img', { class: 'solring-builder-fanimg', attrs: { src: p.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' } })
          : el('span', { class: 'solring-builder-fanimg solring-builder-noart', text: p.name }),
        el('span', { class: 'solring-builder-fanbadge', text: p.missing ? 'missing' : 'in deck' }),
      ]);
      piece.style.setProperty('--i', String(idx));
      piece.style.setProperty('--n', String(shown.length));
      return piece;
    }));
    const refs = cardRefs(pieces.map((p) => ({ name: p.name, image: p.image, resolve: true })), {});
    const list = el('ul', { class: 'solring-builder-pieces' }, pieces.map((p, idx) => {
      refs[idx].title = p.name;
      return el('li', { class: p.missing ? 'solring-missing' : 'solring-indeck' }, [refs[idx]]);
    }));
    const bracket = comboBracketLabel(combo.bracketTag);
    const produces = (combo.produces || []).join(' · ');
    return el('div', { class: `solring-builder-tile solring-builder-combo${st.ok ? '' : ' solring-blocked'}` }, [
      fan,
      !st.ok ? el('span', { class: 'solring-builder-why', text: st.reason }) : null,
      el('div', { class: 'solring-builder-combohead', text: 'Combo · Spellbook' }),
      produces ? el('div', { class: 'solring-builder-produces', text: produces, title: produces }) : null,
      list,
      el('div', { class: 'solring-builder-meta' }, [
        el('span', { class: 'solring-builder-bracket', text: bracket ? bracket.text : 'Combo', title: bracket && bracket.title }),
        addBtn(label, `Add ${st.add.join(' + ')} via Moxfield`, !st.ok, () => write({ add: st.add.map((name) => ({ name, qty: 1 })) }, `Added ${st.add.join(' + ')}`, 'add')),
      ]),
    ]);
  }

  // ---- Auto-complete preview -----------------------------------------------------------------
  function closeModal() {
    if (modalKey) { document.removeEventListener('keydown', modalKey); modalKey = null; }
    document.querySelectorAll('.solring-builder-modal-back').forEach((n) => n.remove());
  }

  // Solring's own small confirm (preview modal styling) before a destructive write.
  function confirmModal(title, okLabel, onOk) {
    closeModal();
    const cancel = el('button', { class: 'btn btn-outline-secondary btn-sm', text: 'Cancel', attrs: { type: 'button' } });
    const okBtn = el('button', { class: 'btn btn-danger btn-sm', text: okLabel, attrs: { type: 'button' } });
    cancel.addEventListener('click', closeModal);
    okBtn.addEventListener('click', () => { closeModal(); onOk(); });
    const dialog = el('div', { class: `solring-builder-modal solring-builder-confirm${isDark() ? ' solring-dark' : ''}`, attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title } }, [
      el('h3', { text: title }),
      el('div', { class: 'solring-builder-pvsum', text: 'Moxfield saves the deck without them. Nothing is removed until you confirm.' }),
      el('div', { class: 'solring-builder-pvfoot' }, [cancel, okBtn]),
    ]);
    const back = el('div', { class: 'solring-builder-modal-back' }, [dialog]);
    back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
    modalKey = (e) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', modalKey);
    document.body.appendChild(back);
    cancel.focus();
  }

  function openPreview() {
    if (!S.ctx || S.busy || addsPaused() || !S.flagsOk) return;
    closeModal();
    const fill = proposeFill({ tiers: S.tiers, ctx: S.ctx, size: V.DECK_SIZE, lands: V.LAND_TARGET, colorIdentity: deck.colorIdentity, current: S.comp.current });
    const ticked = new Set(fill.picks.map((_, i) => i));
    const summary = el('div', { class: 'solring-builder-pvsum' });
    const confirm = el('button', { class: 'btn btn-primary btn-sm', attrs: { type: 'button' } });
    const update = () => {
      const t = V.previewTotals({ picks: fill.picks, ticked, ctx: S.ctx, current: S.comp.current });
      summary.textContent = `${V.previewSummary(t, S.ctx.rules, effectiveGcCap(S.ctx.rules), S.pricing)} · nothing is added until you confirm`;
      confirm.textContent = `Add ${t.count} card${t.count === 1 ? '' : 's'} via Moxfield`;
      confirm.disabled = t.count === 0;
    };
    const groups = V.groupPicks(fill.picks).map((g) => el('div', { class: 'solring-builder-pvgroup' }, [
      el('p', { class: 'solring-builder-label', text: `${g.label} (${g.count})` }),
      ...g.rows.map((r) => {
        const cb = el('input', { class: 'form-check-input', attrs: { type: 'checkbox', 'aria-label': r.name } });
        cb.checked = true;
        cb.addEventListener('change', () => { if (cb.checked) ticked.add(r.i); else ticked.delete(r.i); update(); });
        return el('label', { class: 'solring-builder-pv' }, [cb, el('span', { class: 'solring-builder-pvname', text: r.qty > 1 ? `${r.name} ×${r.qty}` : r.name }),
          el('span', { class: 'solring-builder-price', text: V.priceText(r.price == null ? null : r.price * r.qty, S.pricing), title: approxNote(S.pricing) })]);
      }),
    ]));
    const short = V.shortfallText(fill);
    const cancel = el('button', { class: 'btn btn-outline-secondary btn-sm', text: 'Cancel', attrs: { type: 'button' } });
    cancel.addEventListener('click', closeModal);
    confirm.addEventListener('click', () => {
      const add = fill.picks.filter((_, i) => ticked.has(i)).map((p) => ({ name: p.name, qty: p.qty }));
      const n = add.reduce((s, a) => s + a.qty, 0);
      if (n) write({ add }, `Added ${n} cards`, 'ac');
    });
    const dialog = el('div', { class: `solring-builder-modal${isDark() ? ' solring-dark' : ''}`, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Auto-complete preview' } }, [
      el('h3', { text: 'Auto-complete preview' }), summary,
      short ? el('div', { class: 'solring-builder-short', text: short }) : null,
      fill.picks.length ? null : el('div', { class: 'solring-msg', text: 'Nothing to add: the deck already reaches the target or no suggestion fits the rules.' }),
      ...groups,
      el('div', { class: 'solring-builder-pvfoot' }, [cancel, confirm]),
    ]);
    const back = el('div', { class: 'solring-builder-modal-back' }, [dialog]);
    back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
    modalKey = (e) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', modalKey);
    update();
    document.body.appendChild(back);
    confirm.focus();
  }

  // ---- decklist checkboxes + "Remove selected" ------------------------------------------------
  function installRowPicks() {
    const count = el('span', { class: 'solring-builder-count' });
    const all = el('input', { class: 'form-check-input', attrs: { type: 'checkbox', 'aria-label': 'Select all cards' } });
    const remove = el('button', { class: 'btn btn-outline-danger btn-sm', attrs: { type: 'button' } });
    // Lives in the builder's header bar; its clicks must not reach the bar's expand/collapse toggle.
    // One cluster on the bar's right, before the card summary: count + actions, then Select all
    // (so the selection controls sit together instead of split across the bar).
    const selbar = el('span', { class: 'solring-builder-selbar' }, [
      count, remove,
      el('label', { class: 'solring-builder-all' }, [all, el('span', { text: 'Select all' })]),
    ]);
    const rows = () => [...document.querySelectorAll(`section.deckview ${ROW_SEL}`)];
    const entryOf = (link) => {
      const li = link.closest('li[data-row-key]');
      if (!li || /-commander-/.test(li.getAttribute('data-row-key') || '')) return null;
      const name = [...link.querySelectorAll('.underline')].map((s) => s.textContent).join('') || link.textContent || '';
      const e = deck.boards.mainboard[frontFace(name.replace(/\s+/g, ' '))];
      return e ? { li, key: frontFace(e.name), name: e.name } : null; // only mainboard cards (Bulk Edit's board)
    };
    function syncBar() {
      const n = selected.size;
      const pickable = new Set(rows().map(entryOf).filter(Boolean).map((x) => x.key));
      selbar.hidden = pickable.size === 0;
      selbar.classList.toggle('solring-on', n > 0);
      count.textContent = n ? `${n} selected` : '';
      all.checked = n > 0 && n >= pickable.size;
      all.indeterminate = n > 0 && n < pickable.size;
      count.hidden = remove.hidden = n === 0; // unticking Select all clears the selection; an empty count would skew the row's baseline
      remove.textContent = S.busy === 'rm' ? 'Removing via Moxfield…' : 'Remove selected';
      remove.disabled = !!S.busy;
    }
    // Fallback trigger for manual edits: the decklist rows that count toward the 100 (commander +
    // main sections, name + qty) changed since the last look AND show a card / quantity the
    // builder's deck state doesn't → a version-checked sync. Our own writes re-render rows that
    // already match the state, and a filtered list is a subset of it: neither triggers a re-read.
    function deckRows() {
      return V.deckRowEntries(rows().map((link) => {
        const li = link.closest('li[data-row-key]');
        const q = li && li.querySelector('input[value]');
        const name = [...link.querySelectorAll('.underline')].map((s) => s.textContent).join('') || link.textContent || '';
        return { rowKey: li ? li.getAttribute('data-row-key') : '', name: name.replace(/\s+/g, ' ').trim(), qty: q ? q.value : 1 };
      }));
    }
    readRows = deckRows;
    function decorate() {
      if (!alive()) return abandon();
      const entries = deckRows();
      const sig = V.deckSignature(entries);
      if (sig && sig !== rowSig) {
        const prev = rowSig; rowSig = sig;
        if (prev && V.rowsAhead(entries, deck)) scheduleSync('unknown');
      }
      for (const link of rows()) {
        const ent = entryOf(link);
        if (!ent) continue;
        let cb = ent.li.querySelector('.solring-builder-pick');
        // React may reuse an <li> for another card after an edit: a box bound to the old card goes.
        if (cb && cb.getAttribute('data-key') !== ent.key) { cb.remove(); cb = null; }
        if (!cb) {
          cb = el('input', { class: 'form-check-input solring-builder-pick', attrs: { type: 'checkbox', 'aria-label': `Select ${ent.name}`, 'data-key': ent.key } });
          for (const ev of ['click', 'mousedown', 'pointerdown', 'dragstart']) cb.addEventListener(ev, (e) => e.stopPropagation());
          cb.addEventListener('change', () => {
            if (cb.checked) selected.set(ent.key, ent.name); else selected.delete(ent.key);
            syncPicks();
          });
          link.parentElement.insertBefore(cb, link);
        }
        cb.checked = selected.has(ent.key);
        ent.li.classList.toggle('solring-builder-sel', cb.checked);
      }
      syncBar();
    }
    syncPicks = decorate;
    all.addEventListener('change', () => {
      if (all.checked) for (const ent of rows().map(entryOf).filter(Boolean)) selected.set(ent.key, ent.name);
      else selected.clear();
      decorate();
    });
    remove.addEventListener('click', () => {
      const n0 = selected.size;
      if (!n0 || S.busy) return;
      const plural = (n) => `${n} card${n === 1 ? '' : 's'}`;
      confirmModal(`Remove ${plural(n0)} from this deck?`, 'Remove', () => {
        if (S.busy || writing || !live()) return;
        const names = [...selected.values()]; // as of the confirm (syncs are deferred while it's open)
        if (!names.length) return;
        S.busy = 'rm'; syncBar();
        write({ remove: names }, `Removed ${plural(names.length)}`, 'rm').then(() => { if (alive()) syncBar(); });
      });
    });
    for (const ev of ['click', 'keydown']) selbar.addEventListener(ev, (e) => e.stopPropagation());
    barInfo.parentElement.insertBefore(selbar, barInfo); // right side, before the "x / 100 cards" summary
    let topRaf = 0;
    const setTop = () => root.style.setProperty('--solring-builder-top', `${fixedTopBottom()}px`);
    let topTimer = 0; // trailing re-measure: Moxfield's fixed toolbar animates in after the scroll
    const onScroll = () => { cancelAnimationFrame(topRaf); topRaf = requestAnimationFrame(setTop); clearTimeout(topTimer); topTimer = setTimeout(setTop, 250); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    own(() => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(topRaf); clearTimeout(topTimer); });
    setTop();
    let raf = 0;
    const obs = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(decorate); });
    obs.observe(deckview, { childList: true, subtree: true });
    own(() => { obs.disconnect(); cancelAnimationFrame(raf); });
    decorate();
  }
}
