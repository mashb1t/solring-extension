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

function titleCase(id) {
  return String(id).split('_').filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// CommanderSalt synergy ("Outgoing Impact"): the cards this card synergizes with.
// synergy.list[id] is keyed by effect type (abilities / triggers / statics / …),
// each a map of effects whose cardsOfSupportingType are the cards it feeds. We
// surface the union of those cards (the per-clause rules texts are redundant with
// the card's own text, and the per-clause card links carry no relationship label).
function cardCombos(synergy, id) {
  const node = g(synergy, 'list', id);
  if (!node || typeof node !== 'object') return null;
  const anchors = new Set();
  let total = 0;
  for (const group of Object.values(node)) {
    if (!group || typeof group !== 'object') continue;
    for (const eff of Object.values(group)) {
      if (!eff || typeof eff !== 'object') continue;
      total += 1;
      for (const s of eff.cardsOfSupportingType || []) {
        if (s && s.id) anchors.add(s.id);
      }
    }
  }
  if (!total || anchors.size === 0) return null;
  return { total, anchors: [...anchors].slice(0, 8).map(titleCase) };
}

// Per-card "stats" that go beyond the tag flags: bracket flags + power & salt breakdowns.
function cardStats(details, id) {
  const cats = g(details, 'brackets', 'categories') || {};
  const flags = Object.keys(BRACKET_FLAG_LABELS)
    .filter((k) => Array.isArray(cats[k] && cats[k].list) && cats[k].list.includes(id))
    .map((k) => BRACKET_FLAG_LABELS[k]);
  // Power categories include both a theme (e.g. `stompy`) and its win-condition
  // mirror (`wincon_stompy`) with the same score — merge by base name (keep one,
  // not summed) and drop the aggregate buckets so nothing shows twice.
  const byBase = new Map();
  for (const { cat, score } of scoringFor(g(details, 'powerLevel', 'scoring'), id)) {
    if (cat === 'wincon' || cat === 'winConditions' || cat === 'total') continue;
    const base = cat.replace(/^wincon_/, '');
    byBase.set(base, Math.max(byBase.get(base) || 0, score));
  }
  // Total power contribution = the sum across every (deduped) category; the
  // displayed `power` keeps only the top contributors.
  let powerTotal = 0;
  for (const v of byBase.values()) powerTotal += v;
  powerTotal = Math.round(powerTotal * 10) / 10;
  const power = [...byBase.entries()].map(([cat, score]) => ({ cat, score }))
    .sort((a, b) => b.score - a.score).slice(0, 4);

  // Salt breakdown: drop cardPrice — it is NOT part of the salt score (the rest
  // sum to the card's saltiness). Show all components so they add up.
  const saltBreakdown = scoringFor(g(details, 'salt', 'scoring'), id)
    .filter((x) => x.cat !== 'cardPrice');

  return {
    flags,
    power,
    powerTotal,
    saltBreakdown,
    combos: cardCombos(g(details, 'synergy'), id),
  };
}

/** A deck is a stub (private / non-Commander / illegal / not yet analyzed). */
export function isStub(p) {
  return !p || p.name == null || (p._cardCount || 0) === 0;
}

// How many of the deck's actual combos (details.combos — Commander Spellbook)
// this card is a piece of. Matches the card's id/container/front-face against
// the combo's card ids (prefix-aware to cover DFC ids).
function countDeckCombos(comboList, c) {
  const ids = [c.id, c.containerId, c.frontFaceId].filter(Boolean);
  return comboList.filter((combo) => Array.isArray(combo.cards) && combo.cards.some(
    (x) => ids.some((id) => x === id || x.startsWith(`${id}_`) || id.startsWith(`${x}_`)),
  )).length;
}

/** Per-card map keyed by normalized card name → { salt, tags, total, flags, power, powerTotal, saltBreakdown, combos, deckCombos }. */
function extractCards(p) {
  const out = {};
  const cards = p.cards || {};
  const details = p.details || {};
  const comboList = g(details, 'combos', 'list') || [];
  for (const c of Object.values(cards)) {
    if (!c || !c.name) continue;
    const stats = g(c, 'categories', 'stats') || {};
    const tags = Object.keys(stats).filter((k) => stats[k]).map(prettifyTag);
    out[c.name.toLowerCase().trim()] = {
      salt: parseFloat(c.salt) || 0,
      tags,
      total: g(c, 'categories', 'total') || 0,
      ...cardStats(details, c.id),
      deckCombos: countDeckCombos(comboList, c),
    };
  }
  return out;
}

// id → display name, from the deck's own cards (covers DFC front/container ids).
function buildIdToName(cards) {
  const map = {};
  for (const c of Object.values(cards || {})) {
    if (!c || !c.name) continue;
    for (const id of [c.id, c.frontFaceId, c.containerId]) if (id && !(id in map)) map[id] = c.name;
  }
  return map;
}

// The deck's combos (details.combos.list — Commander Spellbook), shaped for display.
function extractCombos(p) {
  const list = g(p, 'details', 'combos', 'list') || [];
  const idToName = buildIdToName(p.cards);
  return list.map((c) => {
    const cx = c.complexity || {};
    const lines = (sec) => ((g(cx, sec, 'lines')) || []).map((l) => l.parsed).filter(Boolean);
    return {
      pieces: (c.cards || []).map((id) => idToName[id] || titleCase(id)),
      score: c.score,
      complexity: g(cx, 'bias', 'final'), // 0–1
      extraMana: cx.additionalCmcValue,
      type: c.type,
      categories: c.categories || [],
      needsBoard: !!cx.requiresCardsOnBoard,
      prerequisites: lines('notablePrerequisites'),
      steps: ((g(cx, 'steps', 'lines')) || [])
        .map((l) => ({ text: l.parsed, payMana: !!(l.qualifiers && l.qualifiers.requiresPayMana) }))
        .filter((s) => s.text),
      produces: lines('results'),
      breakdown: g(cx, 'bias', 'sections') || {}, // {easyPrerequisites, notablePrerequisites, preconditions, steps, results} → 0–1
      spellbookUri: c.spellbookUri,
    };
  });
}

// Deck-level detail panels (each surfaced behind an expandable tile).
function saltSources(dt) {
  return Object.entries(g(dt, 'salt', 'scoring') || {})
    .filter(([k, v]) => k !== 'cardPrice' && v && typeof v === 'object' && typeof v.score === 'number' && v.score > 0)
    .map(([cat, v]) => ({ cat, score: v.score }))
    .sort((a, b) => b.score - a.score);
}
function powerPillars(dt) {
  const s = g(dt, 'powerLevel', 'ratings', 'spike') || {};
  const out = {};
  for (const k of ['consistency', 'efficiency', 'interaction', 'winConditions', 'manabase']) {
    if (typeof s[k] === 'number') out[k] = s[k];
  }
  return out;
}
function bracketCategories(dt) {
  const cats = g(dt, 'brackets', 'categories') || {};
  return Object.keys(BRACKET_FLAG_LABELS)
    .map((key) => ({ key, count: (cats[key] && cats[key].count) || 0 }))
    .filter((c) => c.count > 0);
}
function archetypeMajors(dt) {
  return (g(dt, 'archetypes', 'profile', 'majors') || [])
    .filter((m) => m && m.major != null && typeof m.percentage === 'number')
    .slice(0, 4)
    .map((m) => ({ name: m.major, pct: m.percentage }));
}
// Interaction breakdown: the score's own subCategories (spotRemoval, boardWipes,
// counters, …), each scored at the deck level in powerLevel.scoring.
function interactionParts(dt) {
  const scoring = g(dt, 'powerLevel', 'scoring') || {};
  const subs = g(scoring, 'interaction', 'subCategories');
  if (!Array.isArray(subs)) return [];
  return subs
    .map((cat) => ({ cat, score: typeof (scoring[cat] && scoring[cat].score) === 'number' ? scoring[cat].score : 0 }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}
function synergyAnchors(dt, idToName) {
  return (g(dt, 'synergy', 'profile', 'anchors') || [])
    .filter((a) => a && a.cardId)
    .slice(0, 6)
    .map((a) => ({ name: idToName[a.cardId] || titleCase(a.cardId), share: a.share, score: a.score }));
}

/** Full deck payload → DeckFields. */
export function extractDeck(p) {
  const combos = extractCombos(p);
  const dt = p.details || {};
  const idToName = buildIdToName(p.cards);
  return {
    combos,
    saltSources: saltSources(dt),
    powerPillars: powerPillars(dt),
    bracketCategories: bracketCategories(dt),
    archetypeMajors: archetypeMajors(dt),
    synergyAnchors: synergyAnchors(dt, idToName),
    interactionParts: interactionParts(dt),
    deckId: p.id,
    commander: (p.commanders || [])[0],
    colorIdentity: p.colorIdentity,
    power: p.powerLevelRating,
    // Deck's total power score (sum of all per-card contributions); basis for each
    // card's "% contribution" and the deck-average colouring threshold.
    powerScoreTotal: parseFloat(g(p, 'details', 'powerLevel', 'scoring', 'total')) || 0,
    bracketRealistic: g(p, 'details', 'brackets', 'csBracket'),
    bracketBaseline: g(p, 'details', 'brackets', 'wotcBracket'), // for the delta arrow only (not displayed as a number)
    commanderTier: g(p, 'details', 'powerLevel', 'ratings', 'commanderTier'),
    salt: p.saltRating,
    threat: p.threatRating,
    interaction: g(p, 'details', 'powerLevel', 'scoring', 'interaction', 'score'),
    wincons: p.comboRating,
    synergy: p.synergyRating,
    archetype: p.archetypeLabel,
    combosCount: combos.length, // # of deck combos (Commander Spellbook)
    combosScore: g(p, 'details', 'combos', 'score'),
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
