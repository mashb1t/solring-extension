// Moxfield deck read helpers. GET is cookie-authenticated (no bearer token needed). Deck
// mutations are NOT done here — the cuts tab removes cards by driving Moxfield's own Deck
// Preview context-menu "Remove" (see recommendations.js), so no token capture or write API is
// required.

const V3 = 'https://api2.moxfield.com/v3/decks/all';

// Read the deck (public GET). Returns { editId, name, commanders, boards } where each board maps
// a card's front-face key → { entryId, cardId, name, image }.
export async function readDeck(publicId) {
  const r = await fetch(`${V3}/${publicId}`, { credentials: 'include' });
  if (!r.ok) throw new Error(`moxfield read ${r.status}`);
  const d = await r.json();
  const board = (b) => {
    const out = {};
    for (const [entryId, c] of Object.entries((d.boards[b] && d.boards[b].cards) || {})) {
      const name = c.card && c.card.name;
      if (name) out[frontKey(name)] = { entryId, cardId: c.card.id, name, ...cardImages(c.card), quantity: c.quantity || 1 };
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

// Moxfield card art URLs. `image` (card-{id}) works for single-physical-card layouts — normal,
// adventure, split, aftermath, flip — while a true double-faced FRONT (transform / modal_dfc)
// 404s on it. `imageAlt` is the front-face image (card-face-{frontFaceId}) used as an on-error
// fallback only when the card actually has faces. This avoids wrongly using the face image for
// adventures (e.g. Virtue of Courage // Embereth Blaze), which do have card_faces but one image.
const ASSETS = 'https://assets.moxfield.net/cards';
function cardImages(card) {
  const faces = card.card_faces || [];
  return {
    image: `${ASSETS}/card-${card.id}-normal.webp`,
    imageAlt: faces.length ? `${ASSETS}/card-face-${faces[0].id}-normal.webp` : null,
  };
}
