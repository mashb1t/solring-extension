// Persistent cache + prefs over chrome.storage.local. Stores only extracted
// display fields (never raw payloads). Stale-while-revalidate + in-flight
// de-duplication. Used by the background service worker.

export const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const inFlight = new Map();

export async function getEntry(key) {
  const obj = await chrome.storage.local.get(key);
  return obj[key] || null; // { fetchedAt, data } | null
}

export async function setEntry(key, data) {
  const entry = { fetchedAt: Date.now(), data };
  await chrome.storage.local.set({ [key]: entry });
  return entry;
}

export function isFresh(entry, ttl = TTL_MS) {
  return !!entry && Date.now() - entry.fetchedAt < ttl;
}

/** Share one Promise for concurrent requests of the same key. */
export function dedupe(key, fn) {
  if (inFlight.has(key)) return inFlight.get(key);
  const p = Promise.resolve()
    .then(fn)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

// ---- prefs (global, no TTL) ----
export async function getPref(key, fallback) {
  const obj = await chrome.storage.local.get(key);
  return key in obj ? obj[key] : fallback;
}
export async function setPref(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

// ---- per-user sync timestamps ----
export async function getSync(username) {
  return (await getPref(`sync:${username.toLowerCase()}`, {})) || {};
}
export async function setSync(username, patch) {
  const cur = await getSync(username);
  await setPref(`sync:${username.toLowerCase()}`, { ...cur, ...patch });
}
