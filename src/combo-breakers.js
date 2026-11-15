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
