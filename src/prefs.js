// Global card-display + sort preferences, persisted in chrome.storage.local and
// synced across open tabs via chrome.storage.onChanged. Read directly from the
// content script (chrome.storage is available in both contexts).

const CARD_KEY = 'prefs:cardData';
const SORT_KEY = 'prefs:sort';
const OPTIONS_KEY = 'prefs:options';
const LIST_COLUMNS_KEY = 'prefs:listColumns';
const LIST_ORDER_KEY = 'prefs:listColumnOrder';
const HIDDEN_NATIVE_KEY = 'prefs:hiddenNativeCols';
const WIDE_KEY = 'prefs:wide';

const CARD_DEFAULT = { power: true, saltValue: true, tags: true, stats: true, combos: true };
const SORT_DEFAULT = { key: null, dir: 'desc' };

// Deck-list metric columns (user profile + personal manager). All are togglable via
// the deck-list "Stats columns" menu; a small subset is on by default so the table
// width stays sane. Keys match decklist.js COLUMNS.
export const LIST_COLUMNS_DEFAULT = {
  power: true,
  bracket: true,
  salt: true,
  synergy: false,
  threat: false,
  interaction: false,
  wincons: false,
  tier: false,
  combos: false,
  archetype: false,
};

// Options-panel settings. null colors = "not customized" (keep the auto-themed CSS
// defaults). Thresholds: power = ×deck-average, salt = absolute. cacheLifetimeDays
// 0 = never expire.
export const OPTIONS_DEFAULT = {
  autoFetch: true,
  powerThreshold: 2,
  powerColor: null,
  saltThreshold: 5,
  saltColor: null,
  ratingColors: { a: null, b: null, c: null, d: null },
  cardPanelModal: true,
  cardPanelSidebar: true,
  deckPanelDefault: 'auto', // 'auto' | 'open' | 'collapsed'
  cacheLifetimeDays: 30,
};

export async function getCardPrefs() {
  const obj = await chrome.storage.local.get(CARD_KEY);
  return { ...CARD_DEFAULT, ...(obj[CARD_KEY] || {}) };
}
export async function setCardPrefs(patch) {
  const next = { ...(await getCardPrefs()), ...patch };
  await chrome.storage.local.set({ [CARD_KEY]: next });
  return next;
}

export async function getSortPref() {
  const obj = await chrome.storage.local.get(SORT_KEY);
  return { ...SORT_DEFAULT, ...(obj[SORT_KEY] || {}) };
}
export async function setSortPref(patch) {
  const next = { ...(await getSortPref()), ...patch };
  await chrome.storage.local.set({ [SORT_KEY]: next });
  return next;
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
export async function setOptions(patch) {
  const cur = await getOptions();
  const next = { ...cur, ...patch };
  if (patch.ratingColors) next.ratingColors = { ...cur.ratingColors, ...patch.ratingColors };
  await chrome.storage.local.set({ [OPTIONS_KEY]: next });
  return next;
}

export async function getListColumns() {
  const obj = await chrome.storage.local.get(LIST_COLUMNS_KEY);
  return { ...LIST_COLUMNS_DEFAULT, ...(obj[LIST_COLUMNS_KEY] || {}) };
}
export async function setListColumns(patch) {
  const next = { ...(await getListColumns()), ...patch };
  await chrome.storage.local.set({ [LIST_COLUMNS_KEY]: next });
  return next;
}

// Display order of the Solring metric columns (array of keys). [] = use the default
// COLUMNS order. Unknown/new keys fall back to default order in decklist.js.
export async function getColumnOrder() {
  const obj = await chrome.storage.local.get(LIST_ORDER_KEY);
  return Array.isArray(obj[LIST_ORDER_KEY]) ? obj[LIST_ORDER_KEY] : [];
}
export async function setColumnOrder(order) {
  await chrome.storage.local.set({ [LIST_ORDER_KEY]: Array.isArray(order) ? order : [] });
  return order;
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

/** Subscribe to pref changes. cb(which) where which is
    'card' | 'sort' | 'options' | 'listColumns' | 'wide'. */
export function onPrefChange(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (CARD_KEY in changes) cb('card');
    if (SORT_KEY in changes) cb('sort');
    if (OPTIONS_KEY in changes) cb('options');
    if (LIST_COLUMNS_KEY in changes || LIST_ORDER_KEY in changes || HIDDEN_NATIVE_KEY in changes) cb('listColumns');
    if (WIDE_KEY in changes) cb('wide');
  });
}
