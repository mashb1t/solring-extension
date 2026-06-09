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

let hitMap = new Map(); // md5 → hit
let entries = new Map(); // md5 → { md5, publicId, row, hit, full, view }
const subscribers = new Set();
let listObserver = null;
let rafPending = false;

/** Subscribe to deck-list changes (initial load, per-row expand, bulk sync).
    Returns an unsubscribe fn. Used by the profile averages + sync surfaces. */
export function onDeckListChange(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
function emitChange() {
  for (const cb of subscribers) guard('deck-list subscriber', () => cb());
}

/** Current per-deck views (one per joined deck row). */
export function getViews() {
  return [...entries.values()].map((e) => e.view);
}
export function getEntries() {
  return [...entries.values()];
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

function buildStrip(entry, onExpand) {
  const v = entry.view;
  const strip = el('div', { class: 'solring-strip', attrs: { 'data-solring-root': '' } });
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
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onExpand(entry, btn); });
    strip.append(btn);
  }
  return strip;
}

// ---- DOM: annotate rows ------------------------------------------------------

async function fillEntry(entry, { allowFetch }) {
  let res = null;
  try {
    res = await getDeck(entry.md5, { allowFetch: !!allowFetch });
  } catch (e) {
    console.warn('[solring] deck-list getDeck failed', e);
  }
  const full = res && res.fields ? res.fields : null;
  entry.full = full;
  entry.view = mergeView(entry.hit, full);
  return entry;
}

async function onExpand(entry, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }
  await fillEntry(entry, { allowFetch: true });
  renderRow(entry); // replace the strip with the filled one
  emitChange();
}

// Render (or re-render) one row's strip, idempotently.
function renderRow(entry) {
  const existing = entry.row.querySelector(':scope > .solring-strip');
  if (existing) existing.remove();
  const strip = buildStrip(entry, onExpand);
  entry.row.append(strip);
}

function annotate() {
  for (const { row, publicId } of deckRows()) {
    const md5 = deckMd5(canonicalDeckUrl(publicId));
    const prev = entries.get(md5);
    const hasStrip = !!row.querySelector(':scope > .solring-strip');
    if (prev && prev.row === row && hasStrip) continue; // already current on this row
    // Reuse any full payload we already fetched/expanded for this deck.
    const full = prev ? prev.full : null;
    const hit = hitMap.get(md5) || null;
    const entry = { md5, publicId, row, hit, full, view: mergeView(hit, full) };
    entries.set(md5, entry);
    renderRow(entry); // hit metrics immediately
    if (!full) {
      // Fold in an already-cached full payload (no network), if any.
      fillEntry(entry, { allowFetch: false }).then(() => {
        if (entry.full && entries.get(md5) === entry) { renderRow(entry); emitChange(); }
      });
    }
  }
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
  entries = new Map();
  annotate();
  if (!listObserver) {
    listObserver = new MutationObserver((mutations) => {
      // Ignore our own strip churn; re-annotate when Moxfield adds/replaces rows.
      const relevant = mutations.some((m) => [...m.addedNodes].some(
        (n) => n.nodeType === 1 && !(n.classList && n.classList.contains('solring-strip')),
      ));
      if (relevant) scheduleAnnotate();
    });
  }
  listObserver.observe(document.body, { childList: true, subtree: true });
}

/** Tear down observers + state (SPA navigation away from the list). */
export function teardownDeckList() {
  if (listObserver) { listObserver.disconnect(); listObserver = null; }
  entries = new Map();
  hitMap = new Map();
}
