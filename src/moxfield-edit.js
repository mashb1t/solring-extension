// Moxfield deck read + edit helpers. GET is cookie-authenticated (no token). Mutations
// (set quantity / remove) use the bearer token captured from the page by moxfield-token.js
// (MAIN world) and relayed via postMessage; the token lives in memory only, never logged or
// persisted. Confirmed request shapes: PUT .../cards/{board}/{cardId} {quantity:N} sets the
// absolute quantity; DELETE .../cards/{board}/{cardId} removes the card entirely.
//
// ToS-/CWS-sensitive: these are TOKEN WRITES to api2.moxfield.com. Besides the per-card PUT/DELETE
// above (recommendations "Cuts"), `bulkEditWrite` sends the exact request Moxfield's own Bulk Edit
// "Save" sends (PUT /v3/decks/{publicId}/bulk-edit) for the Guided Deck Builder — a user-accepted
// decision (2026-11-14). It is scoped to that one endpoint and only does what the logged-in owner
// could do by hand in Bulk Edit.

let token = null;
// Guarded so the pure shaping below (shapeDeck) can be imported by node tests.
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && typeof e.data.__solringMoxToken === 'string') token = e.data.__solringMoxToken;
  });
}
export const hasToken = () => !!token;

// READ-ONLY GET with the captured bearer token (ToS-adjacent, same note as above: this only reads
// what the logged-in user can already see; no write is ever issued here). Used for endpoints that
// 401 on the cookie alone (e.g. /v1/collections/search). Waits briefly for the token to be relayed.
// Returns parsed JSON, or null on no token / non-2xx / any failure (never throws).
export async function authedGet(url) {
  if (typeof url !== 'string' || !url.startsWith('https://api2.moxfield.com/')) return null; // never send the token elsewhere
  try {
    for (let i = 0; !token && i < 20; i++) await new Promise((r) => setTimeout(r, 150));
    if (!token) return null;
    // redirect:'error': never follow a redirect off api2 with the token attached.
    const r = await fetch(url, { method: 'GET', credentials: 'include', redirect: 'error', headers: { Authorization: token } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// The ONE Bulk Edit write: Moxfield's own Save request (LIVE-VERIFY 2026-11-14 in moxfield-ui.js).
// PUT https://api2.moxfield.com/v3/decks/{publicId}/bulk-edit with the full JSON body, the captured
// token, `x-public-deck-id` and `x-deck-version` (the v3 deck JSON's `version`; informational —
// the server is last-write-wins). The URL and method are fixed here: callers pass only the public
// id (validated) and the body. Never logs the token, never follows a redirect, never throws.
// Returns { ok, status, json } (json null when not JSON), or null when there is no token / the
// request itself failed.
const PUBLIC_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export async function bulkEditWrite(publicId, body, { version = null } = {}) {
  try {
    if (typeof publicId !== 'string' || !PUBLIC_ID_RE.test(publicId) || !body || typeof body !== 'object') return null;
    for (let i = 0; !token && i < 20; i++) await new Promise((r) => setTimeout(r, 150));
    if (!token) return null;
    const headers = { Authorization: token, 'Content-Type': 'application/json', 'x-public-deck-id': publicId };
    if (Number.isFinite(version)) headers['x-deck-version'] = String(version);
    const r = await fetch(`https://api2.moxfield.com/v3/decks/${publicId}/bulk-edit`, {
      method: 'PUT', credentials: 'include', redirect: 'error', headers, body: JSON.stringify(body),
    });
    let json = null;
    try { json = await r.json(); } catch { json = null; }
    return { ok: r.ok, status: r.status, json };
  } catch { return null; }
}

const V2 = 'https://api2.moxfield.com/v2/decks';
const V3 = 'https://api2.moxfield.com/v3/decks/all';
const ASSETS = 'https://assets.moxfield.net/cards';

// Layouts whose two faces are separate images (a flip switches the shown art). Adventure /
// split / flip / aftermath also have card_faces, but a single physical image (card-{id}).
const DFC_LAYOUTS = new Set(['transform', 'modal_dfc', 'double_faced_token', 'reversible_card']);

// { image, faces } for a card. DFC → the front face image + [front, back, …] face images for the
// flip button; everything else → the single card-{id} image and no faces.
function cardImages(card) {
  const faces = card.card_faces || [];
  if (DFC_LAYOUTS.has(card.layout) && faces.length >= 2) {
    const url = (f) => `${ASSETS}/card-face-${f.id}-normal.webp`;
    return { image: url(faces[0]), faces: faces.map(url) };
  }
  return { image: `${ASSETS}/card-${card.id}-normal.webp`, faces: null };
}

export const frontKey = (name) => String(name).split(' // ')[0].toLowerCase().trim();

// Front face of a type line is a land ("Land", "Basic Land — Forest", "Artifact Land"). A
// modal DFC with a land back ("Instant // Land") counts as a spell, as deck builders do.
const isLandType = (typeLine) => /\bland\b/i.test(String(typeLine || '').split(' // ')[0]);

/**
 * Shape a /v3/decks/all/{id} JSON. Each board maps a card's front-face key → { entryId, cardId,
 * name, quantity, isLand, image, faces }. `colorIdentity` is the union of the commanders' colour
 * identities (the deck-level field can include off-colour cards); `format` is Moxfield's string
 * (e.g. 'commander').
 */
export function shapeDeck(d) {
  const boards = (d && d.boards) || {};
  const board = (b) => {
    const out = {};
    for (const [entryId, c] of Object.entries((boards[b] && boards[b].cards) || {})) {
      const name = c && c.card && c.card.name;
      if (name) {
        out[frontKey(name)] = {
          entryId, cardId: c.card.id, name, quantity: c.quantity || 1, isLand: isLandType(c.card.type_line), ...cardImages(c.card),
        };
      }
    }
    return out;
  };
  const cmdCards = Object.values((boards.commanders && boards.commanders.cards) || {}).map((c) => c && c.card).filter((c) => c && c.name);
  const ci = new Set();
  for (const c of cmdCards) for (const x of c.color_identity || []) ci.add(x);
  return {
    editId: d.id,
    name: d.name,
    version: Number.isFinite(d.version) ? d.version : null,
    ownerUserId: d.ownerUserId || null,
    format: d.format || null,
    colorIdentity: cmdCards.length ? ['W', 'U', 'B', 'R', 'G'].filter((x) => ci.has(x)) : (d.colorIdentity || []),
    commanders: cmdCards.map((c) => c.name),
    boards: { commanders: board('commanders'), mainboard: board('mainboard'), sideboard: board('sideboard'), maybeboard: board('maybeboard') },
  };
}

// Read the deck (public, cookie GET). Throws on a non-2xx (e.g. 404 for a private deck).
export async function readDeck(publicId) {
  const r = await fetch(`${V3}/${publicId}`, { credentials: 'include' });
  if (!r.ok) throw new Error(`moxfield read ${r.status}`);
  return shapeDeck(await r.json());
}

// The raw /v3/decks/all/{id} JSON: cookie GET, falling back to the token-authenticated read-only
// GET for private decks the user can see (the cookie GET 404s on those). null when neither works
// (or the shape has no boards). Never throws.
export async function readDeckJson(publicId) {
  try {
    const r = await fetch(`${V3}/${publicId}`, { credentials: 'include' });
    if (r.ok) { const d = await r.json(); if (d && d.boards) return d; }
  } catch { /* fall through */ }
  const d = await authedGet(`${V3}/${publicId}`);
  return d && d.boards ? d : null;
}

// readDeckJson, shaped (shapeDeck). null when neither read works. Never throws.
export async function readDeckAny(publicId) {
  const d = await readDeckJson(publicId);
  return d ? shapeDeck(d) : null;
}

async function write(url, opts) {
  if (!token) throw new Error('no-token');
  const r = await fetch(url, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Authorization: token, ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`moxfield ${opts.method} ${r.status}`);
  return r;
}

// Set a card's absolute quantity in a board.
export const setCardQuantity = (editId, board, cardId, quantity) =>
  write(`${V2}/${editId}/cards/${board}/${cardId}`, { method: 'PUT', body: JSON.stringify({ quantity }) });

// Remove a card from a board entirely.
export const removeCard = (editId, board, cardId) =>
  write(`${V2}/${editId}/cards/${board}/${cardId}`, { method: 'DELETE' });
