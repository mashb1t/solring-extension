// Global card-display + sort preferences, persisted in chrome.storage.local and
// synced across open tabs via chrome.storage.onChanged. Read directly from the
// content script (chrome.storage is available in both contexts).

const CARD_KEY = 'prefs:cardData';
const SORT_KEY = 'prefs:sort';
const CARD_SORT_KEY = 'prefs:cardSortView'; // deck-view card sort (power/salt/synergy)
const OPTIONS_KEY = 'prefs:options';
const LIST_COLUMNS_KEY = 'prefs:listColumns';
const LIST_ORDER_KEY = 'prefs:listColumnOrder';
const HIDDEN_NATIVE_KEY = 'prefs:hiddenNativeCols';
const WIDE_KEY = 'prefs:wide';

// Deck-view card sort: which per-card metric orders the cards within each type group, and
// direction. key null = leave Moxfield's own order. key ∈ 'power' | 'salt' | 'synergy'.
const CARD_SORT_DEFAULT = { key: null, dir: 'desc' };

// Per-card toggles (Customize View, Include Extra Data). On by default: power and
// saltiness, the at-a-glance numbers. Off by default (opt-in): synergy and tags, to
// keep the default rows compact.
const CARD_DEFAULT = { power: true, saltValue: true, synergy: false, tags: false };
const SORT_DEFAULT = { key: null, dir: 'desc' };

// One serialization queue for every read-modify-write setter. chrome.storage.local
// has no atomic update, so two setters firing in the same tick both read the old value
// and the last write wins, silently dropping a patch. Chaining each write onto the
// previous defers the next read until the prior write lands. Errors don't break the
// chain (a failed write must not wedge later ones).
let writeChain = Promise.resolve();
function enqueue(fn) {
  const next = writeChain.then(fn, fn);
  writeChain = next.catch(() => {});
  return next;
}

// Deck-list metric columns (user profile and personal manager). All are togglable via
// the deck-list "Stats columns" menu. A small subset is on by default so the table
// width stays sane. Keys match decklist.js COLUMNS.
export const LIST_COLUMNS_DEFAULT = {
  power: true,
  bracket: true,
  tier: false,
  manabase: false,
  threat: false,
  salt: true,
  interaction: false,
  wincons: false,
  combos: false,
  synergy: false,
  archetype: false,
  actions: true,
};

// Options-panel settings. null colors mean "not customized" (keep the auto-themed CSS
// defaults). Thresholds: power is a multiple of the deck average, salt is absolute,
// synergy is a percentile of the deck. cacheLifetimeDays 0 means never expire.
export const OPTIONS_DEFAULT = {
  autoFetch: true,
  powerThreshold: 2,
  powerColor: null,
  saltThreshold: 5,
  saltColor: null,
  synergyPercentile: 90, // mark synergy at/above this percentile of the deck (top decile)
  synergyColor: null,
  ratingColors: { a: null, b: null, c: null, d: null },
  cardPanelModal: true,
  cardPanelSidebar: true,
  deckPanelDefault: 'auto', // 'auto' | 'open' | 'collapsed'
  accordion: true, // deck report-card: only one metric tile open at a time
  cacheLifetimeDays: 30,
};

export async function getCardPrefs() {
  const obj = await chrome.storage.local.get(CARD_KEY);
  return { ...CARD_DEFAULT, ...(obj[CARD_KEY] || {}) };
}
export function setCardPrefs(patch) {
  return enqueue(async () => {
    const next = { ...(await getCardPrefs()), ...patch };
    await chrome.storage.local.set({ [CARD_KEY]: next });
    return next;
  });
}

export async function getCardSortView() {
  const obj = await chrome.storage.local.get(CARD_SORT_KEY);
  return { ...CARD_SORT_DEFAULT, ...(obj[CARD_SORT_KEY] || {}) };
}
export function setCardSortView(patch) {
  return enqueue(async () => {
    const next = { ...(await getCardSortView()), ...patch };
    await chrome.storage.local.set({ [CARD_SORT_KEY]: next });
    return next;
  });
}

export async function getSortPref() {
  const obj = await chrome.storage.local.get(SORT_KEY);
  return { ...SORT_DEFAULT, ...(obj[SORT_KEY] || {}) };
}
export function setSortPref(patch) {
  return enqueue(async () => {
    const next = { ...(await getSortPref()), ...patch };
    await chrome.storage.local.set({ [SORT_KEY]: next });
    return next;
  });
}

export async function getOptions() {
  const obj = await chrome.storage.local.get(OPTIONS_KEY);
  const stored = obj[OPTIONS_KEY] || {};
  return {
    ...OPTIONS_DEFAULT,
    ...stored,
    ratingColors: { ...OPTIONS_DEFAULT.ratingColors, ...(stored.ratingColors || {}) },
  };
}
export function setOptions(patch) {
  return enqueue(async () => {
    const cur = await getOptions();
    const next = { ...cur, ...patch };
    if (patch.ratingColors) next.ratingColors = { ...cur.ratingColors, ...patch.ratingColors };
    await chrome.storage.local.set({ [OPTIONS_KEY]: next });
    return next;
  });
}

export async function getListColumns() {
  const obj = await chrome.storage.local.get(LIST_COLUMNS_KEY);
  return { ...LIST_COLUMNS_DEFAULT, ...(obj[LIST_COLUMNS_KEY] || {}) };
}
export function setListColumns(patch) {
  return enqueue(async () => {
    const next = { ...(await getListColumns()), ...patch };
    await chrome.storage.local.set({ [LIST_COLUMNS_KEY]: next });
    return next;
  });
}

// Display order of the Solring metric columns (array of keys). [] means use the
// default COLUMNS order. Unknown or new keys fall back to default order in decklist.js.
export async function getColumnOrder() {
  const obj = await chrome.storage.local.get(LIST_ORDER_KEY);
  return Array.isArray(obj[LIST_ORDER_KEY]) ? obj[LIST_ORDER_KEY] : [];
}
export function setColumnOrder(order) {
  return enqueue(async () => {
    await chrome.storage.local.set({ [LIST_ORDER_KEY]: Array.isArray(order) ? order : [] });
    return order;
  });
}

// Moxfield native columns to hide (array of lowercased header labels, e.g. 'colors').
export async function getHiddenNativeCols() {
  const obj = await chrome.storage.local.get(HIDDEN_NATIVE_KEY);
  return Array.isArray(obj[HIDDEN_NATIVE_KEY]) ? obj[HIDDEN_NATIVE_KEY] : [];
}
export async function setHiddenNativeCols(keys) {
  await chrome.storage.local.set({ [HIDDEN_NATIVE_KEY]: Array.isArray(keys) ? keys : [] });
  return keys;
}

// Wide layout: drop Moxfield's container max-widths so pages use the full viewport.
export async function getWide() {
  return !!(await getPrefRaw(WIDE_KEY, false));
}
export async function setWide(on) {
  await chrome.storage.local.set({ [WIDE_KEY]: !!on });
  return !!on;
}
async function getPrefRaw(key, fallback) {
  const obj = await chrome.storage.local.get(key);
  return key in obj ? obj[key] : fallback;
}

/** Subscribe to pref changes. cb(which) where which is one of
    'card', 'sort', 'options', 'listColumns', 'wide'. Returns an unsubscribe fn so
    callers re-installed across SPA navigation don't stack storage listeners. */
export function onPrefChange(cb) {
  const listener = (changes, area) => {
    if (area !== 'local') return;
    if (CARD_KEY in changes || CARD_SORT_KEY in changes) cb('card'); // card sort re-runs the annotate pass
    if (SORT_KEY in changes) cb('sort');
    if (OPTIONS_KEY in changes) cb('options');
    if (LIST_COLUMNS_KEY in changes || LIST_ORDER_KEY in changes || HIDDEN_NATIVE_KEY in changes) cb('listColumns');
    if (WIDE_KEY in changes) cb('wide');
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
