// Guided Deck Builder rules engine. Pure logic: decides whether a card may be added under the
// user's Bracket / Game Changer cap / whole-deck budget / owned-only rules. Cards are keyed by
// lowercased front face (scryfall.frontFace); `owned` is a Set of such keys.
import { frontFace } from './sources/scryfall.js';
import { BASICS } from './sources/edhrec.js';
import { DEFAULT_PRICING, formatPrice } from './pricing.js';

// Per-bracket rule presets (official Commander Brackets; the tutor numbers are Solring's reading of
// "very few" / "few"). A rule the user hasn't set (stored null) follows the CURRENT bracket's preset;
// an explicit value is an override and wins. gameChangerCap is a hard bracket ceiling (clampGcCap),
// tutorCap / noLandHate are soft defaults the user may loosen. Extra turns are not overridable.
export const BRACKET_PRESETS = Object.freeze({
  1: Object.freeze({ gameChangerCap: 0, noLandHate: true, allowExtraTurns: false, tutorCap: 1, noStax: false }),
  2: Object.freeze({ gameChangerCap: 0, noLandHate: true, allowExtraTurns: false, tutorCap: 3, noStax: false }),
  3: Object.freeze({ gameChangerCap: 3, noLandHate: true, allowExtraTurns: false, tutorCap: null, noStax: false }),
  4: Object.freeze({ gameChangerCap: Infinity, noLandHate: false, allowExtraTurns: true, tutorCap: null, noStax: false }),
  5: Object.freeze({ gameChangerCap: Infinity, noLandHate: false, allowExtraTurns: true, tutorCap: null, noStax: false }),
});

/** The preset row for a bracket; out-of-range values clamp to 1–5, garbage reads as Bracket 3. */
export function bracketPreset(bracket) {
  const n = Number(bracket);
  if (!Number.isFinite(n)) return BRACKET_PRESETS[3];
  return BRACKET_PRESETS[Math.min(5, Math.max(1, Math.round(n)))];
}

// Stored-rules schema. v2 = bracket presets. Before it, noLandHate defaulted to false and false
// meant "off", so an old explicit false can't be told from an untouched one: migrateRules reads
// an unversioned false as null (= follow the preset). Unversioned tutorCap null meant "no limit"
// and now means "preset", which is intended (B1–2 get a tutor cap by default).
export const RULES_V = 2;

// gameChangerCap / tutorCap / noLandHate: null = the bracket preset (see BRACKET_PRESETS).
// tutorCap counts Scryfall otag:tutor minus land tutors. noStax: block stax pieces (plain boolean).
export const RULES_DEFAULT = { v: RULES_V, bracket: 3, gameChangerCap: null, power: null, budget: null, ownedOnly: false, tutorCap: null, noLandHate: null, noStax: false };

/** Stored rules of any version → v2 shape (unversioned noLandHate false → null). Pure; never mutates. */
export function migrateRules(rules) {
  const r = { ...(rules || {}) };
  if (r.v == null) {
    if (r.noLandHate === false) r.noLandHate = null;
    r.v = RULES_V;
  }
  return r;
}

// Spellbook bracket tags → minimum bracket. 'B' (Banned: uses a banned card) is never allowed.
const COMBO_MIN_BRACKET = { E: 1, O: 2, C: 2, S: 3, P: 3, R: 4, B: Infinity };

export function bracketGcCap(bracket) {
  return bracketPreset(bracket).gameChangerCap;
}

// A user GC cap at or above the bracket's own cap adds nothing, so it's stored as null (= the
// bracket default). That also means a bracket change can never leave a cap above the new maximum.
export function clampGcCap(cap, bracket) {
  if (cap == null) return null;
  return cap >= bracketGcCap(bracket) ? null : cap;
}

export function effectiveGcCap(rules) {
  const cap = clampGcCap(rules.gameChangerCap, rules.bracket);
  return cap == null ? bracketGcCap(rules.bracket) : cap;
}

/**
 * RAW stored rules → the rules in force: stored overrides merged over bracketPreset(rules.bracket).
 * Always pass RAW rules (never an effectiveRules result): `fromPreset` says which values came from
 * the preset, and drives the chip / block-reason wording. GC stays on effectiveGcCap's path.
 */
export function effectiveRules(rules) {
  const r = migrateRules(rules);
  const bracket = Number(r.bracket ?? RULES_DEFAULT.bracket);
  const preset = bracketPreset(bracket);
  const fromPreset = {
    gameChangerCap: clampGcCap(r.gameChangerCap ?? null, bracket) == null,
    tutorCap: r.tutorCap == null,
    noLandHate: r.noLandHate == null,
  };
  return {
    ...r,
    bracket,
    gcCap: effectiveGcCap({ ...r, bracket }),
    tutorCap: fromPreset.tutorCap ? preset.tutorCap : r.tutorCap,
    noLandHate: fromPreset.noLandHate ? preset.noLandHate : !!r.noLandHate,
    noStax: !!r.noStax,
    allowExtraTurns: preset.allowExtraTurns,
    preset,
    fromPreset,
  };
}

// Unknown/null tag is only allowed where nothing is restricted (bracket 4+).
export function comboAllowed(bracketTag, bracket) {
  const min = COMBO_MIN_BRACKET[bracketTag];
  return min == null ? bracket >= 4 : min <= bracket;
}

// Flag lists added later (tutors, …) may be absent from an older ctx/flags object: never matches.
const inFlag = (ctx, list, key) => !!(ctx.flags && ctx.flags[list] && ctx.flags[list].has(key));
const isGc = (key, ctx) => ctx.flags.gameChangers.has(key) || !!(ctx.info[key] && ctx.info[key].gameChanger);
// `info[key].price` is in the user's provider currency (pricing.pricedInfo). Absent from info
// counts as unknown price (null), never free; except basics, which are 0 whenever no price is known
// (absent from info, or Scryfall's price is null as it often is for a basic's default printing).
// A basic with a known price uses it.
export const priceOf = (key, ctx) => {
  const p = ctx.info[key] && ctx.info[key].price;
  if (typeof p === 'number') return p;
  return BASICS.has(key) ? 0 : null;
};

function count(ctx, name) {
  const key = frontFace(name);
  return {
    gcUsed: ctx.gcUsed + (isGc(key, ctx) ? 1 : 0),
    tutorUsed: (ctx.tutorUsed || 0) + (inFlag(ctx, 'tutors', key) ? 1 : 0),
    spent: ctx.spent + (priceOf(key, ctx) || 0),
    key,
  };
}

// Spellbook find-my-combos results → [{ keys, bracketTag }] for makeCtx's `combos`: each combo's
// pieces as front-face keys. Only almostIncluded matters (an `included` combo is already complete,
// so no addition can complete it).
export function comboGuards(results) {
  const out = [];
  for (const c of (results && results.almostIncluded) || []) {
    const keys = [...new Set((c.uses || []).map((u) => u && u.card && u.card.name).filter(Boolean).map(frontFace))];
    if (keys.length) out.push({ keys, bracketTag: c.bracketTag || null });
  }
  return out;
}

// `combos` (comboGuards output) is optional: the ones not allowed at the bracket are kept so
// checkCard can refuse the last missing piece of any of them. addToCtx carries them along, so a
// running ctx (auto-complete, combo tiles) also catches two picks that complete one together.
// `pricing` (pricing.pricingFor) is the currency budget texts are shown in; default TCGplayer/USD.
export function makeCtx({ rules, info, flags, owned, deckNames, combos, pricing }) {
  const forbidden = (combos || []).filter((c) => !comboAllowed(c.bracketTag, rules.bracket)).map((c) => c.keys);
  let ctx = { rules, eff: effectiveRules(rules), info: info || {}, pricing: pricing || DEFAULT_PRICING, flags, owned: owned || null, deckKeys: new Set(), gcUsed: 0, tutorUsed: 0, spent: 0, forbidden };
  for (const n of deckNames || []) ctx = addToCtx(ctx, n);
  return ctx;
}

export function addToCtx(ctx, name) {
  const { gcUsed, tutorUsed, spent, key } = count(ctx, name);
  return { ...ctx, deckKeys: new Set(ctx.deckKeys).add(key), gcUsed, tutorUsed, spent };
}

export function checkCard(name, ctx) {
  const key = frontFace(name);
  const { rules } = ctx;
  const eff = ctx.eff || effectiveRules(rules);
  const basic = BASICS.has(key);
  if (!basic && ctx.deckKeys.has(key)) return { ok: false, reason: 'Already in deck' };
  const cap = effectiveGcCap(rules);
  if (isGc(key, ctx) && ctx.gcUsed + 1 > cap) {
    return { ok: false, reason: `Would be Game Changer #${ctx.gcUsed + 1} (cap ${cap})` };
  }
  if (eff.tutorCap != null && inFlag(ctx, 'tutors', key) && (ctx.tutorUsed || 0) + 1 > eff.tutorCap) {
    return { ok: false, reason: `Would be tutor #${(ctx.tutorUsed || 0) + 1} (cap ${eff.tutorCap})` };
  }
  // Deliberately conservative: the official brackets only bar CHAINED extra turns at B1–3, but a
  // builder can't tell a lone extra-turn card from a future chain, so every one is blocked there.
  if (!eff.allowExtraTurns && inFlag(ctx, 'extraTurns', key)) return { ok: false, reason: `Not allowed at Bracket ${eff.bracket} (extra turn)` };
  // Mass land denial: the B1–3 preset reads as the bracket's rule; a user "No land hate" above
  // the preset as the user's. A user override off at B1–3 lets it through.
  if (eff.noLandHate && inFlag(ctx, 'massLandDenial', key)) {
    return { ok: false, reason: eff.preset.noLandHate ? `Not allowed at Bracket ${eff.bracket} (mass land denial)` : 'Blocked by your rules (mass land denial)' };
  }
  if (eff.noStax && inFlag(ctx, 'stax', key)) return { ok: false, reason: 'Blocked by your rules (stax)' };
  for (const keys of ctx.forbidden || []) {
    if (keys.includes(key) && keys.every((k) => k === key || ctx.deckKeys.has(k))) {
      return { ok: false, reason: `Would complete a combo not allowed at Bracket ${rules.bracket}` };
    }
  }
  if (rules.budget != null) {
    const price = priceOf(key, ctx);
    if (price == null) return { ok: false, reason: 'No price (budget set)' };
    const left = rules.budget - ctx.spent;
    if (price > left) return { ok: false, reason: `Over budget (${formatPrice(Math.max(left, 0), ctx.pricing || DEFAULT_PRICING)} left)` };
  }
  // Basics are free and collections rarely list them, so owned-only never blocks them.
  if (rules.ownedOnly && !basic && ctx.owned && !ctx.owned.has(key)) return { ok: false, reason: 'Not in your collection' };
  return { ok: true };
}

// Preset-derived entries carry `preset: true` + `bracket` so the chips can say "(Bracket N)".
export function ruleUsage(ctx) {
  const { rules } = ctx;
  const eff = ctx.eff || effectiveRules(rules);
  const out = [{ key: 'bracket', label: `Bracket ${rules.bracket}`, used: null, max: null }];
  out.push({ key: 'gc', label: 'Game Changers', used: ctx.gcUsed, max: effectiveGcCap(rules), bracket: rules.bracket, custom: clampGcCap(rules.gameChangerCap, rules.bracket) != null });
  if (eff.tutorCap != null) out.push({ key: 'tutors', label: 'Tutors', used: ctx.tutorUsed || 0, max: eff.tutorCap, bracket: eff.bracket, preset: eff.fromPreset.tutorCap });
  if (rules.budget != null) out.push({ key: 'budget', label: 'Budget', used: ctx.spent, max: rules.budget, pricing: ctx.pricing || DEFAULT_PRICING });
  if (eff.noLandHate) out.push({ key: 'noLandHate', label: 'No land hate', used: null, max: null, bracket: eff.bracket, preset: eff.fromPreset.noLandHate });
  else if (eff.preset.noLandHate) out.push({ key: 'landHate', label: 'Land hate allowed (your rule)', used: null, max: null });
  if (eff.noStax) out.push({ key: 'noStax', label: 'No stax', used: null, max: null });
  if (rules.power) out.push({ key: 'power', label: `Power ${rules.power.min}–${rules.power.max}`, used: null, max: null });
  return out;
}
