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
import { getUserDecks, getDeck } from './messaging.js';
import { csRatingGrade } from './ratings.js';
import { getListColumns, setListColumns, onPrefChange } from './prefs.js';
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
  tier: { label: 'Cmd. tier', get: (v) => v.commanderTier, hit: false },
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
let prefSubscribed = false; // onPrefChange wired only once
const subscribers = new Set();
let listObserver = null;
let rafPending = false;

// The view for a row = its hit merged with any shared full payload for that deck.
function viewFor(entry) {
  return mergeView(entry.hit, fullByMd5.get(entry.md5) || null);
}

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
    const publicId = parseDeckId(a.href);
    const row = rowOf(a);
    if (!row || seen.has(row)) continue;
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
];

function enabledColumns() {
  return COLUMNS.filter((c) => listColumns[c.key]);
}
// Signature of the enabled set, to detect when a row/header needs rebuilding.
function colSig() {
  return enabledColumns().map((c) => c.key).join(',');
}
function ourColKeys(container) {
  return [...container.querySelectorAll(':scope > .solring-col')].map((n) => n.getAttribute('data-col')).join(',');
}

function buildHeaderCells() {
  return enabledColumns().map((c) => el('th', {
    class: 'solring-col solring-col-h text-end text-nowrap', title: c.title, attrs: { 'data-col': c.key },
  }, [el('span', { text: c.label })]));
}

// Build/rebuild one row's metric cells from its current view. A blank full-only cell
// (deck not yet scanned) is clickable to scan just that deck.
function renderRowCells(entry) {
  const tr = entry.row;
  tr.querySelectorAll(':scope > td.solring-col').forEach((n) => n.remove());
  const view = viewFor(entry);
  for (const c of enabledColumns()) {
    const inner = c.cell(view);
    const td = el('td', { class: 'solring-col text-end', attrs: { 'data-col': c.key } }, [inner || el('span', { class: 'solring-num', text: '—' })]);
    if (!inner && !c.hit && !view.analyzed) {
      td.classList.add('solring-col-scan');
      td.title = 'Scan this deck on CommanderSalt';
      td.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); expandEntry(entry, td); });
    }
    tr.appendChild(td);
  }
}

// Reconcile every Moxfield deck table to exactly the enabled columns. Each table is
// handled independently (its own <thead>); a table with no joined rows is skipped
// (and any stale header cells removed). This is also the self-heal: rows React
// recreated without our cells get them re-added here.
function reconcileColumns() {
  const sig = colSig();
  for (const tbl of document.querySelectorAll('table.table')) {
    const htr = tbl.querySelector('thead tr');
    if (!htr) continue;
    const bodyRows = [...tbl.querySelectorAll('tbody tr')];
    const ours = bodyRows.filter((tr) => rowMap.get(tr));
    if (!ours.length) { // not one of our deck tables → strip any stale header cells
      htr.querySelectorAll(':scope > .solring-col').forEach((n) => n.remove());
      continue;
    }
    if (ourColKeys(htr) !== sig) {
      htr.querySelectorAll(':scope > .solring-col').forEach((n) => n.remove());
      buildHeaderCells().forEach((th) => htr.appendChild(th));
    }
    for (const tr of ours) {
      if (ourColKeys(tr) !== sig) renderRowCells(rowMap.get(tr));
    }
  }
}

// ---- the "Stats columns" toggle menu (our own dropdown in the list toolbar) ---

const COLUMN_NAMES = {
  power: 'Power', bracket: 'Bracket', salt: 'Saltiness', synergy: 'Synergy',
  threat: 'Threat', interaction: 'Interaction', wincons: 'Wincons',
  tier: 'Commander tier', combos: 'Combos', archetype: 'Archetype',
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

// A dropdown of per-metric checkboxes, persisted to prefs:listColumns (which fires
// onPrefChange('listColumns') → reconcileColumns). The button copies Moxfield's Sort
// button styling (passed in) and the panel uses Moxfield's dropdown-menu / -item /
// -header classes, so both match the native Sort control.
function buildColumnMenu(sortClassName) {
  const wrap = el('div', { class: 'solring-colmenu', attrs: { 'data-solring-root': '' } });
  const btn = el('button', {
    class: `${sortClassName || 'btn btn-outline btn-outline-primary text-nowrap'} solring-colmenu-btn`,
    attrs: { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
  }, [el('span', {}, [columnsIcon(), 'Stats'])]);
  const inner = el('div', { class: 'dropdown-menu-parent', attrs: { tabindex: '-1' } }, [
    el('div', { class: 'dropdown-header small text-caps text-primary pb-1' }, [el('strong', { text: 'Columns' })]),
  ]);
  for (const c of COLUMNS) {
    const input = el('input', { class: 'form-check-input m-0', attrs: { type: 'checkbox', id: `solring-colpref-${c.key}` } });
    input.checked = !!listColumns[c.key];
    input.addEventListener('change', () => setListColumns({ [c.key]: input.checked }));
    inner.append(el('label', {
      class: 'dropdown-item d-flex flex-row flex-nowrap gap-2 align-items-center cursor-pointer no-outline',
      attrs: { for: `solring-colpref-${c.key}` },
    }, [input, el('span', { text: COLUMN_NAMES[c.key] || c.key })]));
  }
  const panel = el('div', { class: 'dropdown-menu dropdown-menu-end' }, [inner]);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const show = !panel.classList.contains('show');
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

// Manual "Scan" → force a fetch (GET/import) of the full payload.
async function expandEntry(entry, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }
  const ok = await loadFull(entry.md5, { allowFetch: true });
  if (!ok && btn) { btn.disabled = false; btn.textContent = 'Scan — retry'; }
}

// Re-render the metric cells of every row showing this deck (duplicate folder rows
// included) — e.g. after its full payload loads.
function rerenderMd5(md5) {
  for (const e of rowEntries) if (e.md5 === md5) renderRowCells(e);
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

// ---- entry point -------------------------------------------------------------

/** Install the deck-list strips for `username`. Loads all search hits, annotates
    every deck row, and keeps re-annotating across Moxfield's SPA re-renders. */
export async function installDeckList(username, { waitFor } = {}) {
  if (!username) return;
  listColumns = await getListColumns();
  installOutsideClose();
  if (!prefSubscribed) {
    prefSubscribed = true;
    onPrefChange(async (which) => {
      if (which !== 'listColumns') return;
      listColumns = await getListColumns();
      guard('deck-list reconcile', () => reconcileColumns());
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
      // Re-annotate when Moxfield adds/replaces rows; ignore our OWN injected nodes
      // (any solring-* class), or inserting the strip <tr> would re-trigger forever.
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
  rowEntries = [];
  rowMap = new WeakMap();
  hitMap = new Map();
  fullByMd5 = new Map();
  checkedCache = new Set();
}
