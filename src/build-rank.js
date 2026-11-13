// Guided Deck Builder ranking. Pure logic: turns EDHREC theme cards into key / theme / land
// tiers. Blocked cards stay in their tier with check.ok:false (rendered greyed); cards already
// in the deck are dropped (a tier is a list of things to add).
import { frontFace } from './sources/scryfall.js';
import { checkCard } from './build-rules.js';

const LAND_LISTS = new Set(['Lands', 'Utility Lands']);
const KEY_MIN_SYNERGY = 0.15;

const isGcKey = (key, info, flags) => !!(flags && flags.gameChangers && flags.gameChangers.has(key)) || !!(info[key] && info[key].gameChanger);

// Power stand-in (spec decision 3): synergy dominates, then popularity, GC and combo bonuses.
export function keyScore(card, info, comboKeys, flags) {
  const key = frontFace(card.name);
  return (card.synergy || 0) * 0.6
    + ((card.inclusionPct || 0) / 100) * 0.25
    + (isGcKey(key, info || {}, flags) ? 0.1 : 0)
    + (comboKeys && comboKeys.has(key) ? 0.05 : 0);
}

export function buildTiers({ themeCards, combos, ctx, keyCount = 15 }) {
  const out = { key: [], theme: [], lands: [], combos: combos || [] };
  if (!themeCards || !themeCards.length) return out;
  const comboKeys = new Set();
  for (const c of out.combos) {
    for (const p of (c && c.pieces) || []) if (p && p.name) comboKeys.add(frontFace(p.name));
    for (const n of (c && c.add) || []) comboKeys.add(frontFace(n));
  }
  const suggest = (c) => {
    const key = frontFace(c.name);
    const usd = ctx.info[key] ? ctx.info[key].usd : null;
    return {
      name: c.name,
      synergy: c.synergy,
      inclusionPct: c.inclusionPct,
      gameChanger: isGcKey(key, ctx.info, ctx.flags),
      usd: typeof usd === 'number' ? usd : null,
      check: checkCard(c.name, ctx),
    };
  };
  const fresh = themeCards.filter((c) => c && c.name && !ctx.deckKeys.has(frontFace(c.name)));
  const byPct = (a, b) => (b.inclusionPct || 0) - (a.inclusionPct || 0);
  const lands = fresh.filter((c) => LAND_LISTS.has(c.list));
  const spells = fresh.filter((c) => !LAND_LISTS.has(c.list));
  const cands = spells.filter((c) => (c.synergy || 0) >= KEY_MIN_SYNERGY)
    .map((c) => ({ c, s: keyScore(c, ctx.info, comboKeys, ctx.flags) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
  const keyed = new Set(cands.slice(0, keyCount));
  out.key = cands.slice(0, keyCount).map(suggest);
  out.theme = spells.filter((c) => !keyed.has(c)).sort(byPct).map(suggest);
  out.lands = lands.sort(byPct).map(suggest);
  return out;
}
