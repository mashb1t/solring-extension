// Guided Deck Builder build view: pure view-model helpers for render-builder.js (deck
// composition, rule chips, auto-complete preview grouping/totals, power verdict). No DOM.
import { frontFace } from './sources/scryfall.js';
import { checkCard, addToCtx, RULES_DEFAULT } from './build-rules.js';
import { DEFAULT_PRICING, formatPrice } from './pricing.js';

export const DECK_SIZE = 100;
export const LAND_TARGET = 36;

/**
 * What counts toward the 100 (commanders + mainboard) from a moxfield-edit shapeDeck() result.
 * `names` repeats each name by quantity (so the rules ctx counts basics' and copies' budget);
 * `unique` has one entry per card; `cards`/`lands` are the copy totals autocomplete needs.
 */
export function deckComposition(deck) {
  const names = [];
  const unique = [];
  let cards = 0;
  let lands = 0;
  for (const b of ['commanders', 'mainboard']) {
    for (const e of Object.values((deck && deck.boards && deck.boards[b]) || {})) {
      const q = Math.max(1, e.quantity || 1);
      unique.push(e.name);
      for (let i = 0; i < q; i++) names.push(e.name);
      cards += q;
      if (e.isLand) lands += q;
    }
  }
  return { names, unique, current: { cards, lands } };
}

/**
 * Is the deck exactly the legal Commander size (`cards` = commanders + mainboard copies)?
 * → { legal, diff (cards − size: negative = under), label (tooltip text when not legal, else '') }
 */
export function deckSizeStatus(cards, size = DECK_SIZE) {
  const n = Number(cards) || 0;
  const diff = n - size;
  if (diff === 0) return { legal: true, diff, label: '' };
  return { legal: false, diff, label: `Not legal: ${n} / ${size} cards (${Math.abs(diff)} ${diff < 0 ? 'under' : 'over'})` };
}

/**
 * Initial state of the build view (options.builderPanelDefault). Decks you can't edit always start
 * collapsed. 'open' / 'collapsed' force it; 'auto' (and anything unknown) opens while the deck is
 * below the legal size (`cards` = commanders + mainboard copies, deckComposition().current.cards).
 */
export function builderStartsOpen({ setting, editable, cards }) {
  if (!editable) return false;
  if (setting === 'open') return true;
  if (setting === 'collapsed') return false;
  return Number.isFinite(cards) ? cards < DECK_SIZE : true;
}

/** Do the deck's rules equal RULES_DEFAULT (so the rules bar's Reset has nothing to undo)? */
export function rulesAreDefault(rules) {
  const r = rules || {};
  return Number(r.bracket ?? RULES_DEFAULT.bracket) === RULES_DEFAULT.bracket && r.gameChangerCap == null
    && !r.power && r.budget == null && !r.ownedOnly;
}

/** getCardData({op:'flags'}) → Sets for makeCtx. A miss/error/missing list → empty Set. */
export function flagSets(res) {
  const set = (k) => new Set(res && Array.isArray(res[k]) ? res[k] : []);
  return { gameChangers: set('gameChangers'), extraTurns: set('extraTurns'), massLandDenial: set('massLandDenial') };
}

/** Did getCardData({op:'flags'}) return the real lists? (The worker serves a stale copy on a failed
 *  refresh, so false means nothing is cached at all: extra-turn / MLD / GC checks can't run.) */
export function flagsAvailable(res) {
  return !!(res && !res.error && !res.miss && ['gameChangers', 'extraTurns', 'massLandDenial'].every((k) => Array.isArray(res[k])));
}

/** Same commander set, compared by lowercased front face (order-insensitive). */
export function commanderMatches(a, b) {
  const ka = new Set((a || []).filter(Boolean).map(frontFace));
  const kb = new Set((b || []).filter(Boolean).map(frontFace));
  return ka.size > 0 && ka.size === kb.size && [...ka].every((k) => kb.has(k));
}

/** Unique names to fetch card info for in ONE batch: the deck, theme candidates, combo pieces. */
export function infoNames({ deckNames = [], themeCards = [], comboResults = null }) {
  const out = new Map();
  const put = (n) => { if (n && !out.has(frontFace(n))) out.set(frontFace(n), n); };
  deckNames.forEach(put);
  (themeCards || []).forEach((c) => put(c && c.name));
  for (const combo of (comboResults && comboResults.almostIncluded) || []) {
    for (const u of combo.uses || []) put(u && u.card && u.card.name);
  }
  return [...out.values()];
}

/** A price in the pricing's currency ("$1.50" / "€1.50" / "1.50 tix"), or 'no price'. */
export const priceText = (n, pricing = DEFAULT_PRICING) => formatPrice(n, pricing);
const whole = (n, pricing = DEFAULT_PRICING) => formatPrice(n, pricing, { whole: true });

/**
 * ruleUsage(ctx) → chips: { key, text, pct (0–1 meter fill, or null), warn, hint }.
 * `warn` = the limit is reached (the next card of that kind is blocked). `flagsMissing` appends a
 * "Bracket checks unavailable" warning chip (flag lists couldn't load).
 */
export function ruleChips(usage, { flagsMissing = false } = {}) {
  const chips = (usage || []).map((u) => {
    if (u.key === 'gc') {
      if (u.max === Infinity) return { key: 'gc', text: `Game Changers ${u.used} / no cap`, pct: null, warn: false };
      return { key: 'gc', text: `Game Changers ${u.used} / ${u.max}`, pct: u.max > 0 ? Math.min(1, u.used / u.max) : 1, warn: u.used >= u.max };
    }
    if (u.key === 'budget') {
      return { key: 'budget', text: `Budget ${whole(u.used, u.pricing)} / ${whole(u.max, u.pricing)}`, pct: u.max > 0 ? Math.min(1, u.used / u.max) : 1, warn: u.used >= u.max };
    }
    if (u.key === 'power') return { key: 'power', text: u.label, pct: null, warn: false, hint: 'target' };
    return { key: u.key, text: u.label, pct: null, warn: false };
  });
  if (flagsMissing) chips.push({ key: 'flags', text: 'Bracket checks unavailable', pct: null, warn: true });
  return chips;
}

/**
 * Combo tile state: the pieces still to add, checked in sequence against a running ctx (all of
 * them must fit, like autocomplete's all-or-nothing combos). → { add, ok, reason }.
 */
export function comboCheck(combo, ctx) {
  const add = ((combo && combo.add) || []).filter((n) => !ctx.deckKeys.has(frontFace(n)));
  let run = ctx;
  for (const n of add) {
    const c = checkCard(n, run);
    if (!c.ok) return { add, ok: false, reason: `${n}: ${c.reason}` };
    run = addToCtx(run, n);
  }
  return { add, ok: add.length > 0, reason: add.length ? null : 'Already in deck' };
}

const TIER_LABEL = { key: 'Key cards', theme: 'Theme cards', land: 'Lands' };

/** proposeFill picks → [{ tier, label, rows:[{ i, name, qty, price }] }] in key/theme/land order. */
export function groupPicks(picks) {
  const groups = [];
  for (const tier of ['key', 'theme', 'land']) {
    const rows = [];
    (picks || []).forEach((p, i) => { if (p.tier === tier) rows.push({ i, name: p.name, qty: p.qty, price: p.price }); });
    if (rows.length) groups.push({ tier, label: TIER_LABEL[tier], rows, count: rows.reduce((n, r) => n + r.qty, 0) });
  }
  return groups;
}

/**
 * Totals for the ticked preview rows against the current deck + rules.
 * → { count, cost, gcAdded, landsAdded, deckAfter, landsAfter, gcAfter, spentAfter }
 */
export function previewTotals({ picks, ticked, ctx, current }) {
  let count = 0; let cost = 0; let gcAdded = 0; let landsAdded = 0;
  (picks || []).forEach((p, i) => {
    if (!ticked.has(i)) return;
    count += p.qty;
    cost += (p.price || 0) * p.qty;
    if (p.tier === 'land') landsAdded += p.qty;
    const key = frontFace(p.name);
    if (ctx.flags.gameChangers.has(key) || (ctx.info[key] && ctx.info[key].gameChanger)) gcAdded += p.qty;
  });
  return {
    count, cost, gcAdded, landsAdded,
    deckAfter: current.cards + count,
    landsAfter: current.lands + landsAdded,
    gcAfter: ctx.gcUsed + gcAdded,
    spentAfter: ctx.spent + cost,
  };
}

/** The preview's one-line summary under the title (amounts in `pricing`'s currency; `lands` = the
 *  land target, the TCGplayer formula's when that option is on). */
export function previewSummary(t, rules, gcCap, pricing = DEFAULT_PRICING, lands = LAND_TARGET) {
  const parts = [`${t.count} cards proposed`, `deck ${t.deckAfter} / ${DECK_SIZE}`, `lands ${t.landsAfter} / ${lands}`, `Bracket ${rules.bracket}`];
  parts.push(gcCap === Infinity ? `Game Changers ${t.gcAfter}` : `Game Changers ${t.gcAfter} / ${gcCap}`);
  if (rules.budget != null) parts.push(`${priceText(t.spentAfter, pricing)} / ${whole(rules.budget, pricing)}`);
  else parts.push(`adds ${priceText(t.cost, pricing)}`);
  return parts.join(' · ');
}

/** "Short by N cards — <binding rule>" when autocomplete couldn't reach the target size. */
export function shortfallText(fill) {
  if (!fill || !(fill.shortfall > 0)) return null;
  const n = fill.shortfall;
  const head = `Short by ${n} card${n === 1 ? '' : 's'}`;
  return fill.binding ? `${head}: ${fill.binding} is the binding rule.` : `${head}: not enough suggestions fit the rules.`;
}

/**
 * importDeck() result vs the soft Power target {min,max} → the status line.
 * Stub / miss / error / no number → unavailable (CommanderSalt can't import private decks).
 */
export function powerVerdict(res, target) {
  const p = res && res.fields && typeof res.fields.power === 'number' ? res.fields.power : null;
  if (p == null) return 'Power check unavailable (private deck)';
  const v = (Math.round(p * 10) / 10).toFixed(1);
  const range = `${target.min}–${target.max}`;
  if (p > target.max) return `Power ${v} — above target ${range}`;
  if (p < target.min) return `Power ${v} — below target ${range}`;
  return `Power ${v} — within target`;
}

/**
 * The "+ rule" form values → a rules patch, or { error }. Blank fields clear a rule.
 * Inputs are strings (form values); bracket 1–5, GC cap ≥ 0, power 1–10 with min ≤ max, budget > 0.
 */
export function parseRulesForm({ bracket, gcCap, powerMin, powerMax, budget }, pricing = DEFAULT_PRICING) {
  const num = (s) => (String(s ?? '').trim() === '' ? null : Number(s));
  const b = Number(bracket);
  if (!(Number.isInteger(b) && b >= 1 && b <= 5)) return { error: 'Bracket must be 1–5' };
  const cap = num(gcCap);
  if (cap != null && !(Number.isInteger(cap) && cap >= 0)) return { error: 'Game Changer cap must be a whole number ≥ 0' };
  const lo = num(powerMin); const hi = num(powerMax);
  let power = null;
  if (lo != null || hi != null) {
    if (lo == null || hi == null || !(lo >= 1 && hi <= 10 && lo <= hi)) return { error: 'Power target needs min ≤ max within 1–10' };
    power = { min: lo, max: hi };
  }
  const bud = num(budget);
  if (bud != null && !(bud > 0)) return { error: `Budget must be more than ${whole(0, pricing)}` };
  return { rules: { bracket: b, gameChangerCap: cap, power, budget: bud } };
}

export const NOT_OWNED = 'Not in your collection';

/** With "Only cards I own" active, not-owned suggestions are filtered out (not greyed). → { shown, hidden } */
export function ownedFilter(list, ownedOnly) {
  if (!ownedOnly) return { shown: list || [], hidden: 0 };
  const shown = (list || []).filter((s) => !(s.check && !s.check.ok && s.check.reason === NOT_OWNED));
  return { shown, hidden: (list || []).length - shown.length };
}

// ---- manual-edit sync (deck edited in Moxfield itself / another tab) ----------------------------

/**
 * A message on Moxfield's `moxfield-sync-{ownerUserId}` BroadcastChannel → the deck version it
 * announces for `publicId` (a number), 'unknown' (it's about this deck but carries no version), or
 * null (not a deck message, or another deck).
 */
export function deckSyncTarget(msg, publicId) {
  if (!msg || typeof msg !== 'object' || msg.kind !== 'deck' || !publicId || msg.publicId !== publicId) return null;
  return Number.isFinite(msg.version) ? msg.version : 'unknown';
}

/** Fold a new trigger (deckSyncTarget result, or 'unknown' for a DOM change) into the pending
 *  want { version: highest announced | null, unknown: bool }. null/undefined → want unchanged. */
export function mergeSyncWant(want, target) {
  const w = want || { version: null, unknown: false };
  if (target == null) return w;
  if (target === 'unknown') return { ...w, unknown: true };
  return { ...w, version: w.version == null ? target : Math.max(w.version, target) };
}

/**
 * Does the pending want still need a deck re-read, given the version the builder already holds?
 * A version-less trigger always does; an announced version only when it's newer than `have`
 * (so our own write's echo, already applied by refreshDeck, needs nothing).
 */
export function syncNeeded(want, have) {
  if (!want) return false;
  if (want.unknown) return true;
  if (want.version == null) return false;
  return !Number.isFinite(have) || want.version > have;
}

/**
 * Cheap order-insensitive signature of a decklist: [{ name, qty }] → "front face:qty|…", or null
 * for an empty list (non-table views render no rows: nothing to compare). Repeated names (a card
 * shown under two groupings) collapse to one entry.
 */
export function deckSignature(entries) {
  const m = new Map();
  for (const e of entries || []) {
    if (!e || !e.name) continue;
    m.set(frontFace(e.name), Math.max(1, Number(e.qty) || 1));
  }
  if (!m.size) return null;
  return [...m].map(([k, q]) => `${k}:${q}`).sort().join('|');
}

// Decklist row keys are "{view section}-{index}|{hash}"; the section is what the row is listed
// under: mainboard-commander / mainboard-main are the 100, while sideboard and maybeboard cards
// show as mainboard-sideboard-… / maybeboard-main-… (LIVE-VERIFY 2026-11-15).
const DECK_ROW_RE = /^mainboard-(commander|main)-/;

/** Decklist rows [{ rowKey, name, qty }] → the [{ name, qty }] that count toward the 100. */
export function deckRowEntries(rows) {
  return (rows || []).filter((r) => r && DECK_ROW_RE.test(r.rowKey || '')).map((r) => ({ name: r.name, qty: r.qty }));
}

/**
 * Do the decklist rows show something the builder's deck state (shapeDeck result) doesn't: a card
 * outside its commanders + mainboard, or another quantity? A filtered/searched list (a subset of
 * the state) is not ahead, so it triggers no re-read; removals are left to the sync broadcast.
 */
export function rowsAhead(entries, deck) {
  const have = new Map();
  for (const b of ['commanders', 'mainboard']) {
    for (const e of Object.values((deck && deck.boards && deck.boards[b]) || {})) have.set(frontFace(e.name), Math.max(1, e.quantity || 1));
  }
  return (entries || []).some((e) => e && e.name && have.get(frontFace(e.name)) !== Math.max(1, Number(e.qty) || 1));
}

/** The selection (front-face key → name) kept after a re-read: only cards still in the mainboard. */
export function pruneSelection(selected, mainboard) {
  const out = new Map();
  for (const [k, name] of selected || []) {
    const e = mainboard && mainboard[k];
    if (e) out.set(k, e.name || name);
  }
  return out;
}
