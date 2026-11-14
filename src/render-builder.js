// Guided Deck Builder build view (Layout A "Inline tiers") on a Commander deck page: a rules bar
// (Bracket / Game Changers / Budget / Power chips, "+ rule", "Only cards I own", Auto-complete),
// tiered suggestions (① key incl. ≤ 3 combos, ② theme, ③ lands), per-row checkboxes on Moxfield's
// decklist with "Remove selected", and an Auto-complete preview that writes nothing before confirm.
//
// Every write goes through Moxfield's own Bulk Edit (moxfield-ui.applyBulkEdit), which navigates
// to /decks/{id}/edit and back. The content router tears this view down on that navigation and
// re-installs it on return, so the in-flight write is a MODULE-level promise: a fresh mount awaits
// it, then re-reads the deck and runs the one post-write Power check. No innerHTML anywhere.

import { el, registerDisposable, isDark, chevronSvg } from './dom.js';
import { parseDeckId } from './moxfield.js';
import { getOptions } from './prefs.js';
import { getDeckBuild, setDeckBuild, peekPendingBuild, takePendingBuild } from './build-store.js';
import { makeCtx, ruleUsage, effectiveGcCap, comboGuards, RULES_DEFAULT } from './build-rules.js';
import { buildTiers } from './build-rank.js';
import { keyCombos } from './sources/spellbook.js';
import { frontFace } from './sources/scryfall.js';
import { proposeFill } from './autocomplete.js';
import { getBuildData, getCardData, importDeck } from './messaging.js';
import { applyBulkEdit, canEdit } from './moxfield-ui.js';
import { ownedNames } from './moxfield-collection.js';
import { readDeckAny } from './moxfield-edit.js';
import { deckMd5, canonicalDeckUrl } from './md5.js';
import * as V from './builder-view.js';

const ROW_SEL = 'li[data-row-key] a.table-deck-row-link[href^="/cards/"]';
const THEME_SHOWN = 18;
const LANDS_SHOWN = 12;
const AFTER_WRITE_MS = 120000;

let mountToken = null; // identity of the live mount; teardown clears it (stale-async guard)
let writing = null; // in-flight applyBulkEdit promise; survives teardown/remount on purpose
let afterWrite = null; // { publicId, at } after a successful write → fresh mount runs the Power check
let mountDisposers = []; // the live mount's listeners/observers (also registered with the router)
// The router's history patch lives in the content script's isolated world, so it never sees
// Moxfield's own pushState: route changes are caught by its 1 s href poll (+150 ms debounce), which
// can miss a fast /edit round-trip entirely. Wait this long after a write before concluding that.
const ROUTER_MISS_MS = 1600;

export function teardownBuilder() {
  mountToken = null;
  const fns = mountDisposers; mountDisposers = [];
  for (const fn of fns) { try { fn(); } catch { /* never throw into the page */ } }
  document.querySelectorAll('.solring-builder, .solring-builder-selbar, .solring-builder-modal-back, .solring-builder-pick')
    .forEach((n) => n.remove());
  document.querySelectorAll('.solring-builder-sel').forEach((n) => n.classList.remove('solring-builder-sel'));
}

// Bottom edge of Moxfield's fixed deck toolbar (it appears once the page scrolls), so our sticky
// rules/selection bars stick just below it instead of underneath. 0 when nothing is pinned.
function fixedTopBottom() {
  let bottom = 0;
  for (const n of document.elementsFromPoint(Math.round(window.innerWidth / 2), 8)) {
    if (n.closest('.solring-builder, .solring-builder-selbar')) continue;
    for (let e = n; e && e !== document.body; e = e.parentElement) {
      if (getComputedStyle(e).position !== 'fixed') continue;
      const b = e.getBoundingClientRect();
      if (b.top <= 1 && b.height < 160) bottom = Math.max(bottom, b.bottom);
      break;
    }
  }
  return Math.round(bottom);
}

const send = (fn) => fn().catch(() => null);
const ok = (res) => res && !res.error && !res.miss;

const FAIL_TEXT = {
  'not-editable': 'Open the deck in edit mode (logged in) to add cards',
  'ui-changed': 'Couldn’t reach Moxfield’s Bulk Edit',
};
const failText = (r) => (r && r.reason === 'rejected' ? `Moxfield rejected: ${r.message || 'unknown error'}` : FAIL_TEXT[r && r.reason] || FAIL_TEXT['ui-changed']);

// Toast styled like Moxfield's own autosave notification (as recommendations.js does). Its own
// class: recommendations' teardown removes `.solring-autosave` on every route change, and a write
// toast must outlive the /edit round-trip.
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

export async function installBuilder({ waitFor }) {
  const publicId = parseDeckId(location.href);
  if (!publicId) return;
  const opts = await getOptions().catch(() => ({}));
  if (opts.sources && opts.sources.edhrec === false) return; // gated on the EDHREC source
  const token = {};
  mountToken = token;
  const live = () => mountToken === token && parseDeckId(location.href) === publicId;
  const own = (fn) => { mountDisposers.push(fn); registerDisposable(fn); };

  if (writing) await writing.catch(() => null); // a Bulk Edit from the previous mount is finishing
  if (!live()) return;
  let deckview = await waitFor('section.deckview');
  if (!deckview || !live()) return;

  let deck = await readDeckAny(publicId);
  // One retry: right after a Bulk Edit save the read (or the token relay) can transiently fail.
  if (!deck && live()) { await new Promise((r) => setTimeout(r, 1200)); deck = live() ? await readDeckAny(publicId) : null; }
  if (!live() || !deck || deck.format !== 'commander' || !deck.commanders.length) return;
  const build = await getDeckBuild(publicId).catch(() => ({ theme: null, rules: { ...RULES_DEFAULT } }));
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
    owned: null, ownedState: 'idle', // idle | loading | ready | unavailable
    comp: V.deckComposition(deck), ctx: null, tiers: null, loading: true, busy: null, power: null,
    showAllTheme: false, showAllLands: false, rulesOpen: false, rulesError: null,
  };
  const selected = new Map(); // front-face key → mainboard name (decklist checkboxes)
  // "Only cards I own" is saved on but the collection isn't loaded (yet, or it failed): the rule
  // can't be enforced, so every add (tiles, combos, Auto-complete) is paused. Removes stay allowed.
  const addsPaused = () => !!S.build.rules.ownedOnly && S.ownedState !== 'ready';
  let syncPicks = () => {}; // set by installRowPicks: re-applies checkbox state to the rows
  let modalKey = null; // the open preview's Escape listener (closeModal removes it)
  let themeSeq = 0; // playstyle-switch sequence: a slower earlier switch must not win

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
  // Decks you can't edit start collapsed and fetch nothing until the first expand (start()).
  const toggle = () => { const open = !panel.classList.contains('solring-open'); setOpen(open); if (open) start(); };
  bar.addEventListener('click', toggle);
  bar.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  deckview.parentElement.insertBefore(root, deckview);
  setOpen(editable); // open on decks you can edit; collapsed (one click away) otherwise
  const alive = () => live() && root.isConnected;
  own(() => closeModal());
  // A later abort of a mount that lost its token removes the root it inserted (no orphan panel).
  const abandon = () => { if (mountToken !== token) root.remove(); };

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
  const loadCombos = () => send(() => getBuildData({ op: 'combos', commanders: deck.commanders, cards: mainNames() }))
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
    S.ctx = makeCtx({ rules, info: S.info, flags: S.flags, owned: S.owned, deckNames: S.comp.names, combos: comboGuards(S.comboResults) });
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

  let started = false;
  async function start() {
    if (started || !alive()) return;
    started = true;
    body.replaceChildren(el('div', { class: 'solring-msg', text: 'Loading suggestions…' }));
    await loadAll();
    if (!alive()) return abandon();
    S.loading = false;
    if (S.build.rules.ownedOnly) S.ownedState = 'loading'; // adds stay paused until it's loaded
    recompute();
    render();
    if (editable) installRowPicks(); // row checkboxes + "Remove selected" only where you can write
    if (S.build.rules.ownedOnly) setOwnedOnly(true); // persisted: load the collection now (loading state)
    if (afterWrite && afterWrite.publicId === publicId && Date.now() - afterWrite.at < AFTER_WRITE_MS) {
      afterWrite = null;
      powerCheck();
    }
  }
  if (editable) await start();

  // Re-read the deck after a write that did NOT remount us (e.g. Bulk Edit was already open).
  async function refreshDeck() {
    let fresh = await readDeckAny(publicId);
    // Same transient-failure retry as the mount path (read right after a Bulk Edit save).
    if (!fresh && alive()) { await new Promise((r) => setTimeout(r, 1200)); fresh = alive() ? await readDeckAny(publicId) : null; }
    if (!alive()) return abandon();
    if (fresh) {
      deck = fresh;
      S.comp = V.deckComposition(deck);
      S.comboResults = await loadCombos();
      await loadInfo();
      if (!alive()) return abandon();
      selected.clear();
      recompute();
    }
    render(); syncPicks(); // always leave the busy state, even if the re-read failed
  }

  // ---- writes --------------------------------------------------------------------------------
  async function write(edit, okMsg, label) {
    if (writing || !live()) return; // a stale panel (SPA move to another deck) must not write there
    if (edit.add && edit.add.length && addsPaused()) return;
    closeModal();
    S.busy = label; render();
    const p = applyBulkEdit({ ...edit, publicId }).catch(() => ({ ok: false, reason: 'ui-changed' }))
      .then((r) => { if (r && r.ok) afterWrite = { publicId, at: Date.now() }; return r; });
    writing = p;
    const res = await p;
    if (writing === p) writing = null;
    if (!res || !res.ok) {
      toast(failText(res), true);
      if (alive()) { S.busy = null; render(); }
      return;
    }
    toast(okMsg);
    await new Promise((r) => setTimeout(r, ROUTER_MISS_MS));
    if (mountToken && mountToken !== token) return; // the router saw the round-trip and remounted: it re-reads
    if (mountToken === token && alive()) { // still mounted (Bulk Edit never left this view): refresh in place
      afterWrite = null;
      S.busy = null;
      await refreshDeck();
      powerCheck();
      return;
    }
    // The router missed the round-trip (or only its /edit leg tore us down) and nothing is mounted:
    // remount ourselves (the fresh mount consumes afterWrite and runs the Power check).
    teardownBuilder();
    if (parseDeckId(location.href) === publicId) installBuilder({ waitFor }).catch(() => {});
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
      field('Budget (whole deck, $)', budget),
      el('div', { class: 'solring-builder-formfoot' }, [
        S.rulesError ? el('span', { class: 'solring-builder-err', text: S.rulesError }) : null, save,
      ]),
    ]);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const res = V.parseRulesForm({ bracket: bracket.value, gcCap: gc.value, powerMin: pmin.value, powerMax: pmax.value, budget: budget.value });
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

  function art(name) {
    const i = S.info[frontFace(name)];
    return i && i.image
      ? el('img', { class: 'solring-builder-art', attrs: { src: i.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' } })
      : el('span', { class: 'solring-builder-art solring-builder-noart', text: name });
  }

  function addBtn(label, title, blocked, onClick) {
    const b = el('button', { class: 'btn btn-primary btn-sm solring-builder-add', text: label, attrs: { type: 'button', title, 'aria-label': title } });
    b.disabled = blocked || !!S.busy || addsPaused();
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  function cardTile(s) {
    const blocked = !s.check.ok;
    const meta = el('div', { class: 'solring-builder-meta' }, [
      el('span', { class: 'solring-builder-syn', text: `syn ${Math.round((s.synergy || 0) * 100)}%`, title: `EDHREC synergy · in ${s.inclusionPct || 0}% of decks` }),
      s.gameChanger ? el('span', { class: 'solring-builder-gc', text: 'GC', title: 'Game Changer' }) : null,
      el('span', { class: 'solring-builder-price', text: V.usd(s.usd) }),
    ]);
    return el('div', { class: `solring-builder-tile${blocked ? ' solring-blocked' : ''}`, attrs: { 'data-card': s.name } }, [
      art(s.name),
      blocked ? el('span', { class: 'solring-builder-why', text: s.check.reason }) : null,
      addBtn('+', `Add ${s.name} via Moxfield`, blocked, () => write({ add: [{ name: s.name, qty: 1 }] }, `Added ${s.name}`, 'add')),
      el('div', { class: 'solring-builder-name', text: s.name }),
      meta,
    ]);
  }

  function comboTile(combo) {
    const st = V.comboCheck(combo, S.ctx);
    const label = st.add.length > 1 ? '+ both' : '+ add';
    const pieces = el('ul', { class: 'solring-builder-pieces' }, combo.pieces.map((p) => el('li', { class: p.missing ? 'solring-missing' : '', text: p.name })));
    return el('div', { class: `solring-builder-tile solring-builder-combo${st.ok ? '' : ' solring-blocked'}` }, [
      el('div', { class: 'solring-builder-combohead', text: 'Combo · Spellbook' }),
      !st.ok ? el('span', { class: 'solring-builder-why', text: st.reason }) : null,
      pieces,
      el('div', { class: 'solring-builder-meta' }, [el('span', { text: combo.bracketTag ? `bracket tag ${combo.bracketTag}` : 'combo' }),
        addBtn(label, `Add ${st.add.join(' + ')} via Moxfield`, !st.ok, () => write({ add: st.add.map((name) => ({ name, qty: 1 })) }, `Added ${st.add.join(' + ')}`, 'add'))]),
    ]);
  }

  // ---- Auto-complete preview -----------------------------------------------------------------
  function closeModal() {
    if (modalKey) { document.removeEventListener('keydown', modalKey); modalKey = null; }
    document.querySelectorAll('.solring-builder-modal-back').forEach((n) => n.remove());
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
      summary.textContent = `${V.previewSummary(t, S.ctx.rules, effectiveGcCap(S.ctx.rules))} · nothing is added until you confirm`;
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
          el('span', { class: 'solring-builder-price', text: V.usd(r.usd == null ? null : r.usd * r.qty) })]);
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
    const clear = el('button', { class: 'btn btn-outline-secondary btn-sm', text: 'Clear', attrs: { type: 'button' } });
    const remove = el('button', { class: 'btn btn-outline-danger btn-sm', attrs: { type: 'button' } });
    const selbar = el('div', { class: `solring-builder-selbar${isDark() ? ' solring-dark' : ''}`, attrs: { 'data-solring-root': '' } }, [
      el('label', { class: 'solring-builder-all' }, [all, el('span', { text: 'Select all' })]), count,
      el('span', { class: 'solring-builder-spacer' }), clear, remove,
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
      clear.hidden = remove.hidden = n === 0;
      remove.textContent = S.busy === 'rm' ? 'Removing via Moxfield…' : 'Remove selected';
      remove.disabled = !!S.busy;
    }
    function decorate() {
      if (!alive()) return abandon();
      for (const link of rows()) {
        const ent = entryOf(link);
        if (!ent) continue;
        let cb = ent.li.querySelector('.solring-builder-pick');
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
    clear.addEventListener('click', () => { selected.clear(); decorate(); });
    remove.addEventListener('click', () => {
      const names = [...selected.values()];
      if (!names.length || S.busy) return;
      S.busy = 'rm'; syncBar();
      write({ remove: names }, `Removed ${names.length} card${names.length === 1 ? '' : 's'}`, 'rm').then(() => { if (alive()) syncBar(); });
    });
    deckview.parentElement.insertBefore(selbar, deckview);
    let topRaf = 0;
    const setTop = () => { const v = `${fixedTopBottom()}px`; root.style.setProperty('--solring-builder-top', v); selbar.style.setProperty('--solring-builder-top', v); };
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
