// Guided Deck Builder auto-complete. Pure logic: fills a deck to `size` cards from the tiered
// suggestions (combo pieces -> key -> theme -> non-basic lands -> basics) without ever breaking
// a hard rule. Every pick is re-checked with checkCard against a running ctx (addToCtx), so
// Game Changer / budget usage accumulates; precomputed `check`s on suggestions are ignored.
import { frontFace } from './sources/scryfall.js';
import { BASICS } from './sources/edhrec.js';
import { addToCtx, checkCard } from './build-rules.js';

const BASIC_FOR = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
const WASTES = 'Wastes';

// Split `n` slots across `names` as evenly as possible; largest remainder keeps the sum exact.
function splitEvenly(n, names) {
  const base = Math.floor(n / names.length);
  let extra = n - base * names.length;
  return names.map((name) => ({ name, qty: base + (extra-- > 0 ? 1 : 0) }));
}

const reasonGroup = (reason) => reason.split('(')[0].trim();

/**
 * @param {object} a
 * @param {{key:Array, theme:Array, lands:Array, combos:Array}} a.tiers  buildTiers() result
 * @param {object} a.ctx  rules ctx (makeCtx) for the CURRENT deck
 * @param {number} [a.size=100]  target deck size incl. commander(s)
 * @param {number} [a.lands=36]  target land count
 * @param {string[]} [a.colorIdentity=[]]  e.g. ['W','U']; empty -> Wastes
 * @param {{cards:number, lands:number}} [a.current]  current deck composition (card count incl.
 *   commanders and basic copies, and how many of those are lands). ctx.deckKeys is a Set so it
 *   cannot carry basic copy counts. Defaults to { cards: ctx.deckKeys.size, lands: 0 }.
 * @returns {{picks:Array<{name,tier,qty,usd}>, total:number, cost:number, shortfall:number, binding:string|null}}
 */
export function proposeFill({ tiers, ctx, size = 100, lands = 36, colorIdentity = [], current }) {
  const cur = current || { cards: ctx.deckKeys.size, lands: 0 };
  let nonLandSlots = Math.max(0, size - lands - (cur.cards - cur.lands));
  let landSlots = Math.max(0, lands - cur.lands);
  // A deck already past one target (> lands lands, or > size - lands non-lands) leaves fewer
  // free slots than the two targets suggest: clamp so cur.cards + total never exceeds size.
  // Only one side can be over at a time, so shrinking whichever slot count overflows is exact.
  const room = Math.max(0, size - cur.cards);
  landSlots = Math.min(landSlots, room);
  nonLandSlots = Math.min(nonLandSlots, room - landSlots);
  const startSpent = ctx.spent;
  const picks = [];
  const rejections = [];
  let run = ctx;

  const usdOf = (name) => {
    const u = run.info[frontFace(name)] && run.info[frontFace(name)].usd;
    return typeof u === 'number' ? u : null;
  };
  const tryAdd = (name) => {
    const c = checkCard(name, run);
    if (!c.ok) {
      if (c.reason !== 'Already in deck') rejections.push(c.reason);
      return false;
    }
    run = addToCtx(run, name);
    return true;
  };
  const take = (name, tier) => {
    picks.push({ name, tier, qty: 1, usd: usdOf(name) });
    nonLandSlots--;
  };

  // Combo pieces first: all-or-nothing per combo.
  for (const combo of (tiers && tiers.combos) || []) {
    const need = ((combo && combo.add) || []).filter((n) => !run.deckKeys.has(frontFace(n)));
    if (!need.length || need.length > nonLandSlots) continue;
    const before = run;
    let ok = true;
    for (const n of need) if (!tryAdd(n)) { ok = false; break; }
    if (!ok) { run = before; continue; }
    for (const n of need) take(n, 'key');
  }

  for (const [list, tier] of [[(tiers && tiers.key) || [], 'key'], [(tiers && tiers.theme) || [], 'theme']]) {
    for (const s of list) {
      if (nonLandSlots <= 0) break;
      if (!s || !s.name) continue;
      if (tryAdd(s.name)) take(s.name, tier);
    }
  }

  for (const s of (tiers && tiers.lands) || []) {
    if (landSlots <= 0) break;
    if (!s || !s.name || BASICS.has(frontFace(s.name))) continue;
    if (tryAdd(s.name)) {
      picks.push({ name: s.name, tier: 'land', qty: 1, usd: usdOf(s.name) });
      landSlots--;
    }
  }

  if (landSlots > 0) {
    const names = colorIdentity.map((c) => BASIC_FOR[c]).filter(Boolean);
    for (const { name, qty } of splitEvenly(landSlots, names.length ? names : [WASTES])) {
      let got = 0;
      while (got < qty && tryAdd(name)) got++;
      if (got) picks.push({ name, tier: 'land', qty: got, usd: usdOf(name) });
    }
  }

  const total = picks.reduce((n, p) => n + p.qty, 0);
  const shortfall = Math.max(0, size - (cur.cards + total));
  let binding = null;
  if (shortfall > 0 && rejections.length) {
    const groups = new Map();
    for (const r of rejections) {
      const g = reasonGroup(r);
      if (!groups.has(g)) groups.set(g, { first: r, n: 0 });
      groups.get(g).n++;
    }
    let best = null;
    for (const v of groups.values()) if (!best || v.n > best.n) best = v;
    binding = best.first;
  }
  return { picks, total, cost: run.spent - startSpent, shortfall, binding };
}
