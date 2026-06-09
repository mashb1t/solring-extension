// Global card-display + sort preferences, persisted in chrome.storage.local and
// synced across open tabs via chrome.storage.onChanged. Read directly from the
// content script (chrome.storage is available in both contexts).

const CARD_KEY = 'prefs:cardData';
const SORT_KEY = 'prefs:sort';
const OPTIONS_KEY = 'prefs:options';

const CARD_DEFAULT = { power: true, saltValue: true, tags: true, stats: true, combos: true };
const SORT_DEFAULT = { key: null, dir: 'desc' };

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
  cacheLifetimeDays: 7,
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
  const next = { ...(await getOptions()), ...patch };
  await chrome.storage.local.set({ [OPTIONS_KEY]: next });
  return next;
}

/** Subscribe to pref changes. cb(which) where which is 'card' | 'sort' | 'options'. */
export function onPrefChange(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (CARD_KEY in changes) cb('card');
    if (SORT_KEY in changes) cb('sort');
    if (OPTIONS_KEY in changes) cb('options');
  });
}
