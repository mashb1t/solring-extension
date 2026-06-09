// Shared deck-list engine for the user profile (/users/{name}) and the personal
// deck manager (/decks/personal + folders). For each deck row it appends a
// below-line "detail strip" of CommanderSalt metrics, joining the row (a Moxfield
// publicId) to a CommanderSalt search hit via md5, and filling full-payload-only
// metrics from cache (or on demand when a row is expanded).
//
// The join key: a hit carries only its CommanderSalt deckId (an md5), never the
// Moxfield publicId — so we map each DOM row's publicId through
// deckMd5(canonicalDeckUrl(publicId)) and match that against hit.deckId. Proven by
// the md5 known-vector test.
//
// DOM selectors here are anchored on content/structure (deck links + the repeating
// row unit), not Moxfield's hashed class names, and every pass is guarded +
// idempotent so an SPA re-render never duplicates strips or breaks the page.
// LIVE-VERIFY: row-unit detection + strip placement want a confirmation pass on a
// live /users/{name} and /decks/personal.

import { deckMd5, canonicalDeckUrl } from './md5.js';
import { parseDeckId } from './moxfield.js';
import { getUserDecks, getDeck } from './messaging.js';
import { csRatingGrade } from './ratings.js';
import { el, guard } from './dom.js';
import { gradeChip, bracketValue, miniBar } from './components.js';

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

// ---- DOM: the detail strip ---------------------------------------------------

const num = (n, d = 1) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : '—');

// One metric cell: a label + a value node (grade chip / number / bar).
function cell(label, valueNode) {
  return el('span', { class: 'solring-strip-cell' }, [
    el('span', { class: 'solring-strip-k', text: label }),
    el('span', { class: 'solring-strip-v' }, valueNode),
  ]);
}
function gradeOrDash(value, field) {
  return typeof value === 'number' && Number.isFinite(value) ? gradeChip(csRatingGrade(value, field)) : el('span', { class: 'solring-num', text: '—' });
}

function buildStrip(entry, v) {
  const strip = el('div', { class: 'solring-strip' });
  const cells = [];
  cells.push(cell('Power', typeof v.power === 'number'
    ? el('span', { class: 'solring-strip-power' }, [el('span', { class: 'solring-num', text: `${num(v.power)}` }), miniBar('', '', (v.power || 0) * 10)])
    : el('span', { class: 'solring-num', text: '—' })));
  cells.push(cell('Bracket', bracketValue(v)));
  cells.push(cell('Salt', gradeOrDash(v.salt, 'saltRating')));
  cells.push(cell('Synergy', gradeOrDash(v.synergy, 'synergyRating')));
  cells.push(cell('Threat', gradeOrDash(v.threat, 'threatRating')));
  cells.push(cell('Inter.', gradeOrDash(v.interaction, 'interactionRating')));
  cells.push(cell('Wincons', gradeOrDash(v.wincons, 'comboRating')));
  if (v.commanderTier != null) cells.push(cell('Tier', el('span', { class: 'solring-num', text: `T${v.commanderTier}` })));
  if (v.combosCount != null) cells.push(cell('Combos', el('span', { class: 'solring-num', text: String(v.combosCount) })));
  if (v.archetype) cells.push(el('span', { class: 'solring-strip-arch', text: v.archetype }));
  strip.append(...cells);

  // CommanderSalt link for the deck.
  const csUrl = `https://commandersalt.com/decks/${entry.md5}`;
  strip.append(el('a', {
    class: 'solring-strip-link', text: 'CS', title: 'Open on CommanderSalt',
    attrs: { href: csUrl, target: '_blank', rel: 'noopener' },
  }));

  // Un-analyzed (or hit-only) rows get an expand affordance to fetch the full payload.
  if (!v.analyzed) {
    const btn = el('button', {
      class: 'solring-strip-expand', text: 'Scan',
      attrs: { type: 'button', title: 'Fetch full CommanderSalt analysis' },
    });
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); expandEntry(entry, btn); });
    strip.append(btn);
  }
  return strip;
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

// Re-render every row currently showing this deck (duplicate folder rows included).
function rerenderMd5(md5) {
  for (const e of rowEntries) if (e.md5 === md5) renderRow(e);
}

// Is `row` already annotated? A table row's strip is its sibling <tr>; other
// layouts hold the strip as a child <div>.
function hasStrip(row) {
  if (row.tagName === 'TR') {
    const next = row.nextElementSibling;
    return !!(next && next.classList && next.classList.contains('solring-strip-row'));
  }
  return !!row.querySelector(':scope > .solring-strip');
}
function removeStrip(row) {
  if (row.tagName === 'TR') {
    const next = row.nextElementSibling;
    if (next && next.classList && next.classList.contains('solring-strip-row')) next.remove();
    return;
  }
  const ex = row.querySelector(':scope > .solring-strip');
  if (ex) ex.remove();
}

// Render (or re-render) one row's strip, idempotently and layout-aware. Verified
// live on /users/{name}: the list is a <table>, so a <div> can't sit inside the
// <tr> — the strip rides in a sibling <tr> with a full-width (colspan) cell.
function renderRow(entry) {
  removeStrip(entry.row);
  const strip = buildStrip(entry, viewFor(entry));
  if (entry.row.tagName === 'TR') {
    const tr = el('tr', { class: 'solring-strip-row', attrs: { 'data-solring-root': '' } }, [
      el('td', { class: 'solring-strip-td', attrs: { colspan: '99' } }, [strip]),
    ]);
    entry.row.insertAdjacentElement('afterend', tr);
  } else {
    strip.setAttribute('data-solring-root', '');
    entry.row.append(strip);
  }
}

function annotate() {
  const next = [];
  for (const { row, publicId } of deckRows()) {
    const md5 = deckMd5(canonicalDeckUrl(publicId));
    const hit = hitMap.get(md5) || null;
    const entry = { md5, publicId, row, hit };
    next.push(entry);
    const prev = rowMap.get(row);
    rowMap.set(row, entry);
    // (Re)render when the strip is missing or this row now shows a different deck.
    if (!(prev && prev.md5 === md5) || !hasStrip(row)) renderRow(entry);
    probeCache(md5); // fold in an already-cached full payload (no network)
  }
  rowEntries = next;
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

/** Tear down observers + state (SPA navigation away from the list). */
export function teardownDeckList() {
  if (listObserver) { listObserver.disconnect(); listObserver = null; }
  rowEntries = [];
  rowMap = new WeakMap();
  hitMap = new Map();
  fullByMd5 = new Map();
  checkedCache = new Set();
}
