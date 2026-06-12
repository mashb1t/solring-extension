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
// the card's own text). Each anchor is { name, image } so the chip can preview the
// card's exact deck print on hover; idToCard maps anchor id → that card.
const SYN_ANCHOR_CAP = 20; // ranked partners kept per card (panel shows 8, rest expand)

function cardCombos(synergy, id, idToCard) {
  const node = g(synergy, 'list', id);
  if (!node || typeof node !== 'object') return null;
  const weight = new Map(); // partner card id → its highest scoreBias across this card's effects
  let total = 0; // number of synergy effect-clauses
  let score = 0; // synergy SCORE: Σ conditionScoring.total — the same per-card number
  //              CommanderSalt sums to rank a deck's synergy "anchors" (so it matches
  //              the site). Far more discriminating than a raw partner count.
  for (const group of Object.values(node)) {
    if (!group || typeof group !== 'object') continue;
    for (const eff of Object.values(group)) {
      if (!eff || typeof eff !== 'object') continue;
      total += 1;
      const cs = eff.conditionScoring;
      if (cs && typeof cs.total === 'number') score += cs.total;
      for (const s of eff.cardsOfSupportingType || []) {
        if (!s || !s.id) continue;
        const bias = s.supportCondition && typeof s.supportCondition.scoreBias === 'number' ? s.supportCondition.scoreBias : 0;
        weight.set(s.id, Math.max(weight.get(s.id) || 0, bias));
      }
    }
  }
  if (!total) return null;
  // Anchors = supporting cards ranked by scoreBias (most-relevant first), capped; the
  // panel shows the top 8 and expands to the rest. A card can score via commanderBonus
  // with no supporting cards (anchors empty) — still surface its score.
  const anchors = [...weight.entries()].sort((a, b) => b[1] - a[1]).slice(0, SYN_ANCHOR_CAP).map(([aid]) => {
    const c = idToCard && idToCard[aid];
    return { name: (c && c.name) || titleCase(aid), image: (c && c.image) || null };
  });
  return { total, count: weight.size, score: Math.round(score * 10) / 10, anchors };
}

// Per-card "stats" that go beyond the tag flags: bracket flags + power & salt breakdowns.
function cardStats(details, id, idToCard) {
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
    combos: cardCombos(g(details, 'synergy'), id, idToCard),
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
  const idToCard = buildIdToCard(cards); // anchor id → { name, image } for synergy chips
  for (const c of Object.values(cards)) {
    if (!c || !c.name) continue;
    const stats = g(c, 'categories', 'stats') || {};
    const tags = Object.keys(stats).filter((k) => stats[k]).map(prettifyTag);
    out[c.name.toLowerCase().trim()] = {
      salt: parseFloat(c.salt) || 0,
      tags,
      total: g(c, 'categories', 'total') || 0,
      ...cardStats(details, c.id, idToCard),
      deckCombos: countDeckCombos(comboList, c),
    };
  }
  return out;
}

// id → { name, image } for synergy anchors. image is the deck's exact print
// (CommanderSalt's per-card imageUri), upgraded from the border-crop art to the
// full card (/normal/). Covers DFC front/container ids.
function buildIdToCard(cards) {
  const map = {};
  for (const c of Object.values(cards || {})) {
    if (!c || !c.name) continue;
    const image = typeof c.imageUri === 'string' ? c.imageUri.replace('/border_crop/', '/normal/') : null;
    for (const id of [c.id, c.frontFaceId, c.containerId]) if (id && !(id in map)) map[id] = { name: c.name, image };
  }
  return map;
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
// Power pillars as raw scores vs their casual / cEDH baselines — what CommanderSalt plots
// in "compare pillar scores against baseline" (score ÷ baseline). NOT ratings.spike.* (a
// normalized 0–1 internal rating that maps to nothing the site shows). Manabase is omitted:
// its pillar score is capped at the baseline, so it's always 100% (the real manabase signal
// lives in the manabase section).
function powerPillars(dt) {
  const sc = g(dt, 'powerLevel', 'scoring') || {};
  const bv = g(dt, 'powerLevel', 'baseValues') || {};
  const PILLARS = ['consistency', 'efficiency', 'interaction', 'winConditions'];
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const scores = {};
  for (const k of PILLARS) { const v = num(g(sc, k, 'score')); if (v != null) scores[k] = v; }
  const pick = (obj) => { const o = {}; for (const k of PILLARS) if (typeof (obj || {})[k] === 'number') o[k] = obj[k]; return o; };
  return { scores, casual: pick(bv.casual), cedh: pick(bv.spike) };
}
function bracketCategories(dt, idToName) {
  const cats = g(dt, 'brackets', 'categories') || {};
  return Object.keys(BRACKET_FLAG_LABELS)
    .map((key) => {
      const c = cats[key] || {};
      const cards = Array.isArray(c.list) ? c.list.map((id) => (idToName && idToName[id]) || titleCase(id)) : [];
      return { key, count: c.count || 0, cards };
    })
    .filter((c) => c.count > 0);
}

// Raw { id, data } scorer signals (passing through an optional up/down direction) —
// the panel humanizes the id and shows the data pairs verbatim (no sentence templating),
// mirroring how the manabase strengths/risks are surfaced.
const sigList = (list) => (Array.isArray(list) ? list : [])
  .filter((it) => it && it.id)
  .map((it) => (it.direction ? { id: it.id, data: it.data || {}, direction: it.direction } : { id: it.id, data: it.data || {} }));

// Bracket coaching: why the deck lands at its bracket (rationale) and the concrete moves
// to shift it down (soften) / up (harden), plus pre-game rule-zero disclosures. Each is a
// raw { id, data } list. `rating` is the continuous bracket score behind the integer.
function bracketProfile(dt) {
  const b = g(dt, 'brackets') || {};
  const prof = b.profile || {};
  const rating = typeof b.bracketRating === 'number' && Number.isFinite(b.bracketRating) ? b.bracketRating : null;
  return {
    rating,
    rationale: sigList(prof.rationale),
    soften: sigList(prof.soften),
    harden: sigList(prof.harden),
    ruleZero: sigList(prof.ruleZero),
  };
}

// Win-condition shape: the deck's win paths (combo / combat / …) + combo consistency
// metrics — the "what kind of win, how reliably" layer behind the Wincons grade.
function winconProfile(dt) {
  const prof = g(dt, 'powerLevel', 'profile') || {};
  const w = prof.wincons || {};
  const c = prof.combos || {};
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  return {
    paths: Array.isArray(w.paths) ? w.paths.slice() : [],
    primary: w.primary || null,
    count: num(w.count),
    goal: w.goal || null,
    mixedTypes: !!w.mixedTypes,
    combos: {
      count: num(c.count),
      effectiveLines: num(c.effectiveLines),
      redundancy: num(c.redundancy),
      winconCount: num(c.winconCount),
    },
  };
}

// Power scoring drivers: which signals pushed the score up (boosts) / down (penalties),
// the named anti-patterns (server-side label + why), and improvement suggestions. boosts/
// penalties are id→severity maps; we drop the "none" entries.
function powerProfile(dt) {
  const prof = g(dt, 'powerLevel', 'profile') || {};
  const adj = prof.scoreAdjustments || {};
  const sev = (obj) => Object.entries(obj || {}).filter(([, v]) => v && v !== 'none').map(([id, severity]) => ({ id, severity }));
  const ap = adj.antiPattern || {};
  const antiPatterns = (Array.isArray(ap.patterns) ? ap.patterns : [])
    .filter((x) => x && x.label)
    .map((x) => ({ label: x.label, why: x.why || '', severity: x.severity || '' }));
  return {
    boosts: sev(adj.boosts),
    penalties: sev(adj.penalties),
    net: { direction: adj.netDirection || null, magnitude: adj.netMagnitude || null },
    antiPatterns,
    improve: sigList(prof.improve),
  };
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
// Synergy hubs: the cards referenced by the most other entries (graph connections) —
// the deck's connective tissue. Distinct from anchors, which carry the most score.
function synergyHubs(dt, idToName) {
  return (g(dt, 'synergy', 'profile', 'hubs') || [])
    .filter((h) => h && h.cardId)
    .sort((a, b) => (b.connections || 0) - (a.connections || 0))
    .slice(0, 6)
    .map((h) => ({ name: idToName[h.cardId] || titleCase(h.cardId), connections: h.connections }));
}
// Manabase quality. CommanderSalt's headline number is `percentages.overall` — the curve
// axis as a PERCENT of its 100 benchmark (rounded). (`score`/totalCalories is the sum
// of the axes, a separate number.) The three /100 axes are manaFixing, quality, curve
// (bonuses can push an axis past 100). curveChart
// gives on-curve castability per turn (this deck's `actual` vs a typical `baseline`);
// composition counts the mana sources (lands / rocks / dorks / rituals / treasures + land
// sub-types: MDFC / fetch / utility / tapped); strengths/risks/improve are the scorer's
// raw profile signals. Full payload only (— in search hits).
function manabase(dt) {
  const m = g(dt, 'manabase') || {};
  const pct = m.percentages || {};
  const prof = m.profile || {};
  const comp = prof.composition || {};
  const fix = prof.fixing || {};
  const speed = prof.speed || {};
  const cons = prof.consistency || {};
  const dbg = m.debugManabase || {};
  const n = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const c0 = (x) => n(x) || 0;

  const turns = g(m, 'curveChart', 'turns') || {};
  const curve = Object.keys(turns)
    .map(Number).filter(Number.isFinite).sort((a, b) => a - b)
    .map((t) => ({ turn: t, actual: turns[t].actualPercentage, baseline: turns[t].baseLinePercentage }));

  // Strengths / risks / improve suggestions: passed through RAW ({ id, data }) — the
  // panel renders the id + data pairs directly, no sentence templating.
  const rawList = (list) => (list || []).filter((it) => it && it.id).map((it) => ({ id: it.id, data: it.data || {} }));

  // Per-color production vs requirement (empty on colorless decks). The comparable
  // REQ/PROD pair is breakdown.production.breakdown[color].percentages (what the
  // CommanderSalt bars plot — fractions of one shared scale, sometimes strings); the
  // raw requirementCount/productionCount are different units (pips vs producers).
  const prodBd = g(m, 'breakdown', 'production', 'breakdown') || {};
  const pf = (x) => { const v = parseFloat(x); return Number.isFinite(v) ? v : null; };
  const perColor = Object.entries(fix.perColor || {}).map(([color, v]) => {
    const pcts = (prodBd[color] || {}).percentages || {};
    return {
      color,
      req: pf(pcts.requirements), // fraction 0–1
      prod: pf(pcts.production),
      ratio: n(v.coverageRatio) != null ? n(v.coverageRatio) : pf(pcts.productionToRequirementRatio),
      deficit: !!v.deficit,
    };
  });

  return {
    // headline percent vs benchmark: percentages.overall (= round(curve); 111 = 11% over)
    overall: n(pct.overall) != null ? n(pct.overall) : (n(pct.curve) != null ? Math.round(n(pct.curve)) : null),
    score: n(m.score), // the SUM of the three axes ("total calories"; not the headline)
    // axes are each scored vs their own /100 benchmark (100 = met; bonuses exceed)
    fixing: n(pct.manaFixing),
    quality: n(pct.quality),
    curveScore: n(pct.curve),
    curve, // [{ turn, actual, baseline }] — fractions 0–1
    perColor, // [{ color, req, prod, ratio, deficit }]
    composition: {
      // "lands" = mana-producing lands (what CommanderSalt's Lands figures count;
      // pure-utility lands are excluded), falling back to the total land count.
      lands: c0(comp.manaProducingLandCount) || c0(comp.landCount),
      basics: c0(comp.basicCount), rocks: c0(comp.rockCount),
      dorks: c0(comp.dorkCount), rituals: c0(comp.ritualCount), treasures: c0(comp.treasureCount),
      landRamp: c0(comp.landRampCount), mdfc: c0(comp.mdfcLandCount), fetch: c0(comp.fetchCount),
      utility: c0(comp.utilityLandCount), tapped: c0(comp.tapLandCount),
    },
    stats: {
      lands: c0(comp.manaProducingLandCount) || c0(comp.landCount),
      sources: n(dbg.totalManaSourceCount) != null ? n(dbg.totalManaSourceCount) : n(cons.sourceCount),
      expected: n(cons.expectedSourceCount) != null ? n(cons.expectedSourceCount) : n(dbg.expectedMinSources),
      avgCmc: n(cons.avgCmc) != null ? n(cons.avgCmc) : n(dbg.avgCMC),
      fastMana: c0(speed.fastManaLandCount),
      mdfc: c0(comp.mdfcLandCount),
      baseCmc: n(g(m, 'breakdown', 'baseTotalCmc')),
      costReducers: Object.keys(g(m, 'breakdown', 'genericManaReducers') || {}).length,
      reducedCards: n(g(m, 'details', 'totalReducedCostCards')),
    },
    strengths: rawList(prof.strengths), // [{ id, data }] — raw scorer signals
    risks: rawList(prof.risks),
    improve: rawList(prof.improve),
    sources: Object.keys(m.manaProducers || {}).length,
  };
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
    powerProfile: powerProfile(dt),
    winconProfile: winconProfile(dt),
    bracketCategories: bracketCategories(dt, idToName),
    bracketProfile: bracketProfile(dt),
    archetypeMajors: archetypeMajors(dt),
    synergyAnchors: synergyAnchors(dt, idToName),
    synergyHubs: synergyHubs(dt, idToName),
    manabase: manabase(dt),
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
    // When CommanderSalt last analyzed the deck (epoch ms). Compared against
    // Moxfield's "last updated" to decide whether an edit needs a re-analysis.
    analyzedAt: g(p, 'ingestDate', 'ingestDate'),
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
