// Global card-display + sort preferences, persisted in chrome.storage.local and
// synced across open tabs via chrome.storage.onChanged. Read directly from the
// content script (chrome.storage is available in both contexts).

const CARD_KEY = 'prefs:cardData';
const SORT_KEY = 'prefs:sort';

const CARD_DEFAULT = { saltValue: true, tags: true, stats: true, combos: true };
const SORT_DEFAULT = { key: null, dir: 'desc' };

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

/** Subscribe to pref changes. cb(which) where which is 'card' | 'sort'. */
export function onPrefChange(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (CARD_KEY in changes) cb('card');
    if (SORT_KEY in changes) cb('sort');
  });
}
