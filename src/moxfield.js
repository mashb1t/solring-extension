// Moxfield URL parsing + page-type detection (pure). Reserved `/decks/<word>`
// routes are the deck manager (Your Decks, Liked, Following, Explore, …), NOT
// individual decks — misclassifying one makes the extension try to render a deck
// panel for a non-deck (e.g. /decks/liked).

const RESERVED = new Set(['personal', 'all', 'public', 'private', 'bookmarks', 'shared', 'liked', 'following']);
const ALLOWED_HOSTS = new Set(['moxfield.com', 'www.moxfield.com']);

// A `/decks/<seg>` segment is a manager route, not a deck id, when it's a known
// reserved word OR looks like one: a short all-lowercase word. Moxfield deck ids are
// long (22-char) mixed-case base64url tokens, so this future-proofs against new
// manager routes without ever misclassifying a real deck.
function isManagerRoute(seg) {
  return RESERVED.has(seg) || (seg.length < 12 && /^[a-z]+$/.test(seg));
}

function path(url) {
  try {
    const u = new URL(url);
    if (!ALLOWED_HOSTS.has(u.hostname)) return null;
    return u.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** `/decks/<publicId>` → publicId; manager routes and other paths → null. */
export function parseDeckId(url) {
  const p = path(url);
  if (!p) return null;
  const m = /^\/decks\/([A-Za-z0-9_-]+)$/.exec(p);
  if (!m || isManagerRoute(m[1])) return null;
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
  const seg = /^\/decks\/([^/]+)(?:\/|$)/.exec(p);
  if (seg && isManagerRoute(seg[1])) return 'personal'; // any deck-manager route
  if (parseDeckId(url)) return 'deck';
  if (parseUsername(url)) return 'user';
  return null;
}
