// Moxfield deck read + edit helpers. GET is cookie-authenticated (no token). Mutations
// (set quantity / remove) use the bearer token captured from the page by moxfield-token.js
// (MAIN world) and relayed via postMessage; the token lives in memory only, never logged or
// persisted. Confirmed request shapes: PUT .../cards/{board}/{cardId} {quantity:N} sets the
// absolute quantity; DELETE .../cards/{board}/{cardId} removes the card entirely.

let token = null;
window.addEventListener('message', (e) => {
  if (e.source === window && e.data && typeof e.data.__solringMoxToken === 'string') token = e.data.__solringMoxToken;
});
export const hasToken = () => !!token;

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

// Read the deck (public GET). Each board maps a card's front-face key → { entryId, cardId, name,
// quantity, image, faces }.
export async function readDeck(publicId) {
  const r = await fetch(`${V3}/${publicId}`, { credentials: 'include' });
  if (!r.ok) throw new Error(`moxfield read ${r.status}`);
  const d = await r.json();
  const board = (b) => {
    const out = {};
    for (const [entryId, c] of Object.entries((d.boards[b] && d.boards[b].cards) || {})) {
      const name = c.card && c.card.name;
      if (name) out[frontKey(name)] = { entryId, cardId: c.card.id, name, quantity: c.quantity || 1, ...cardImages(c.card) };
    }
    return out;
  };
  return {
    editId: d.id,
    name: d.name,
    commanders: Object.values((d.boards.commanders && d.boards.commanders.cards) || {}).map((c) => c.card && c.card.name).filter(Boolean),
    boards: { mainboard: board('mainboard'), sideboard: board('sideboard'), maybeboard: board('maybeboard') },
  };
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
