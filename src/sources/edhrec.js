// EDHREC enrichment source. Worker-only (imported by the background service worker).
// Pure helpers + one fetch. json.edhrec.com serves ACAO:* so the worker fetch needs no
// host_permissions; the GET must be a SIMPLE request (no custom headers) or EDHREC's
// CORS preflight answers 403.

const BASICS = new Set([
  'plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
  'snow-covered plains', 'snow-covered island', 'snow-covered swamp',
  'snow-covered mountain', 'snow-covered forest',
]);

// The front (castable) face, lowercased — how EDHREC lists cards and how we key the deck.
// Deck names and the commander carry the full "front // back" DFC name; EDHREC lists only
// the front.
const frontFace = (name) => String(name).split(' // ')[0].toLowerCase().trim();

const cardlistsOf = (json) => (
  (json && json.container && json.container.json_dict && json.container.json_dict.cardlists) || []
);

// Commander name(s) → EDHREC page slug. Front face only; strip diacritics; drop every
// character that isn't a-z0-9; collapse runs to single hyphens. Two commanders (partners
// / backgrounds) join their slugs alphabetically — EDHREC's canonical order (verified:
// reverse order 404s).
export function commanderSlug(commanders) {
  const one = (name) => String(name)
    .split(' // ')[0]
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/'/g, '') // drop apostrophes entirely (not turned into a hyphen)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const slugs = (Array.isArray(commanders) ? commanders : []).map(one).filter(Boolean);
  if (!slugs.length) return null;
  if (slugs.length === 1) return slugs[0];
  return slugs.slice(0, 2).sort().join('-');
}

// Card front-face name → best inclusion% (how many of the commander's decks run it).
// Flattens every cardlist except "New Cards" (recency, not staple-ness). This one map
// powers both the stock meter and the per-card badges.
export function inclusionByName(json) {
  const out = {};
  for (const list of cardlistsOf(json)) {
    if (!list || list.header === 'New Cards') continue;
    for (const c of (list.cardviews || [])) {
      if (!c || !c.name || !(c.potential_decks > 0)) continue;
      const key = frontFace(c.name);
      if (!key) continue;
      const pct = Math.round((c.inclusion / c.potential_decks) * 100);
      if (!(key in out) || pct > out[key]) out[key] = pct;
    }
  }
  return out;
}

// Deck "stock-o-meter": over the deck's non-basic, non-commander cards, mean EDHREC
// inclusion% (a card absent from every list counts as 0 — off the commander's radar), the
// off-radar card names ("your spice"), and their count. Commanders are excluded because
// they never appear in their own EDHREC card lists (they aren't "spice you added").
// `deckCardNames` are display names; `commanders` are full commander names.
export function stockMeter(inclusion, deckCardNames, commanders = []) {
  const commanderKeys = new Set((commanders || []).map(frontFace));
  const seen = new Set();
  const cards = []; // { display, key }
  for (const raw of (deckCardNames || [])) {
    const key = frontFace(raw);
    if (!key || BASICS.has(key) || commanderKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    cards.push({ display: String(raw).split(' // ')[0], key });
  }
  if (!cards.length) return null;
  let sum = 0; const offMeta = [];
  for (const { display, key } of cards) {
    const pct = inclusion[key] || 0;
    sum += pct;
    if (pct === 0) offMeta.push(display);
  }
  return { cards: cards.length, stockScore: Math.round(sum / cards.length), brew: offMeta.length, offMeta };
}

// EDHREC's monthly rank series (json.panels.rank_over_time) is a date-keyed object, e.g.
// { "2026-01-01": { rank: 204, ... }, ... }, not an array. Sort its dates ascending and
// pull just {date, rank} — the rest of each entry (commander_count, moving averages) is
// noise for our purposes.
function rankHistoryOf(json) {
  const rot = json && json.panels && json.panels.rank_over_time;
  if (!rot || typeof rot !== 'object') return [];
  return Object.keys(rot)
    .filter((date) => rot[date] && Number.isFinite(rot[date].rank))
    .sort()
    .map((date) => ({ date, rank: rot[date].rank }));
}

// Commander popularity: total deck count (≈ max potential_decks), bracket distribution,
// and EDHREC rank (current + history, "lower = more popular").
export function commanderPopularity(json) {
  let deckCount = 0;
  for (const list of cardlistsOf(json)) {
    for (const c of (list.cardviews || [])) {
      if (c && c.potential_decks > deckCount) deckCount = c.potential_decks;
    }
  }
  const brackets = (json && json.bracket_counts) || null;
  const rankHistory = rankHistoryOf(json);
  const rank = rankHistory.length ? rankHistory[rankHistory.length - 1].rank : null;
  if (!deckCount && !brackets && !rankHistory.length) return null;
  return { deckCount, brackets, rank, rankHistory };
}

// GET the commander page JSON. Simple request only (no headers). Returns null on any
// failure — the caller treats null as "no enrichment" (fail-silent).
export async function fetchEdhrec(slug) {
  let r;
  try { r = await fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`); }
  catch { return null; }
  if (!r.ok) return null;
  const json = await r.json().catch(() => null);
  if (!json || !json.container || !json.container.json_dict) return null;
  return json;
}
