// "Combo breakers" for the Cuts tab: which of the deck's cards are pieces of a combo the deck
// already has (Commander Spellbook find-my-combos `included`). Cutting one of them breaks that
// combo, so recommendations.js marks it and asks before removing. Pure (no DOM / chrome).

// Front face, lowercased: the same key as moxfield-edit.frontKey (deck boards are keyed by it).
const key = (name) => String(name).split(' // ')[0].toLowerCase().trim();

// Same URL as the Stats panel and builder combo links (one helper in sources/spellbook.js).
export { spellbookComboUrl as comboUrl } from './sources/spellbook.js';

/**
 * Map(frontKey → [{ id, pieces, produces, popularity }]) for every card that is a piece of an
 * `included` combo whose pieces are ALL in `deckNames` (pass commanders + mainboard). Each card's
 * combos are deduped by id and sorted most popular first. Bad input → empty map.
 */
export function comboBreakers(results, deckNames) {
  const have = new Set((deckNames || []).map(key));
  const out = new Map();
  for (const c of (results && results.included) || []) {
    const pieces = ((c && c.uses) || []).map((u) => u && u.card && u.card.name).filter(Boolean);
    if (!c || c.id == null || pieces.length < 1 || !pieces.every((p) => have.has(key(p)))) continue;
    const combo = {
      id: c.id,
      pieces,
      produces: (c.produces || []).map((p) => (p && p.feature && p.feature.name) || (p && p.name)).filter(Boolean),
      popularity: typeof c.popularity === 'number' ? c.popularity : 0,
    };
    for (const p of new Set(pieces.map(key))) {
      const list = out.get(p) || [];
      if (!list.some((x) => x.id === combo.id)) list.push(combo);
      out.set(p, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => b.popularity - a.popularity);
  return out;
}

/** After `name` leaves the deck: drop every combo it was part of (from all cards), in place. */
export function dropCombosWith(map, name) {
  const k = key(name);
  const gone = new Set((map.get(k) || []).map((c) => c.id));
  map.delete(k);
  for (const [card, list] of map) {
    const left = list.filter((c) => !gone.has(c.id));
    if (left.length) map.set(card, left); else map.delete(card);
  }
  return map;
}

// Confirm-dialog backdrop dismissal (combo-breaker-ui.confirmRemove). A mouse double-click on "−"
// opens the confirm on the first click; the second lands on the full-screen backdrop. So a
// backdrop click dismisses only when its pointerdown also started on the backdrop AND the dialog
// has been open for at least `graceMs`. Escape / Cancel are not gated.
export const BACKDROP_GRACE_MS = 400;
export function backdropDismisses({ openedAt, now, downOnBackdrop, clickOnBackdrop, graceMs = BACKDROP_GRACE_MS }) {
  return !!(clickOnBackdrop && downOnBackdrop && now - openedAt >= graceMs);
}

// The confirm's Remove button gets the same grace: a pointer click within `graceMs` of opening is
// a double-click's stray second click (its pointerdown also happens after the open, so where it
// landed can't tell it apart) and is ignored. Keyboard activation (click.detail 0) is immediate.
export function removeClickCounts({ openedAt, now, keyboard, graceMs = BACKDROP_GRACE_MS }) {
  return !!keyboard || now - openedAt >= graceMs;
}
