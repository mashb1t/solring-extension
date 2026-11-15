// EDHREC "recs" cut recommendations (the edhrec.com/recs tool). Worker-only. Unlike the
// commander-page JSON (json.edhrec.com), this is a deck-specific POST — it takes the whole
// decklist and returns `outRecs`: the deck's OWN cards ranked by how strongly EDHREC suggests
// cutting them. edhrec.com/api/recs no longer serves ACAO, so this runs in the
// worker under an edhrec.com host grant. Moxfield's native EDHREC integration only shows cards to ADD,
// so cuts are the unique value here.

const RECS_URL = 'https://edhrec.com/api/recs/';

// POST { commanders:[name], cards:[name] } → the recs payload (or null on any failure).
export async function fetchRecs(commanders, cards) {
  let r;
  try {
    r = await fetch(RECS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commanders, cards }),
    });
  } catch { return null; }
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

// Shape outRecs into cut suggestions: [{ name, score }], strongest-cut first, capped. `score`
// is EDHREC's cut confidence (higher = cut sooner). outRecs are all deck cards, so the caller
// can render them as in-deck card refs (clickable + hover).
export function cutRecs(json, cap = 10) {
  const out = (json && json.outRecs) || [];
  return out
    .filter((c) => c && c.name)
    .map((c) => ({ name: c.name, score: typeof c.score === 'number' ? c.score : null }))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, cap);
}

// options.cutsPositiveOnly: keep only cuts EDHREC actually recommends (score > 0). A missing score
// counts as not recommended. Off → the list unchanged. Same objects kept (callers mutate quantity).
export function positiveCuts(cuts, on = true) {
  if (!Array.isArray(cuts)) return [];
  return on === false ? cuts : cuts.filter((c) => c && typeof c.score === 'number' && c.score > 0);
}
