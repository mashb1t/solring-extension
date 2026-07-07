// EDHREC "recs" cut recommendations (the edhrec.com/recs tool). Worker-only. Unlike the
// commander-page JSON (json.edhrec.com), this is a deck-specific POST — it takes the whole
// decklist and returns `outRecs`: the deck's OWN cards ranked by how strongly EDHREC suggests
// cutting them. edhrec.com/api/recs serves ACAO:* (with an Origin present), so no
// host_permissions are needed. Moxfield's native EDHREC integration only shows cards to ADD,
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
