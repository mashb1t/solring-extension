// Commander Spellbook enrichment source. Worker-only (imported by the background service
// worker). backend.commanderspellbook.com does NOT serve permissive CORS for us, so the
// worker fetch relies on the host_permissions entry in the manifest (unlike Scryfall/EDHREC).

const FIND_MY_COMBOS_URL = 'https://backend.commanderspellbook.com/find-my-combos';

// Front-face, lowercased — the form we match combo pieces against the deck by. Deck names
// (and Scryfall) carry the full "front // back" for DFCs; combos mostly list the front face.
const norm = (name) => String(name).split(' // ')[0].toLowerCase().trim();

// POST the deck to find-my-combos. `commanders` / `main` are arrays of { card, quantity }.
// Returns the `results` object (identity/included/almostIncluded/…) or null on any failure
// (fail-silent — the caller shows nothing).
export async function fetchMyCombos(commanders, main) {
  let r;
  try {
    r = await fetch(FIND_MY_COMBOS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commanders, main }),
    });
  } catch { return null; }
  if (!r.ok) return null;
  const json = await r.json().catch(() => null);
  return json && json.results ? json.results : null;
}

// The combos the deck is exactly ONE card away from completing (the "one card away" feature).
// From results.almostIncluded, keep combos whose single missing `uses` card isn't in the
// deck; trim to { id, add, produces, popularity, bracketTag }, popularity desc, capped.
// `deckNames` = the deck's card names. Combos missing 2+ cards are dropped (not "one away").
export function nearMissCombos(results, deckNames, cap = 25) {
  const have = new Set((deckNames || []).map(norm));
  const out = [];
  for (const combo of (results && results.almostIncluded) || []) {
    const missing = (combo.uses || [])
      .map((u) => u && u.card && u.card.name)
      .filter((n) => n && !have.has(norm(n)));
    if (missing.length !== 1) continue; // strictly one card away
    out.push({
      id: combo.id,
      add: missing[0],
      produces: (combo.produces || []).map((p) => (p && p.feature && p.feature.name) || (p && p.name)).filter(Boolean),
      popularity: typeof combo.popularity === 'number' ? combo.popularity : null,
      bracketTag: combo.bracketTag || null,
    });
  }
  return out.sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, cap);
}
