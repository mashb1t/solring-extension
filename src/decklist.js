// Shared deck-list engine for the user profile (/users/{name}) and the personal
// deck manager (/decks/personal + folders). It injects CommanderSalt metric COLUMNS
// into Moxfield's deck table (a togglable subset; "Stats columns" menu), joining
// each row (a Moxfield publicId) to a CommanderSalt search hit via md5 and filling
// full-payload-only metrics from cache (or on demand by clicking a blank cell).
//
// The join key: a hit carries only its CommanderSalt deckId (an md5), never the
// Moxfield publicId — so we map each DOM row's publicId through
// deckMd5(canonicalDeckUrl(publicId)) and match that against hit.deckId. Proven by
// the md5 known-vector test.
//
// Verified live on /users/mashb1t: the deck list is a <table>; a <th> appended to
// each <thead> and a <td> to each row align perfectly. React drops our trailing
// cells from some rows on re-render (sort/filter/paginate), so a reconcile pass
// re-adds any missing cells (self-heals within a frame — confirmed live). Selectors
// are content-anchored (deck links + the table), never Moxfield's hashed classes.
// LIVE-VERIFY: /decks/personal column structure is inferred (login-gated).

import { deckMd5, canonicalDeckUrl } from './md5.js';
import { parseDeckId } from './moxfield.js';
import { getUserDecks, getDeck, importDeck } from './messaging.js';
import { csRatingGrade } from './ratings.js';
import {
  getListColumns, setListColumns, getColumnOrder, setColumnOrder,
  getHiddenNativeCols, setHiddenNativeCols, getSortPref, setSortPref, onPrefChange,
} from './prefs.js';
import { el, guard } from './dom.js';
import { gradeChip, bracketValue } from './components.js';

const HIT_PAGE_CAP = 20; // safety bound on search pagination (≈ HIT_PAGE_CAP×page-size decks)

// ---- pure logic (unit-tested) ------------------------------------------------

// Merge a search hit (always-available metrics) with a full cached payload
// (threat/interaction/wincons/tier/combos — present only once analyzed+cached) into
// one normalized view. `analyzed` = whether the full payload is in hand.
export function mergeView(hit, full) {
  const h = hit || {};
  const f = full || null;
  const pick = (a, b) => (a != null ? a : (b != null ? b : null));
  const bracketRealistic = f && f.bracketRealistic != null
    ? f.bracketRealistic
    : (typeof h.bracketRating === 'number' ? Math.round(h.bracketRating) : null);
  return {
    deckId: (f && f.deckId) || h.deckId || null,
    analyzed: !!f,
    isPrivate: !!(h.isPrivate || (f && f.isPrivate)),
    // hit-or-full (always shown)
    power: pick(f && f.power, h.power),
    bracketRealistic,
    bracketBaseline: f && f.bracketBaseline != null ? f.bracketBaseline : null,
    salt: pick(f && f.salt, h.salt),
    synergy: pick(f && f.synergy, h.synergy),
    archetype: (f && f.archetype) || h.archetypeMajor || null,
    // full-payload only (— until cached)
    threat: f && f.threat != null ? f.threat : null,
    interaction: f && f.interaction != null ? f.interaction : null,
    wincons: f && f.wincons != null ? f.wincons : null,
    commanderTier: f && f.commanderTier != null ? f.commanderTier : null,
    combosCount: f && f.combosCount != null ? f.combosCount : null,
  };
}

// Sortable score keys. `hit:true` → available from the search hit alone; `hit:false`
// → needs the full payload (rows lacking it sort last). HIGH grades (salt/threat/
// interaction/synergy) are "more" by raw value, which is what sort exposes.
export const SORT_KEYS = {
  power: { label: 'Power', get: (v) => v.power, hit: true },
  bracket: { label: 'Bracket', get: (v) => v.bracketRealistic, hit: true },
  saltiness: { label: 'Saltiness', get: (v) => v.salt, hit: true },
  synergy: { label: 'Synergy', get: (v) => v.synergy, hit: true },
  threat: { label: 'Threat', get: (v) => v.threat, hit: false },
  interaction: { label: 'Interaction', get: (v) => v.interaction, hit: false },
  wincons: { label: 'Wincons', get: (v) => v.wincons, hit: false },
  tier: { label: 'Commander tier', get: (v) => v.commanderTier, hit: false },
};

// Comparator over views: rows with the metric present sort by value (asc/desc);
// rows missing it always sort last (so a "scan all" fills them in).
export function compareViews(key, dir = 'desc') {
  const get = (SORT_KEYS[key] || {}).get || (() => null);
  const sign = dir === 'asc' ? 1 : -1;
  const has = (x) => typeof x === 'number' && Number.isFinite(x);
  return (a, b) => {
    const av = get(a);
    const bv = get(b);
    if (has(av) && has(bv)) return (av - bv) * sign;
    if (has(av)) return -1;
    if (has(bv)) return 1;
    return 0;
  };
}

// ---- module state ------------------------------------------------------------
// A deck can appear in several rows (e.g. a "Favorites" folder + "All Decks"), so
// state is tracked PER ROW, not per md5. Fetched full payloads are shared by md5
// (fullByMd5) so every row of the same deck shows the analysis once any is scanned.

let hitMap = new Map(); // md5 → search hit
let fullByMd5 = new Map(); // md5 → full DeckFields (cached/expanded)
let checkedCache = new Set(); // md5s we've already probed cache-only (avoid re-probing each pass)
let rowEntries = []; // [{ md5, publicId, row, hit }] — one per visible deck row
let rowMap = new WeakMap(); // row element → its current entry (idempotency)
let listColumns = {}; // prefs:listColumns — which metric columns are enabled
let columnOrder = []; // prefs:listColumnOrder — display order of the metric columns
let hiddenNative = []; // prefs:hiddenNativeCols — Moxfield native columns to hide
let sortState = { key: null, dir: 'desc' }; // prefs:sort — active score-sort (null = none)
let prefSubscribed = false; // onPrefChange wired only once
let nativeSortYieldInstalled = false;
const subscribers = new Set();
let listObserver = null;
let rafPending = false;

// The view for a row = its hit merged with any shared full payload for that deck.
function viewFor(entry) {
  return mergeView(entry.hit, fullByMd5.get(entry.md5) || null);
}

// A deck row belongs to THIS list only if it lives in the main content column
// (.flex-grow-1). Moxfield's sidebar widgets ("Most Recent Deck" / "Favorite
// Decks" / …) are deck links too, but they aren't the user's listed decks — so
// columns, averages, and bulk sync must all ignore them. Mirrors reconcileColumns'
// table-level predicate, and is re-checked live at read time because Moxfield
// briefly reparents a sidebar table THROUGH .flex-grow-1 (see sweepStrayCols),
// which can otherwise leave a stale sidebar entry in rowEntries.
const inMainList = (row) => !!(row && row.isConnected && row.closest('.flex-grow-1'));

/** Subscribe to deck-list changes (initial load, per-row expand, bulk sync).
    Returns an unsubscribe fn. Used by the profile averages + sync surfaces. */
export function onDeckListChange(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
function emitChange() {
  for (const cb of subscribers) guard('deck-list subscriber', () => cb());
}

/** Unique per-deck views (deduped by md5 — duplicate folder rows collapse to one),
    for the profile averages. */
export function getViews() {
  const seen = new Set();
  const out = [];
  for (const e of rowEntries) {
    if (!inMainList(e.row)) continue; // skip sidebar widgets (and reparented rows)
    if (seen.has(e.md5)) continue;
    seen.add(e.md5);
    out.push(viewFor(e));
  }
  return out;
}
/** Unique per-deck entries (deduped by md5), for the bulk-sync surface. */
export function getEntries() {
  const seen = new Set();
  const out = [];
  for (const e of rowEntries) {
    if (!inMainList(e.row)) continue; // skip sidebar widgets (and reparented rows)
    if (seen.has(e.md5)) continue;
    seen.add(e.md5);
    out.push(e);
  }
  return out;
}

// ---- hit loading -------------------------------------------------------------

async function loadAllHits(username) {
  const map = new Map();
  let cursor = null;
  let pages = 0;
  do {
    const res = await getUserDecks(username, cursor);
    if (!res || res.error || !Array.isArray(res.hits)) break;
    for (const h of res.hits) if (h && h.deckId) map.set(h.deckId, h);
    cursor = res.cursor || null;
    pages += 1;
  } while (cursor && pages < HIT_PAGE_CAP);
  if (cursor) console.warn('[solring] deck-list: hit pagination capped at', pages, 'pages — some decks unscored');
  return map;
}

// ---- DOM: find deck rows -----------------------------------------------------

// A deck link on a list page: an <a> whose resolved href is a real /decks/<publicId>
// (parseDeckId rejects the reserved /decks/personal|all|… routes and non-deck paths).
function isDeckLink(a) {
  return a.tagName === 'A' && a.href && parseDeckId(a.href);
}

// The repeating "row unit" for a deck link: climb until an ancestor has ≥2 siblings
// that each contain a deck link (the list's repeating element). Falls back to the
// nearest li/tr, then the link's parent. Content-anchored — no class names.
function rowOf(link) {
  let n = link;
  while (n && n.parentElement && n.parentElement !== document.body) {
    const parent = n.parentElement;
    const deckSiblings = [...parent.children].filter(
      (s) => s.nodeType === 1 && [...s.querySelectorAll('a')].some(isDeckLink),
    );
    if (deckSiblings.length >= 2 && deckSiblings.includes(n)) return n;
    n = parent;
  }
  return link.closest('li, tr') || link.parentElement || link;
}

// Distinct deck rows on the page (deduped — a row may hold multiple deck links).
function deckRows() {
  const seen = new Set();
  const rows = [];
  for (const a of document.querySelectorAll('a[href*="/decks/"]')) {
    if (!isDeckLink(a)) continue;
    const row = rowOf(a);
    if (!row || seen.has(row) || !inMainList(row)) continue; // main list only — not sidebar widgets
    const publicId = parseDeckId(a.href);
    seen.add(row);
    rows.push({ row, publicId, link: a });
  }
  return rows;
}

// ---- DOM: the metric columns -------------------------------------------------

const num = (n, d = 1) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : '—');
const numNode = (n) => (typeof n === 'number' && Number.isFinite(n) ? el('span', { class: 'solring-num', text: num(n) }) : null);
const textNode = (t) => el('span', { text: t });
const gradeNode = (value, field) => (typeof value === 'number' && Number.isFinite(value) ? gradeChip(csRatingGrade(value, field)) : null);

// Every metric column the deck-list can show. `hit:true` = available from the search
// hit alone (always populated); `hit:false` = needs the full payload (blank until the
// deck is scanned). `cell(view)` returns the inner node, or null → a blank "—" cell.
// Order here = left-to-right order of the injected columns.
const COLUMNS = [
  { key: 'power', label: 'Pow', title: 'Power level (0–10)', hit: true, cell: (v) => numNode(v.power) },
  { key: 'bracket', label: 'Brkt', title: 'Realistic bracket', hit: true, cell: (v) => (v.bracketRealistic != null ? bracketValue(v) : null) },
  { key: 'salt', label: 'Salt', title: 'Saltiness grade', hit: true, cell: (v) => gradeNode(v.salt, 'saltRating') },
  { key: 'synergy', label: 'Syn', title: 'Synergy grade', hit: true, cell: (v) => gradeNode(v.synergy, 'synergyRating') },
  { key: 'threat', label: 'Thr', title: 'Threat grade', hit: false, cell: (v) => gradeNode(v.threat, 'threatRating') },
  { key: 'interaction', label: 'Int', title: 'Interaction grade', hit: false, cell: (v) => gradeNode(v.interaction, 'interactionRating') },
  { key: 'wincons', label: 'Win', title: 'Wincons grade', hit: false, cell: (v) => gradeNode(v.wincons, 'comboRating') },
  { key: 'tier', label: 'Tier', title: 'Commander tier', hit: false, cell: (v) => (v.commanderTier != null ? textNode(`T${v.commanderTier}`) : null) },
  { key: 'combos', label: 'Cmb', title: 'Combos in deck', hit: false, cell: (v) => (v.combosCount != null ? textNode(String(v.combosCount)) : null) },
  { key: 'archetype', label: 'Arch', title: 'Archetype', hit: true, cell: (v) => (v.archetype ? textNode(v.archetype) : null) },
  // Per-row actions (CS link + Analysis) — built from the entry, not the view; see
  // buildActionsCell. `action:true` flags the special render path.
  { key: 'actions', label: '', title: 'Solring actions', hit: true, action: true, cell: () => null },
];

// Enabled columns, in the user's saved order (columnOrder); keys missing from the
// order fall back to the default COLUMNS order at the end (forward-compatible).
function enabledColumns() {
  const byKey = new Map(COLUMNS.map((c) => [c.key, c]));
  const seen = new Set();
  const out = [];
  for (const k of columnOrder) {
    const c = byKey.get(k);
    if (c && listColumns[k] && !seen.has(k)) { out.push(c); seen.add(k); }
  }
  for (const c of COLUMNS) if (listColumns[c.key] && !seen.has(c.key)) out.push(c);
  return out;
}
// Signature of the enabled set, to detect when a row/header needs rebuilding.
function colSig() {
  return enabledColumns().map((c) => c.key).join(',');
}
function ourColKeys(container) {
  return [...container.querySelectorAll(':scope > .solring-col')].map((n) => n.getAttribute('data-col')).join(',');
}

// Per-column sort accessors (numeric/grade columns only; archetype/actions aren't
// sortable). Keyed by COLUMN key so the header click maps straight through.
const SORT_VALUE = {
  power: (v) => v.power,
  bracket: (v) => v.bracketRealistic,
  salt: (v) => v.salt,
  synergy: (v) => v.synergy,
  threat: (v) => v.threat,
  interaction: (v) => v.interaction,
  wincons: (v) => v.wincons,
  tier: (v) => v.commanderTier,
  combos: (v) => v.combosCount,
};
const isSortable = (key) => Object.prototype.hasOwnProperty.call(SORT_VALUE, key);

// Header cells. Sortable ones get a click/keydown handler here (headers are rebuilt
// each reconcile, so the handler must live here, not be attached afterward); the
// ▲/▼ indicator is managed separately by updateSortIndicators so it can change
// without rebuilding the header.
function buildHeaderCells() {
  return enabledColumns().map((c) => {
    const th = el('th', {
      class: 'solring-col solring-col-h text-end text-nowrap', title: c.title, attrs: { 'data-col': c.key },
    }, [el('span', { text: c.label })]);
    if (isSortable(c.key)) {
      th.classList.add('solring-col-sortable');
      th.setAttribute('role', 'button');
      th.setAttribute('tabindex', '0');
      const fire = (e) => { e.preventDefault(); e.stopPropagation(); toggleSort(c.key); };
      th.addEventListener('click', fire);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fire(e); });
    }
    return th;
  });
}

// Click a sortable header: same column → flip direction; new column → that column,
// descending. Persisted (prefs:sort) → onPrefChange('sort') re-applies + repaints.
function toggleSort(key) {
  const next = sortState.key === key
    ? { key, dir: sortState.dir === 'desc' ? 'asc' : 'desc' }
    : { key, dir: 'desc' };
  setSortPref(next);
}

// Reflect the active sort on the header (▲/▼ + active class), idempotently — only
// touches the DOM when something actually changed, so it never drives the observer.
function updateSortIndicators(htr) {
  for (const th of htr.querySelectorAll(':scope > th.solring-col')) {
    const active = sortState.key === th.getAttribute('data-col');
    th.classList.toggle('solring-sort-active', active);
    let ind = th.querySelector(':scope > .solring-sort-ind');
    if (active) {
      if (!ind) { ind = el('span', { class: 'solring-sort-ind' }); th.appendChild(ind); }
      const glyph = sortState.dir === 'asc' ? ' ▲' : ' ▼';
      if (ind.textContent !== glyph) ind.textContent = glyph;
    } else if (ind) {
      ind.remove();
    }
  }
}

function compareEntries(key, dir) {
  const get = SORT_VALUE[key] || (() => null);
  const sign = dir === 'asc' ? 1 : -1;
  const has = (x) => typeof x === 'number' && Number.isFinite(x);
  return (ea, eb) => {
    const av = get(viewFor(ea));
    const bv = get(viewFor(eb));
    if (has(av) && has(bv)) return (av - bv) * sign;
    if (has(av)) return -1; // present before missing, regardless of direction
    if (has(bv)) return 1;
    return 0;
  };
}

// Reorder a table's deck rows by the active sort, pinning non-deck rows (folders /
// "Up a level") in their slots. STRICT no-op when already sorted — otherwise moving
// a Moxfield <tr> (no solring class) re-triggers the observer → annotate → applySort
// → infinite loop. With the guard, the first real sort costs one extra (no-op) pass.
function applySort(tbl) {
  if (!sortState.key) return;
  const tbody = tbl.querySelector(':scope > tbody');
  if (!tbody) return;
  const allRows = [...tbody.children].filter((n) => n.tagName === 'TR');
  const deckRows = allRows.filter((tr) => rowMap.get(tr));
  if (deckRows.length < 2) return;
  const cmp = compareEntries(sortState.key, sortState.dir);
  const sorted = [...deckRows].sort((a, b) => cmp(rowMap.get(a), rowMap.get(b)));
  if (deckRows.every((r, i) => r === sorted[i])) return; // already sorted → no DOM ops
  let si = 0;
  const target = allRows.map((tr) => (rowMap.get(tr) ? sorted[si++] : tr)); // fill deck slots, pin folders
  target.forEach((tr) => tbody.appendChild(tr));
}

// Clicking Moxfield's own Sort yields our score-sort (else our sticky re-apply would
// permanently override Moxfield's sort). Delegated so it survives header re-renders.
function installNativeSortYield() {
  if (nativeSortYieldInstalled) return;
  nativeSortYieldInstalled = true;
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('button');
    if (!btn || btn.closest('.solring-colmenu')) return;
    if (sortState.key && /^\s*Sort\s*$/i.test((btn.textContent || '').trim())) setSortPref({ key: null });
  });
}

// Moxfield's (non-Solring) cells of a row, in order.
function nativeCells(row) {
  return [...row.children].filter((c) => !(c.classList && c.classList.contains('solring-col')));
}
// Index of Moxfield's "Updated" column among native header cells (-1 if absent) — we
// insert our columns just before it, so they sit between Format and Updated.
function updatedIndex(htr) {
  return nativeCells(htr).findIndex((c) => /updated/i.test(c.textContent || ''));
}
// The cell our columns insert before in `row`, for a given header updated-index;
// null → append (Updated column not found / row shorter than expected).
function anchorCell(row, idx) {
  return idx < 0 ? null : (nativeCells(row)[idx] || null);
}

// Stable key for a Moxfield native column = its lowercased header label. Icon-only
// columns (likes/comments/views — blank headers) have no key and aren't hideable.
function nativeKey(headerCell) {
  const t = (headerCell.textContent || '').trim();
  return t ? t.toLowerCase() : null;
}

// Hide/show Moxfield's own columns per prefs (hiddenNative), by toggling a
// display:none class on the header cell + every body cell at that column index.
// 'name' is never hidden (it carries the deck link). Re-applied each reconcile so it
// survives React re-renders.
function applyNativeHide(tbl, htr) {
  const headNative = nativeCells(htr);
  const bodyRows = [...tbl.querySelectorAll('tbody tr')];
  headNative.forEach((th, i) => {
    const key = nativeKey(th);
    const hide = !!key && key !== 'name' && hiddenNative.includes(key);
    th.classList.toggle('solring-hide-native', hide);
    for (const tr of bodyRows) {
      const cell = nativeCells(tr)[i];
      if (cell) cell.classList.toggle('solring-hide-native', hide);
    }
  });
}

// Per-row actions cell: a CommanderSalt link + a Sync (re-analyze) button. Sync POSTs
// the deck for a fresh analysis (like the deck page's ↻), spins while running, then
// refreshes the row from the new payload. Never auto-syncs — explicit click only.
function buildActionsCell(entry) {
  const cs = el('a', {
    class: 'solring-row-act', text: 'CS', title: 'Open on CommanderSalt',
    attrs: { href: `https://commandersalt.com/details/deck/${entry.md5}`, target: '_blank', rel: 'noopener' },
  });
  // ↻ in its own span so spinning rotates only the icon, not the bordered button.
  const sync = el('button', {
    class: 'solring-row-act solring-row-sync',
    attrs: { type: 'button', title: 'Re-analyze' },
  }, [el('span', { class: 'solring-spin-icon', text: '↻' })]);
  sync.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); syncDeck(entry, sync); });
  return el('span', { class: 'solring-row-acts' }, [cs, sync]);
}

async function syncDeck(entry, btn) {
  const icon = btn && btn.querySelector('.solring-spin-icon');
  if (btn) btn.disabled = true;
  if (icon) icon.classList.add('solring-spin');
  let res = null;
  try {
    res = await importDeck(canonicalDeckUrl(entry.publicId), entry.md5, entry.md5); // POST re-analysis
  } catch (e) {
    console.warn('[solring] deck-list sync failed', e);
  }
  if (res && res.fields) {
    fullByMd5.set(entry.md5, res.fields);
    rerenderMd5(entry.md5); // rebuilds the row (incl. a fresh, un-spun actions cell)
    emitChange();
  } else if (btn) {
    btn.disabled = false;
    if (icon) icon.classList.remove('solring-spin');
  }
}

// Build/rebuild one row's metric cells from its current view, inserted before the
// "Updated" column (idx). A blank full-only cell (deck not yet scanned) is clickable
// to scan just that deck. idx omitted → resolve it from the row's own table header.
function renderRowCells(entry, idx) {
  const tr = entry.row;
  tr.querySelectorAll(':scope > td.solring-col').forEach((n) => n.remove());
  if (idx === undefined) {
    const htr = tr.closest('table') && tr.closest('table').querySelector('thead tr');
    idx = htr ? updatedIndex(htr) : -1;
  }
  const ref = anchorCell(tr, idx);
  const view = viewFor(entry);
  for (const c of enabledColumns()) {
    const td = el('td', { class: 'solring-col text-end', attrs: { 'data-col': c.key } });
    if (c.action) {
      td.append(buildActionsCell(entry));
    } else {
      const inner = c.cell(view);
      td.append(inner || el('span', { class: 'solring-num', text: '—' }));
      if (!inner && !c.hit && !view.analyzed) {
        td.classList.add('solring-col-scan');
        td.title = 'Analyze this deck';
        td.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); expandEntry(entry, td); });
      }
    }
    if (ref) tr.insertBefore(td, ref); else tr.appendChild(td);
  }
}

// Non-deck rows (folders, "up a level", spacers) in a deck table get matching BLANK
// metric cells before "Updated" — otherwise our inserted columns shift the deck rows'
// Updated/⋯ right while the folder rows' stay put, breaking the right-side alignment.
function renderBlankCells(row, idx) {
  row.querySelectorAll(':scope > td.solring-col').forEach((n) => n.remove());
  const ref = anchorCell(row, idx);
  for (const c of enabledColumns()) {
    const td = el('td', { class: 'solring-col solring-col-blank text-end', attrs: { 'data-col': c.key } });
    if (ref) row.insertBefore(td, ref); else row.appendChild(td);
  }
}

// Reconcile every Moxfield deck table to exactly the enabled columns, inserting them
// before the "Updated" column. Each table is handled independently (its own
// <thead>); a table with no joined rows is skipped (and any stale header cells
// removed). This is also the self-heal: rows React recreated without our cells get
// them re-added here.
function reconcileColumns() {
  const sig = colSig();
  const decorated = new Set(); // tables we actually own this pass
  for (const tbl of document.querySelectorAll('table.table')) {
    const htr = tbl.querySelector('thead tr');
    if (!htr) continue;
    const idx = updatedIndex(htr); // native index of "Updated" — same for header + rows
    // Only decorate the MAIN deck-list table: a Name + Updated header AND positively
    // inside the main content column (.flex-grow-1). Moxfield's sidebar widgets
    // ("Most Recent Deck" / "Favorite Decks" / …) are 1-row Name+Updated tables too,
    // so the header alone isn't enough — and a negative "not in .flex-shrink-0" check
    // lets a transiently-positioned sidebar table slip through. Requiring .flex-grow-1
    // is positive and excludes it. (Verified main tables on /users/{name} +
    // /decks/personal are in .flex-grow-1; the sidebar is not.)
    const isDeckList = idx >= 0
      && nativeCells(htr).some((c) => /^name$/i.test((c.textContent || '').trim()))
      && !!tbl.closest('.flex-grow-1');
    if (!isDeckList) {
      tbl.querySelectorAll('.solring-col').forEach((n) => n.remove());
      continue;
    }
    decorated.add(tbl);
    const bodyRows = [...tbl.querySelectorAll('tbody tr')];
    const ours = bodyRows.filter((tr) => rowMap.get(tr));
    if (!ours.length) { // no joined rows yet → strip any stale header cells
      htr.querySelectorAll(':scope > .solring-col').forEach((n) => n.remove());
      continue;
    }
    if (ourColKeys(htr) !== sig) {
      htr.querySelectorAll(':scope > .solring-col').forEach((n) => n.remove());
      const headRef = anchorCell(htr, idx);
      buildHeaderCells().forEach((th) => (headRef ? htr.insertBefore(th, headRef) : htr.appendChild(th)));
    }
    // Every body row keeps the same column count so Updated/⋯ stay aligned: deck rows
    // get metric cells, folder/other rows get matching blank cells.
    for (const tr of bodyRows) {
      if (ourColKeys(tr) === sig) continue; // already current
      const entry = rowMap.get(tr);
      if (entry) renderRowCells(entry, idx); else renderBlankCells(tr, idx);
    }
    applyNativeHide(tbl, htr);
    updateSortIndicators(htr); // ▲/▼ on the active sort column
    applySort(tbl); // reorder deck rows by the active sort (no-op if already sorted)
  }
  // Sweep stray cells anywhere outside the tables we decorated. Moxfield's sidebar
  // ("Most Recent Deck") transiently renders as a table we may decorate before it
  // lands in .flex-shrink-0, then React re-renders it into <div>s — orphaning our
  // <td>s where the per-table strip above can't reach them. Remove any such cells.
  for (const cell of document.querySelectorAll('.solring-col')) {
    if (!decorated.has(cell.closest('table.table'))) cell.remove();
  }
}

// ---- the "Stats columns" toggle menu (our own dropdown in the list toolbar) ---

const COLUMN_NAMES = {
  power: 'Power', bracket: 'Bracket', salt: 'Saltiness', synergy: 'Synergy',
  threat: 'Threat', interaction: 'Interaction', wincons: 'Wincons',
  tier: 'Commander tier', combos: 'Combos', archetype: 'Archetype',
  actions: 'CS link + analysis',
};

let outsideCloseInstalled = false;
function installOutsideClose() {
  if (outsideCloseInstalled) return;
  outsideCloseInstalled = true;
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.solring-colmenu').forEach((wrap) => {
      if (!wrap.contains(e.target)) closeMenu(wrap);
    });
  });
}
function closeMenu(wrap) {
  const panel = wrap.querySelector('.dropdown-menu');
  const btn = wrap.querySelector('.solring-colmenu-btn');
  if (panel) panel.classList.remove('show');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

// A "table-columns" glyph, sized/spaced like the Sort button's leading FA icon.
function columnsIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'svg-inline--fa me-1');
  svg.setAttribute('width', '1em');
  svg.setAttribute('height', '1em');
  const rect = document.createElementNS(NS, 'rect');
  for (const [k, v] of [['x', '3'], ['y', '4'], ['width', '18'], ['height', '16'], ['rx', '2']]) rect.setAttribute(k, v);
  rect.setAttribute('stroke', 'currentColor');
  rect.setAttribute('stroke-width', '2');
  svg.appendChild(rect);
  for (const x of ['9', '15']) {
    const ln = document.createElementNS(NS, 'line');
    for (const [k, v] of [['x1', x], ['y1', '4'], ['x2', x], ['y2', '20']]) ln.setAttribute(k, v);
    ln.setAttribute('stroke', 'currentColor');
    ln.setAttribute('stroke-width', '2');
    svg.appendChild(ln);
  }
  return svg;
}

// All metric columns in the saved display order (enabled or not) — for the menu, so
// reordering works regardless of which are currently shown.
function orderedColumns() {
  const byKey = new Map(COLUMNS.map((c) => [c.key, c]));
  const seen = new Set();
  const out = [];
  for (const k of columnOrder) { const c = byKey.get(k); if (c && !seen.has(k)) { out.push(c); seen.add(k); } }
  for (const c of COLUMNS) if (!seen.has(c.key)) out.push(c);
  return out;
}

// Moxfield's native, label-bearing columns (for the hide section). Icon-only columns
// have no label/key and are omitted.
function nativeColumnsForMenu() {
  const htr = document.querySelector('table.table thead tr');
  if (!htr) return [];
  return nativeCells(htr)
    .map((th) => { const key = nativeKey(th); return key ? { key, label: th.textContent.trim() } : null; })
    .filter(Boolean);
}

let dragColKey = null;
function onDropReorder(targetKey, list) {
  if (!dragColKey || dragColKey === targetKey) return;
  const dragged = list.querySelector(`[data-colkey="${dragColKey}"]`);
  const target = list.querySelector(`[data-colkey="${targetKey}"]`);
  dragColKey = null;
  if (!dragged || !target) return;
  list.insertBefore(dragged, target); // reorder our own menu DOM (stable, not React's)
  const order = [...list.querySelectorAll('[data-colkey]')].map((n) => n.getAttribute('data-colkey'));
  setColumnOrder(order); // → onPrefChange('listColumns') → reconcile repaints the table
}

// A draggable Solring-metric row: grip + show/hide checkbox + label. Drag reorders
// within the menu (our DOM), persisting columnOrder.
function buildSolringItem(c, list) {
  const input = el('input', { class: 'form-check-input m-0', attrs: { type: 'checkbox', id: `solring-colpref-${c.key}` } });
  input.checked = !!listColumns[c.key];
  input.addEventListener('change', () => setListColumns({ [c.key]: input.checked }));
  const grip = el('span', { class: 'solring-grip', text: '⠿', attrs: { 'aria-hidden': 'true', title: 'Drag to reorder' } });
  const item = el('label', {
    class: 'dropdown-item d-flex flex-row flex-nowrap gap-2 align-items-center cursor-pointer no-outline solring-colmenu-row',
    attrs: { for: `solring-colpref-${c.key}`, 'data-colkey': c.key, draggable: 'true' },
  }, [grip, input, el('span', { text: COLUMN_NAMES[c.key] || c.key })]);
  item.addEventListener('dragstart', (e) => { dragColKey = c.key; e.dataTransfer.effectAllowed = 'move'; item.classList.add('solring-dragging'); });
  item.addEventListener('dragend', () => item.classList.remove('solring-dragging'));
  item.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
  item.addEventListener('drop', (e) => { e.preventDefault(); onDropReorder(c.key, list); });
  return item;
}

// A native-column show/hide row. 'name' is pinned (always shown — it carries the
// deck link). Checked = visible; unchecking adds the column to hiddenNative.
function buildNativeItem(n) {
  const pinned = n.key === 'name';
  const input = el('input', { class: 'form-check-input m-0', attrs: { type: 'checkbox', id: `solring-natcol-${n.key}` } });
  input.checked = pinned ? true : !hiddenNative.includes(n.key);
  if (pinned) { input.disabled = true; }
  else {
    input.addEventListener('change', () => {
      const set = new Set(hiddenNative);
      if (input.checked) set.delete(n.key); else set.add(n.key);
      setHiddenNativeCols([...set]);
    });
  }
  return el('label', {
    class: 'dropdown-item d-flex flex-row flex-nowrap gap-2 align-items-center cursor-pointer no-outline',
    attrs: { for: `solring-natcol-${n.key}` },
  }, [input, el('span', { text: n.label })]);
}

// The "Stats" dropdown: a reorderable, toggleable list of Solring metric columns +
// a show/hide list of Moxfield's own columns. Button copies Sort's styling; panel
// uses Moxfield's dropdown chrome so both match the native Sort control.
function buildColumnMenu(sortClassName) {
  const wrap = el('div', { class: 'solring-colmenu', attrs: { 'data-solring-root': '' } });
  const btn = el('button', {
    class: `${sortClassName || 'btn btn-outline btn-outline-primary text-nowrap'} solring-colmenu-btn`,
    attrs: { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
  }, [el('span', {}, [columnsIcon(), 'Stats'])]);
  const inner = el('div', { class: 'dropdown-menu-parent', attrs: { tabindex: '-1' } }, [
    el('div', { class: 'dropdown-header small text-caps text-primary pb-1' }, [el('strong', { text: 'Statistics columns' })]),
  ]);
  const list = el('div', { class: 'solring-colmenu-list' });
  for (const c of orderedColumns()) list.append(buildSolringItem(c, list));
  inner.append(list);
  // Native-columns section is (re)built each time the menu opens — the toolbar can
  // render before the deck table, so the native columns aren't known at build time,
  // and this also keeps the checkboxes in sync with hiddenNative.
  const nativeWrap = el('div', { class: 'solring-native-wrap' });
  inner.append(nativeWrap);
  const populateNative = () => {
    nativeWrap.replaceChildren();
    const native = nativeColumnsForMenu();
    if (!native.length) return;
    nativeWrap.append(el('div', { class: 'dropdown-header small text-caps text-primary pt-2 pb-1' }, [el('strong', { text: 'Moxfield columns' })]));
    for (const n of native) nativeWrap.append(buildNativeItem(n));
  };
  const panel = el('div', { class: 'dropdown-menu dropdown-menu-end' }, [inner]);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const show = !panel.classList.contains('show');
    if (show) populateNative();
    panel.classList.toggle('show', show);
    btn.setAttribute('aria-expanded', String(show));
  });
  wrap.append(btn, panel);
  return wrap;
}

// Inject the menu into the deck-list toolbar (next to Moxfield's native Sort), once
// per toolbar; re-injected by annotate when React rebuilds the toolbar. The button
// copies Sort's exact class list so it stays visually identical.
function ensureToolbarMenu() {
  const sortBtn = [...document.querySelectorAll('button')].find((b) => /^\s*Sort\s*$/i.test((b.textContent || '').trim()));
  const toolbar = sortBtn && sortBtn.parentElement;
  if (!toolbar || toolbar.querySelector(':scope > .solring-colmenu')) return;
  toolbar.insertBefore(buildColumnMenu(sortBtn.className), sortBtn);
}

// ---- DOM: annotate rows ------------------------------------------------------

// Fetch a deck's full payload into the shared md5 cache, then re-render every row
// of that deck. `allowFetch` false = cache-only probe (no network).
async function loadFull(md5, { allowFetch }) {
  if (fullByMd5.has(md5)) return true;
  let res = null;
  try {
    res = await getDeck(md5, { allowFetch: !!allowFetch });
  } catch (e) {
    console.warn('[solring] deck-list getDeck failed', e);
  }
  if (res && res.fields) {
    fullByMd5.set(md5, res.fields);
    rerenderMd5(md5);
    emitChange();
    return true;
  }
  return false;
}

// Cache-only probe for a deck's full payload (once per md5 per session).
function probeCache(md5) {
  if (fullByMd5.has(md5) || checkedCache.has(md5)) return;
  checkedCache.add(md5);
  loadFull(md5, { allowFetch: false });
}

// Manual "Analyze" (click a blank cell) → force a fetch (GET/import) of the full payload.
async function expandEntry(entry, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing…'; }
  const ok = await loadFull(entry.md5, { allowFetch: true });
  if (!ok && btn) { btn.disabled = false; btn.textContent = 'Analysis - retry'; }
}

// Re-render the metric cells of every row showing this deck (duplicate folder rows
// included) — e.g. after its full payload loads.
function rerenderMd5(md5) {
  for (const e of rowEntries) if (e.md5 === md5) renderRowCells(e);
}

/** Fold a freshly-fetched full payload into the shared cache and repaint the deck's
    rows + notify subscribers (averages). Used by bulk sync after scanning a deck. */
export function setFull(md5, fields) {
  if (!md5 || !fields) return;
  fullByMd5.set(md5, fields);
  rerenderMd5(md5);
  emitChange();
}

function annotate() {
  const next = [];
  for (const { row, publicId } of deckRows()) {
    const md5 = deckMd5(canonicalDeckUrl(publicId));
    const hit = hitMap.get(md5) || null;
    const entry = { md5, publicId, row, hit };
    next.push(entry);
    rowMap.set(row, entry); // maps the (possibly newly-rendered) row → its deck
    probeCache(md5); // fold in an already-cached full payload (no network)
  }
  rowEntries = next;
  reconcileColumns(); // add/refresh/heal our columns across all deck tables
  ensureToolbarMenu(); // (re)inject the Stats-columns toggle into the toolbar
  emitChange();
}

function scheduleAnnotate() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    guard('deck-list annotate', () => annotate());
  });
}

// Remove any of our cells that aren't inside a main-content (.flex-grow-1) deck table.
// React renders Moxfield's sidebar "Most Recent Deck" as a table inside .flex-grow-1
// just long enough for us to decorate it, then reparents our <td>s into the sidebar
// (.flex-shrink-0) divs — orphaning them where reconcile's per-table strip can't see
// them. This sweep is idempotent (only removes), so running it on every mutation is
// loop-safe (the relevance filter that drives annotate intentionally ignores our own
// nodes, so it wouldn't otherwise fire on that reparent).
function sweepStrayCols() {
  for (const cell of document.querySelectorAll('.solring-col')) {
    const t = cell.closest('table.table');
    if (!t || !t.closest('.flex-grow-1')) cell.remove();
  }
}
let sweepRaf = null;
function scheduleSweep() {
  if (sweepRaf) return;
  sweepRaf = requestAnimationFrame(() => { sweepRaf = null; guard('deck-list sweep', sweepStrayCols); });
}

// ---- entry point -------------------------------------------------------------

/** Install the deck-list strips for `username`. Loads all search hits, annotates
    every deck row, and keeps re-annotating across Moxfield's SPA re-renders. */
export async function installDeckList(username, { waitFor } = {}) {
  if (!username) return;
  [listColumns, columnOrder, hiddenNative, sortState] = await Promise.all([getListColumns(), getColumnOrder(), getHiddenNativeCols(), getSortPref()]);
  installOutsideClose();
  installNativeSortYield();
  if (!prefSubscribed) {
    prefSubscribed = true;
    onPrefChange(async (which) => {
      if (which === 'listColumns') {
        [listColumns, columnOrder, hiddenNative] = await Promise.all([getListColumns(), getColumnOrder(), getHiddenNativeCols()]);
        guard('deck-list reconcile', () => reconcileColumns());
      } else if (which === 'sort') {
        sortState = await getSortPref();
        guard('deck-list sort', () => reconcileColumns());
      }
    });
  }
  // Wait for the first deck row to exist (Moxfield renders the list async).
  if (waitFor) await waitFor('a[href*="/decks/"]');
  hitMap = await loadAllHits(username);
  rowEntries = [];
  rowMap = new WeakMap();
  annotate();
  if (!listObserver) {
    listObserver = new MutationObserver((mutations) => {
      // Always sweep cells React may have reparented out of the main table (cheap,
      // idempotent — see sweepStrayCols). The relevance check below ignores our own
      // nodes, so it would miss that reparent; the sweep covers it.
      scheduleSweep();
      // Re-annotate when Moxfield adds/replaces rows; ignore our OWN injected nodes
      // (any solring-* class), or inserting our cells would re-trigger forever.
      const relevant = mutations.some((m) => [...m.addedNodes].some((n) => {
        if (n.nodeType !== 1) return false;
        const cls = typeof n.className === 'string' ? n.className : '';
        return !cls.includes('solring');
      }));
      if (relevant) scheduleAnnotate();
    });
  }
  listObserver.observe(document.body, { childList: true, subtree: true });
}

/** Tear down observers + state and remove our injected columns (SPA navigation away
    from the list). Our cells aren't tagged data-solring-root, so dom.teardown leaves
    them — we remove them here. */
export function teardownDeckList() {
  if (listObserver) { listObserver.disconnect(); listObserver = null; }
  document.querySelectorAll('.solring-col, .solring-colmenu').forEach((n) => n.remove());
  document.querySelectorAll('.solring-hide-native').forEach((n) => n.classList.remove('solring-hide-native'));
  rowEntries = [];
  rowMap = new WeakMap();
  hitMap = new Map();
  fullByMd5 = new Map();
  checkedCache = new Set();
}
