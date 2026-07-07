// Authenticated Moxfield deck edits (add / remove / move a card) using the bearer token
// captured from the page by moxfield-token.js (MAIN world) and relayed here via postMessage.
// The token lives in memory only — never logged or persisted. Writes hit api2.moxfield.com the
// same way Moxfield's own UI does; each mutation is followed by a re-read verify so the caller
// knows the deck actually changed. Confirmed request shapes: POST .../cards/{board}
// {cardId,quantity,usePrefPrinting} to add; DELETE .../cards/{board}/{entryId} to remove
// (a move is add-to-target then remove-from-source, so a mid-failure leaves the card in both
// boards — recoverable — rather than lost). Boards: mainboard | sideboard | maybeboard.

let token = null;
window.addEventListener('message', (e) => {
  if (e.source === window && e.data && typeof e.data.__solringMoxToken === 'string') token = e.data.__solringMoxToken;
});

export const hasToken = () => !!token;

const V2 = 'https://api2.moxfield.com/v2/decks';
const V3 = 'https://api2.moxfield.com/v3/decks/all';

// Read the deck (public GET, cookie-auth — no token needed). Returns { editId, boards } where
// boards maps board → { name → { entryId, cardId } } keyed by lowercased card front-face name.
export async function readDeck(publicId) {
  const r = await fetch(`${V3}/${publicId}`, { credentials: 'include' });
  if (!r.ok) throw new Error(`moxfield read ${r.status}`);
  const d = await r.json();
  const board = (b) => {
    const out = {};
    for (const [entryId, c] of Object.entries((d.boards[b] && d.boards[b].cards) || {})) {
      const name = c.card && c.card.name;
      if (name) out[frontKey(name)] = { entryId, cardId: c.card.id, name, image: cardImage(c.card) };
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

export const frontKey = (name) => String(name).split(' // ')[0].toLowerCase().trim();

// Moxfield card art URL. Single-faced: card-{id}; double-faced: the front face uses
// card-face-{frontFaceId} (the plain card-{id} URL 404s for DFC/MDFC).
const ASSETS = 'https://assets.moxfield.net/cards';
function cardImage(card) {
  const faces = card.card_faces || [];
  return faces.length
    ? `${ASSETS}/card-face-${faces[0].id}-normal.webp`
    : `${ASSETS}/card-${card.id}-normal.webp`;
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

const addCard = (editId, board, cardId) =>
  write(`${V2}/${editId}/cards/${board}`, { method: 'POST', body: JSON.stringify({ cardId, quantity: 1, usePrefPrinting: true }) });

const removeEntry = (editId, board, entryId) =>
  write(`${V2}/${editId}/cards/${board}/${entryId}`, { method: 'DELETE' });

// Remove a mainboard card. Verifies it's gone. Returns the fresh deck read.
export async function removeFromMain(publicId, editId, entryId, cardName) {
  await removeEntry(editId, 'mainboard', entryId);
  const after = await readDeck(publicId);
  if (after.boards.mainboard[frontKey(cardName)]) throw new Error('remove-not-applied');
  return after;
}

// Move a mainboard card to `toBoard` (sideboard|maybeboard): add to target, then remove from
// mainboard. Verifies the card is in the target and gone from mainboard. Returns the fresh read.
export async function moveFromMain(publicId, editId, entryId, cardId, cardName, toBoard) {
  await addCard(editId, toBoard, cardId);
  await removeEntry(editId, 'mainboard', entryId);
  const after = await readDeck(publicId);
  const k = frontKey(cardName);
  if (after.boards.mainboard[k]) throw new Error('move-source-remains');
  if (!after.boards[toBoard][k]) throw new Error('move-target-missing');
  return after;
}
