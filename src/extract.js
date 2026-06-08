// Map a raw CommanderSalt payload (or search hit) → the small set of display
// fields the extension renders. Pure + defensive: missing fields become
// undefined, never throw. Deck value and baseline (WOTC) bracket are
// intentionally NOT extracted — only the realistic bracket is shown.

import { prettifyTag, BRACKET_FLAG_LABELS } from './labels.js';

function g(obj, ...path) {
  let cur = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

// Collect a card's scoring contributions from a details.<area>.scoring object:
// [{ cat, score }] for each category whose per-id list scores this card, top-first.
function scoringFor(scoring, id) {
  const out = [];
  for (const [cat, v] of Object.entries(scoring || {})) {
    const entry = v && typeof v === 'object' && v.list && typeof v.list === 'object' ? v.list[id] : null;
    if (entry && typeof entry.score === 'number' && entry.score > 0) out.push({ cat, score: entry.score });
  }
  return out.sort((a, b) => b.score - a.score);
}

// Per-card "stats" that go beyond the tag flags: bracket flags + power & salt breakdowns.
function cardStats(details, id) {
  const cats = g(details, 'brackets', 'categories') || {};
  const flags = Object.keys(BRACKET_FLAG_LABELS)
    .filter((k) => Array.isArray(cats[k] && cats[k].list) && cats[k].list.includes(id))
    .map((k) => BRACKET_FLAG_LABELS[k]);
  return {
    flags,
    power: scoringFor(g(details, 'powerLevel', 'scoring'), id).slice(0, 4),
    saltBreakdown: scoringFor(g(details, 'salt', 'scoring'), id).slice(0, 4),
  };
}

/** A deck is a stub (private / non-Commander / illegal / not yet analyzed). */
export function isStub(p) {
  return !p || p.name == null || (p._cardCount || 0) === 0;
}

/** Per-card map keyed by normalized card name → { salt, tags, total, flags, power, saltBreakdown }. */
function extractCards(p) {
  const out = {};
  const cards = p.cards || {};
  const details = p.details || {};
  for (const c of Object.values(cards)) {
    if (!c || !c.name) continue;
    const stats = g(c, 'categories', 'stats') || {};
    const tags = Object.keys(stats).filter((k) => stats[k]).map(prettifyTag);
    out[c.name.toLowerCase().trim()] = {
      salt: parseFloat(c.salt) || 0,
      tags,
      total: g(c, 'categories', 'total') || 0,
      ...cardStats(details, c.id),
    };
  }
  return out;
}

/** Full deck payload → DeckFields. */
export function extractDeck(p) {
  return {
    deckId: p.id,
    commander: (p.commanders || [])[0],
    colorIdentity: p.colorIdentity,
    power: p.powerLevelRating,
    bracketRealistic: g(p, 'details', 'brackets', 'csBracket'),
    commanderTier: g(p, 'details', 'powerLevel', 'ratings', 'commanderTier'),
    salt: p.saltRating,
    threat: p.threatRating,
    interaction: g(p, 'details', 'powerLevel', 'scoring', 'interaction', 'score'),
    wincons: p.comboRating,
    synergy: p.synergyRating,
    archetype: p.archetypeLabel,
    isPrivate: p.isPrivate,
    isIllegal: p.isIllegal,
    cards: extractCards(p),
  };
}

/** Search hit → HitFields (the metrics available without a full fetch). */
export function extractHit(h) {
  return {
    deckId: h.deckId,
    title: h.title,
    commander: (h.commanders || [])[0] || h.commanderName,
    colorIdentity: h.colorIdentity,
    power: h.powerLevelRating != null ? h.powerLevelRating : h.displayValue,
    bracketRating: h.bracketRating,
    salt: h.saltRating,
    synergy: h.synergyRating,
    archetypeMajor: h.archetypeMajor,
    archetypeMinor: h.archetypeMinor,
    isPrivate: h.isPrivate,
    isIllegal: h.isIllegal,
  };
}
