// Guided Deck Builder rules engine. Pure logic: decides whether a card may be added under the
// user's Bracket / Game Changer cap / whole-deck budget / owned-only rules. Cards are keyed by
// lowercased front face (scryfall.frontFace); `owned` is a Set of such keys.
import { frontFace } from './sources/scryfall.js';
import { BASICS } from './sources/edhrec.js';

export const RULES_DEFAULT = { bracket: 3, gameChangerCap: null, power: null, budget: null, ownedOnly: false };

const COMBO_MIN_BRACKET = { E: 1, O: 2, C: 2, S: 3, P: 3, R: 4 };

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
// Absent from info counts as unknown price (null), never free.
const priceOf = (key, ctx) => {
  const usd = ctx.info[key] && ctx.info[key].usd;
  return typeof usd === 'number' ? usd : null;
};

function count(ctx, name) {
  const key = frontFace(name);
  return {
    gcUsed: ctx.gcUsed + (isGc(key, ctx) ? 1 : 0),
    spent: ctx.spent + (priceOf(key, ctx) || 0),
    key,
  };
}

export function makeCtx({ rules, info, flags, owned, deckNames }) {
  let ctx = { rules, info: info || {}, flags, owned: owned || null, deckKeys: new Set(), gcUsed: 0, spent: 0 };
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
  if (rules.bracket <= 3) {
    if (ctx.flags.extraTurns.has(key)) return { ok: false, reason: `Not allowed at Bracket ${rules.bracket} (extra turn)` };
    if (ctx.flags.massLandDenial.has(key)) return { ok: false, reason: `Not allowed at Bracket ${rules.bracket} (mass land denial)` };
  }
  if (rules.budget != null) {
    const usd = priceOf(key, ctx);
    if (usd == null) return { ok: false, reason: 'No price (budget set)' };
    const left = rules.budget - ctx.spent;
    if (usd > left) return { ok: false, reason: `Over budget ($${Math.max(left, 0).toFixed(2)} left)` };
  }
  // Basics are free and collections rarely list them, so owned-only never blocks them.
  if (rules.ownedOnly && !basic && ctx.owned && !ctx.owned.has(key)) return { ok: false, reason: 'Not in your collection' };
  return { ok: true };
}

export function ruleUsage(ctx) {
  const { rules } = ctx;
  const out = [{ key: 'bracket', label: `Bracket ${rules.bracket}`, used: null, max: null }];
  out.push({ key: 'gc', label: 'Game Changers', used: ctx.gcUsed, max: effectiveGcCap(rules) });
  if (rules.budget != null) out.push({ key: 'budget', label: 'Budget', used: ctx.spent, max: rules.budget });
  if (rules.power) out.push({ key: 'power', label: `Power ${rules.power.min}–${rules.power.max}`, used: null, max: null });
  return out;
}
