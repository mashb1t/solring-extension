// Moxfield URL parsing + page-type detection (pure). Reserved `/decks/<word>`
// routes (personal, all, public, bookmarks) are the deck-manager, not decks.

const RESERVED = new Set(['personal', 'all', 'public', 'bookmarks', 'shared']);
const ALLOWED_HOSTS = new Set(['moxfield.com', 'www.moxfield.com']);

function path(url) {
  try {
    const u = new URL(url);
    if (!ALLOWED_HOSTS.has(u.hostname)) return null;
    return u.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** `/decks/<publicId>` → publicId; reserved words and other routes → null. */
export function parseDeckId(url) {
  const p = path(url);
  if (!p) return null;
  const m = /^\/decks\/([A-Za-z0-9_-]+)$/.exec(p);
  if (!m || RESERVED.has(m[1])) return null;
  return m[1];
}

/** `/users/<name>` → name; else null. */
export function parseUsername(url) {
  const p = path(url);
  if (!p) return null;
  const m = /^\/users\/([A-Za-z0-9_-]+)$/.exec(p);
  return m ? m[1] : null;
}

/** 'deck' | 'user' | 'personal' | null */
export function pageType(url) {
  const p = path(url);
  if (!p) return null;
  if (/^\/decks\/(personal|all|public|bookmarks|shared)(\/|$)/.test(p)) return 'personal';
  if (parseDeckId(url)) return 'deck';
  if (parseUsername(url)) return 'user';
  return null;
}
