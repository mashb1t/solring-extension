// Direct CommanderSalt API wrappers. Used ONLY by the background service worker
// (host_permissions covers api.commandersalt.com, so these bypass page CORS).
// Never routed through solri.ng or any proxy. Verified hosts/paths against the
// live CommanderSalt frontend's own network calls.

const BASE = 'https://api.commandersalt.com';
const IMPORT_TIMEOUT_MS = 20000;

/** GET a deck's full payload by md5 id. */
export async function getDeckById(md5) {
  const r = await fetch(`${BASE}/decks?id=${encodeURIComponent(md5)}`);
  if (!r.ok) throw new Error(`getDeck ${r.status}`);
  return r.json();
}

/** GET a page of an author's indexed decks. Returns { hits, cursor, total }. */
export async function searchByAuthor(username, cursor) {
  const u = new URL(`${BASE}/search`);
  u.searchParams.set('type', 'decks');
  u.searchParams.set('authorIndexId', String(username).toLowerCase());
  if (cursor) u.searchParams.set('cursor', cursor);
  const r = await fetch(u);
  if (!r.ok) throw new Error(`search ${r.status}`);
  return r.json();
}

/** POST-import / analyze a deck by canonical URL. Pass oldDeckId (= md5 of the
    URL) to analyze an already-indexed deck and supersede its stored analysis,
    or omit it for a first-time import. Manual only, never auto-retried (idempotency
    hazard, triggers ~5s upstream compute). 20s timeout. */
export async function importByUrl(canonicalUrl, oldDeckId) {
  const u = new URL(`${BASE}/decks`);
  u.searchParams.set('url', canonicalUrl);
  if (oldDeckId) u.searchParams.set('oldDeckId', oldDeckId);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMPORT_TIMEOUT_MS);
  try {
    const r = await fetch(u, { method: 'POST', signal: ctrl.signal });
    if (!r.ok) throw new Error(`import ${r.status}`);
    return r.json();
  } finally {
    clearTimeout(timer);
  }
}
