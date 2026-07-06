// Persistent cache + prefs over chrome.storage.local. Stores only extracted
// display fields (never raw payloads). Stale-while-revalidate with in-flight
// de-duplication. Used by the background service worker.

export const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Bump whenever extractDeck / extractHit change the SHAPE of the fields we cache (a new
// field, a renamed/removed one, a changed unit). Entries written by an older extractor
// carry an older `v` (or none) and are treated as stale: served for display continuity
// but re-fetched on the next allow-fetch read (e.g. Analyze all), so new fields backfill
// without a manual Clear cache or Analyze. History, by version:
// 1 pre-manabase. 2 adds manabase. 3 adds per-card synergy count. 4 adds synergy
// and scoreBias-ranked partners. 5 adds bracket/power profile (coaching, score drivers,
// anti-patterns). 6 adds wincon profile. 7 adds inferred deck type. 8 adds fringeCEDH.
// 9 bracket cards carry images. 10 adds power fingerprint, synergy anchors/hubs carry images.
// 11 adds salt personality, card-advantage/denial/graveyard fingerprint, commander
// centricity, anti-pattern score cap, per-card name + top threats.
// 12 adds top-level commanders[] (partner/background EDHREC slugs).
export const SCHEMA_VERSION = 12;

const inFlight = new Map();

export async function getEntry(key) {
  const obj = await chrome.storage.local.get(key);
  return obj[key] || null; // { fetchedAt, data } | null
}

// Evict the oldest cached analyses (deck:* / search:*, by fetchedAt) to free space.
// `fraction` = share of current cache entries to drop. Returns how many were removed.
export async function evictOldestCache(fraction = 0.25) {
  const all = await chrome.storage.local.get(null);
  const cache = Object.keys(all)
    .filter(isCacheKey)
    .map((k) => ({ k, t: (all[k] && all[k].fetchedAt) || 0 }));
  if (!cache.length) return 0;
  cache.sort((a, b) => a.t - b.t); // oldest first
  const drop = cache.slice(0, Math.max(1, Math.floor(cache.length * fraction))).map((e) => e.k);
  await chrome.storage.local.remove(drop);
  return drop.length;
}

export async function setEntry(key, data) {
  const entry = { v: SCHEMA_VERSION, fetchedAt: Date.now(), data };
  try {
    await chrome.storage.local.set({ [key]: entry });
  } catch (e) {
    // Storage full (QUOTA_BYTES): evict the oldest cached analyses and retry once. If
    // it still fails, give up persisting. The caller keeps the in-memory fields it
    // already has, so a full cache degrades to "not cached" (it self-bounds via the
    // eviction), never a rejected getDeck/importDeck that breaks the display.
    const evicted = await evictOldestCache(0.25).catch(() => 0);
    try {
      await chrome.storage.local.set({ [key]: entry });
    } catch (e2) {
      console.warn(`[solring] cache write failed (storage full?); evicted ${evicted}, not persisting`, e2);
    }
  }
  return entry;
}

export function isFresh(entry, ttl = TTL_MS) {
  return !!entry && entry.v === SCHEMA_VERSION && Date.now() - entry.fetchedAt < ttl;
}

// Cached analyses only: deck:* and search:* entries (not prefs:* / sync:*).
function isCacheKey(k) {
  return k.startsWith('deck:') || k.startsWith('search:');
}

/** Total storage footprint of cached analyses → { bytes, count }. */
export async function cachedBytes() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(isCacheKey);
  if (!keys.length) return { bytes: 0, count: 0 };
  const bytes = await chrome.storage.local.getBytesInUse(keys);
  return { bytes, count: keys.length };
}

/** Remove all cached analyses (keeps prefs + per-user sync timestamps). */
export async function clearCached() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(isCacheKey);
  if (keys.length) await chrome.storage.local.remove(keys);
  return { cleared: keys.length };
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
