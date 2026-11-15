// Guided Deck Builder pricing: the user's Moxfield price provider → which price field to read and
// how to show it. Pure (no DOM, no chrome.*); render-builder resolves the provider and calls these.
//
// LIVE-VERIFY 2026-11-15 (Brave, logged in, throwaway deck NI5kZZpj4Um1X0CjHozDOw, Moxfield
// "Version 2026.11.14.2"), read-only:
// - The Bulk Edit GET (moxfield-edit.bulkEditRead) carries `pricingProvider`; this account's is
//   "cardMarket" (camelCase there, while Moxfield's own registry ids are lowercase: compare
//   case-insensitively). The provider is the TOP affiliate on Settings → Pricing & Affiliates
//   (/account/settings/affiliates, a drag-to-order list, no <select>).
// - Moxfield's bundle has the provider registry: id → { storeName, currency, priceSource } and
//   id → { nonFoil, foil, etched } price keys on the v3 deck JSON's `card.prices` (the table below).
//   Journey's End is the exception: `card.providerPrices.journeysend.{nonFoil,foil}.retail`.
// - The v3 deck JSON (/v3/decks/all/{id}) has every key per card (usd, eur, tix, ck, ct, csi,
//   scg, mp, plus _foil/_etched variants) but NO provider/currency field: for decks the user doesn't
//   own (Bulk Edit GET 403) the provider isn't in anything already fetched, hence the cached value.
// - Moxfield's deck footer ("Cardmarket €1,710.44 (€0.00 unowned)") = Σ quantity × provider price
//   (finish-aware: eur_foil for foils) over mainboard + commanders + SIDEBOARD, basics included,
//   commanders included, even though every deck checked has includeBasicLandsInPrice and
//   includeCommandersInPrice false (fix round 1, 4 decks with/without basics, e.g. main 1545.06
//   [79.05 of it basics] + side 70.56 + commander 94.82 = 1710.44; main 1128.85 + side 197.21 +
//   commander 66.73 = 1392.79; the throwaway's 585.41 + 10.41 = 595.82). So the flags (carried by
//   shapeDeck as `priceFlags`) don't change the total and are ignored here; the builder's whole-deck
//   budget is that total minus the sideboard. The "(… unowned)" figure is the part not in the
//   user's collection. Footer/tooltips use the currency symbol (€ / $; TIX for Cardhoarder).

/** Moxfield provider id → store name, currency, deck-JSON price keys, Scryfall price field. */
export const PROVIDERS = {
  tcgplayer: { store: 'TCGplayer', currency: 'USD', keys: { nonFoil: 'usd', foil: 'usd_foil', etched: 'usd_etched' }, scry: 'usd' },
  cardmarket: { store: 'Cardmarket', currency: 'EUR', keys: { nonFoil: 'eur', foil: 'eur_foil' }, scry: 'eur' },
  cardhoarder: { store: 'Cardhoarder', currency: 'TIX', keys: { nonFoil: 'tix' }, scry: 'tix' },
  cardkingdom: { store: 'Card Kingdom', currency: 'USD', keys: { nonFoil: 'ck', foil: 'ck_foil', etched: 'ck_etched' }, scry: null },
  manapool: { store: 'Mana Pool', currency: 'USD', keys: { nonFoil: 'mp', foil: 'mp_foil', etched: 'mp_etched' }, scry: null },
  starcitygames: { store: 'Star City Games', currency: 'USD', keys: { nonFoil: 'scg', foil: 'scg_foil', etched: 'scg_etched' }, scry: null },
  coolstuffinc: { store: 'CoolStuffInc', currency: 'USD', keys: { nonFoil: 'csi', foil: 'csi_foil' }, scry: null },
  cardtrader: { store: 'CardTrader', currency: 'EUR', keys: { nonFoil: 'ct', foil: 'ct_foil', etched: 'ct_etched' }, scry: null },
  facetoface: { store: 'Face to Face', currency: 'USD', keys: { nonFoil: 'f2f', foil: 'f2f_foil' }, scry: null },
  journeysend: { store: "Journey's End", currency: 'USD', keys: null, scry: null },
};

export const DEFAULT_PROVIDER = 'tcgplayer';

const SYMBOL = { USD: '$', EUR: '€', TIX: 'tix' };

/** "cardMarket" / "CardMarket" / "cardmarket" → "cardmarket"; unknown/empty → null. */
export function normalizeProvider(s) {
  const k = typeof s === 'string' ? s.toLowerCase().replace(/[^a-z]/g, '') : '';
  return Object.prototype.hasOwnProperty.call(PROVIDERS, k) ? k : null;
}

/**
 * Provider (any spelling; unknown → TCGplayer) → the `pricing` the rules/view thread through:
 * { provider, store, currency, symbol, scryField, approx }. Suggestions are priced from Scryfall's
 * `scryField`; `approx` is set when Scryfall doesn't carry this provider, so suggestions fall back
 * to the Scryfall field in the same currency (EUR → eur, else usd) and are labelled approximate.
 */
export function pricingFor(provider) {
  const id = normalizeProvider(provider) || DEFAULT_PROVIDER;
  const p = PROVIDERS[id];
  const scryField = p.scry || (p.currency === 'EUR' ? 'eur' : 'usd');
  return { provider: id, store: p.store, currency: p.currency, symbol: SYMBOL[p.currency], scryField, approx: !p.scry };
}

export const DEFAULT_PRICING = pricingFor(DEFAULT_PROVIDER);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One amount in the pricing's currency: "$1.50", "€1.50", "1.50 tix". Non-number → 'no price'. */
export function formatPrice(n, pricing = DEFAULT_PRICING, { whole = false } = {}) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'no price';
  const digits = whole ? 0 : 2;
  const v = whole ? Math.round(n) : n;
  if (pricing.currency === 'TIX') return `${v.toFixed(digits)} tix`;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: pricing.currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  } catch {
    return `${pricing.symbol}${v.toFixed(digits)}`;
  }
}

/** Tooltip for a suggestion price when it's a Scryfall stand-in for the provider. null otherwise. */
export function approxNote(pricing = DEFAULT_PRICING) {
  return pricing.approx ? `approx. (Scryfall ${pricing.scryField.toUpperCase()}) — ${pricing.store} prices aren't on Scryfall` : null;
}

/**
 * One copy's price for a v3 deck-JSON card in the provider: the finish's key (foil/etched), falling
 * back to the non-foil key; Journey's End reads providerPrices. number|null.
 */
export function deckCardPrice(card, finish, pricing = DEFAULT_PRICING) {
  if (!card) return null;
  const p = PROVIDERS[pricing.provider] || PROVIDERS[DEFAULT_PROVIDER];
  const f = finish === 'foil' || finish === 'etched' ? finish : 'nonFoil';
  if (!p.keys) {
    const pp = card.providerPrices && card.providerPrices[pricing.provider];
    return num(pp && pp[f] && pp[f].retail) ?? num(pp && pp.nonFoil && pp.nonFoil.retail);
  }
  const prices = card.prices || {};
  return num(p.keys[f] && prices[p.keys[f]]) ?? num(prices[p.keys.nonFoil]);
}

/** A Scryfall info entry (shapeCards) → its price for this pricing. number|null. */
export function scryPrice(entry, pricing = DEFAULT_PRICING) {
  return entry ? num(entry[pricing.scryField]) : null;
}

/**
 * Scryfall info + the deck's own per-card prices → the `info` the rules ctx reads, each entry with a
 * provider-aware `price` (number|null). Deck cards (commanders + mainboard, `deckPrices` from
 * shapeDeck: key → price per copy) use Moxfield's price so the budget matches Moxfield's total; a
 * deck card Scryfall doesn't know still gets an entry. Everything else uses the Scryfall field.
 */
export function pricedInfo(info, pricing = DEFAULT_PRICING, deckPrices = null) {
  const out = {};
  for (const [k, v] of Object.entries(info || {})) out[k] = { ...v, price: scryPrice(v, pricing) };
  for (const [k, d] of Object.entries(deckPrices || {})) {
    if (!d) continue;
    const price = num(d.price);
    out[k] = { ...(out[k] || { name: d.name }), price: price ?? (out[k] ? out[k].price : null) };
  }
  return out;
}

/**
 * shapeDeck() result → { frontKey: { name, price } } per copy for commanders + mainboard: basics and
 * commanders always count, as in Moxfield's own total (deck.priceFlags are deliberately ignored,
 * see LIVE-VERIFY above). The sideboard isn't part of the 100, so it's left out.
 */
export function deckPrices(deck, pricing = DEFAULT_PRICING) {
  const out = {};
  for (const b of ['commanders', 'mainboard']) {
    for (const [k, e] of Object.entries((deck && deck.boards && deck.boards[b]) || {})) {
      if (e) out[k] = { name: e.name, price: deckCardPrice({ prices: e.prices, providerPrices: e.providerPrices }, e.finish, pricing) };
    }
  }
  return out;
}

/**
 * Which provider to use: the Bulk Edit GET's `pricingProvider` (owner only) wins, then the last
 * known value (stored), then TCGplayer. → { provider, fromBulk } (fromBulk: worth storing).
 */
export function chooseProvider(bulkJson, stored) {
  const live = normalizeProvider(bulkJson && bulkJson.pricingProvider);
  if (live) return { provider: live, fromBulk: true };
  return { provider: normalizeProvider(stored) || DEFAULT_PROVIDER, fromBulk: false };
}
