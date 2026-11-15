// Guided Deck Builder rules engine. Pure logic: decides whether a card may be added under the
// user's Bracket / Game Changer cap / whole-deck budget / owned-only rules. Cards are keyed by
// lowercased front face (scryfall.frontFace); `owned` is a Set of such keys.
import { frontFace } from './sources/scryfall.js';
import { BASICS } from './sources/edhrec.js';
import { DEFAULT_PRICING, formatPrice } from './pricing.js';

export const RULES_DEFAULT = { bracket: 3, gameChangerCap: null, power: null, budget: null, ownedOnly: false };

// Spellbook bracket tags → minimum bracket. 'B' (Banned: uses a banned card) is never allowed.
const COMBO_MIN_BRACKET = { E: 1, O: 2, C: 2, S: 3, P: 3, R: 4, B: Infinity };

function bracketGcCap(bracket) {
  if (bracket <= 2) return 0;
  return bracket === 3 ? 3 : Infinity;
}

export function effectiveGcCap(rules) {
  const cap = rules.gameChangerCap;
  return Math.min(bracketGcCap(rules.bracket), cap == null ? Infinity : cap);
}

// Unknown/null tag is only allowed where nothing is restricted (bracket 4+).
export function comboAllowed(bracketTag, bracket) {
  const min = COMBO_MIN_BRACKET[bracketTag];
  return min == null ? bracket >= 4 : min <= bracket;
}

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
  let ctx = { rules, info: info || {}, pricing: pricing || DEFAULT_PRICING, flags, owned: owned || null, deckKeys: new Set(), gcUsed: 0, spent: 0, forbidden };
  for (const n of deckNames || []) ctx = addToCtx(ctx, n);
  return ctx;
}

export function addToCtx(ctx, name) {
  const { gcUsed, spent, key } = count(ctx, name);
  return { ...ctx, deckKeys: new Set(ctx.deckKeys).add(key), gcUsed, spent };
}

export function checkCard(name, ctx) {
  const key = frontFace(name);
  const { rules } = ctx;
  const basic = BASICS.has(key);
  if (!basic && ctx.deckKeys.has(key)) return { ok: false, reason: 'Already in deck' };
  const cap = effectiveGcCap(rules);
  if (isGc(key, ctx) && ctx.gcUsed + 1 > cap) {
    return { ok: false, reason: `Would be Game Changer #${ctx.gcUsed + 1} (cap ${cap})` };
  }
  // Deliberately conservative: the official brackets only bar CHAINED extra turns at B1–3, but a
  // builder can't tell a lone extra-turn card from a future chain, so every one is blocked there.
  if (rules.bracket <= 3) {
    if (ctx.flags.extraTurns.has(key)) return { ok: false, reason: `Not allowed at Bracket ${rules.bracket} (extra turn)` };
    if (ctx.flags.massLandDenial.has(key)) return { ok: false, reason: `Not allowed at Bracket ${rules.bracket} (mass land denial)` };
  }
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

export function ruleUsage(ctx) {
  const { rules } = ctx;
  const out = [{ key: 'bracket', label: `Bracket ${rules.bracket}`, used: null, max: null }];
  out.push({ key: 'gc', label: 'Game Changers', used: ctx.gcUsed, max: effectiveGcCap(rules) });
  if (rules.budget != null) out.push({ key: 'budget', label: 'Budget', used: ctx.spent, max: rules.budget, pricing: ctx.pricing || DEFAULT_PRICING });
  if (rules.power) out.push({ key: 'power', label: `Power ${rules.power.min}–${rules.power.max}`, used: null, max: null });
  return out;
}
