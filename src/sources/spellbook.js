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

const lines = (s) => (typeof s === 'string' ? s.split('\n').map((x) => x.trim()).filter(Boolean) : []);

// The combos the deck is exactly ONE card away from completing (the "one card away" feature).
// From results.almostIncluded, keep combos with exactly one `uses` card missing from the
// deck; trim to a render-ready shape mirroring the deck's own combo cards: all pieces (each
// flagged missing/present), what it produces, popularity, bracket, and the expandable detail
// (prerequisites + steps). Sorted by popularity desc, capped. Combos missing 2+ are dropped.
export function nearMissCombos(results, deckNames, cap = 25) {
  const have = new Set((deckNames || []).map(norm));
  const out = [];
  for (const combo of (results && results.almostIncluded) || []) {
    const pieces = (combo.uses || [])
      .map((u) => u && u.card && u.card.name)
      .filter(Boolean)
      .map((name) => ({ name, missing: !have.has(norm(name)) }));
    const missing = pieces.filter((p) => p.missing);
    if (missing.length !== 1) continue; // strictly one card away
    out.push({
      id: combo.id,
      pieces,
      add: missing[0].name,
      produces: (combo.produces || []).map((p) => (p && p.feature && p.feature.name) || (p && p.name)).filter(Boolean),
      popularity: typeof combo.popularity === 'number' ? combo.popularity : null,
      bracketTag: combo.bracketTag || null,
      prerequisites: [...lines(combo.easyPrerequisites), ...lines(combo.notablePrerequisites)],
      steps: lines(combo.description),
    });
  }
  return out.sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, cap);
}
