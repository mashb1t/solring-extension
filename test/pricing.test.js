import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDERS, normalizeProvider, pricingFor, formatPrice, approxNote, deckCardPrice, scryPrice,
  pricedInfo, deckPrices, chooseProvider, DEFAULT_PRICING,
} from '../src/pricing.js';
import { shapeCards } from '../src/sources/scryfall.js';
import { shapeDeck } from '../src/moxfield-edit.js';
import { RULES_DEFAULT, makeCtx, checkCard, ruleUsage } from '../src/build-rules.js';
import { proposeFill } from '../src/autocomplete.js';
import { buildTiers } from '../src/build-rank.js';
import { ruleChips, previewSummary, parseRulesForm, priceText } from '../src/builder-view.js';

const flags = () => ({ gameChangers: new Set(), extraTurns: new Set(), massLandDenial: new Set() });
const EUR = pricingFor('cardMarket');

test('normalizeProvider: any spelling of a known id, unknown → null', () => {
  assert.equal(normalizeProvider('cardMarket'), 'cardmarket');
  assert.equal(normalizeProvider('CardKingdom'), 'cardkingdom');
  assert.equal(normalizeProvider('tcgplayer'), 'tcgplayer');
  assert.equal(normalizeProvider('nope'), null);
  assert.equal(normalizeProvider(null), null);
  assert.equal(normalizeProvider(''), null);
});

test('pricingFor: provider → currency, symbol, Scryfall field, approx', () => {
  assert.deepEqual(pricingFor('tcgplayer'), { provider: 'tcgplayer', store: 'TCGplayer', currency: 'USD', symbol: '$', scryField: 'usd', approx: false });
  assert.deepEqual(EUR, { provider: 'cardmarket', store: 'Cardmarket', currency: 'EUR', symbol: '€', scryField: 'eur', approx: false });
  assert.deepEqual(pricingFor('cardhoarder'), { provider: 'cardhoarder', store: 'Cardhoarder', currency: 'TIX', symbol: 'tix', scryField: 'tix', approx: false });
  const ck = pricingFor('cardKingdom');
  assert.equal(ck.currency, 'USD'); assert.equal(ck.scryField, 'usd'); assert.equal(ck.approx, true);
  const ct = pricingFor('cardtrader');
  assert.equal(ct.currency, 'EUR'); assert.equal(ct.scryField, 'eur'); assert.equal(ct.approx, true);
  assert.equal(pricingFor('unknown').provider, 'tcgplayer');
  assert.deepEqual(DEFAULT_PRICING, pricingFor('tcgplayer'));
  for (const id of Object.keys(PROVIDERS)) assert.ok(['USD', 'EUR', 'TIX'].includes(pricingFor(id).currency), id);
});

test('formatPrice / approxNote', () => {
  assert.equal(formatPrice(1.5, DEFAULT_PRICING), '$1.50');
  assert.equal(formatPrice(1234.5, EUR), '€1,234.50');
  assert.equal(formatPrice(61.4, EUR, { whole: true }), '€61');
  assert.equal(formatPrice(2, pricingFor('cardhoarder')), '2.00 tix');
  assert.equal(formatPrice(null, EUR), 'no price');
  assert.equal(approxNote(EUR), null);
  assert.match(approxNote(pricingFor('cardkingdom')), /^approx\. \(Scryfall USD\)/);
});

test('deckCardPrice: provider key, foil/etched variants with non-foil fallback, Journey\'s End', () => {
  const card = { prices: { usd: 7.69, usd_foil: 4.78, eur: 10.41, eur_foil: 7.63, tix: 1.42, ck: 13.99 }, providerPrices: { journeysend: { nonFoil: { retail: 4.75 }, foil: { retail: 3.9 } } } };
  assert.equal(deckCardPrice(card, 'nonFoil', EUR), 10.41);
  assert.equal(deckCardPrice(card, 'foil', EUR), 7.63);
  assert.equal(deckCardPrice(card, 'etched', EUR), 10.41); // no eur_etched → non-foil
  assert.equal(deckCardPrice(card, 'nonFoil', pricingFor('cardkingdom')), 13.99);
  assert.equal(deckCardPrice(card, 'foil', pricingFor('cardkingdom')), 13.99);
  assert.equal(deckCardPrice(card, 'nonFoil', pricingFor('tcgplayer')), 7.69);
  assert.equal(deckCardPrice(card, 'foil', pricingFor('journeysend')), 3.9);
  assert.equal(deckCardPrice({ prices: { usd: 1 } }, 'nonFoil', pricingFor('cardhoarder')), null);
  assert.equal(deckCardPrice(null, 'nonFoil', EUR), null);
});

test('shapeCards keeps usd/eur/tix; scryPrice reads the pricing field', () => {
  const info = shapeCards({ data: [{ name: 'Sol Ring', prices: { usd: '1.17', eur: '1.02', tix: null } }] });
  assert.equal(info['sol ring'].usd, 1.17);
  assert.equal(info['sol ring'].eur, 1.02);
  assert.equal(info['sol ring'].tix, null);
  assert.equal(scryPrice(info['sol ring'], EUR), 1.02);
  assert.equal(scryPrice(info['sol ring'], pricingFor('cardkingdom')), 1.17); // approx: Scryfall USD
  assert.equal(scryPrice(info['sol ring'], pricingFor('cardhoarder')), null);
});

const deckJson = {
  id: 'e', name: 'T', format: 'commander',
  boards: {
    commanders: { cards: { c: { quantity: 1, finish: 'nonFoil', card: { id: 'c1', name: 'Cmdr', type_line: 'Legendary Creature', prices: { usd: 7.69, eur: 10.41 } } } } },
    mainboard: { cards: {
      a: { quantity: 1, finish: 'foil', isFoil: true, card: { id: 'a1', name: 'Shiny', type_line: 'Artifact', prices: { usd: 3, eur: 2, eur_foil: 5 } } },
      b: { quantity: 2, finish: 'nonFoil', card: { id: 'b1', name: 'Twice', type_line: 'Instant', prices: { usd: 1, eur: 0.5 } } },
      f: { quantity: 3, finish: 'nonFoil', card: { id: 'f1', name: 'Forest', type_line: 'Basic Land — Forest', prices: { usd: 0.2 } } },
    } },
  },
};

test('shapeDeck carries finish + raw prices; deckPrices picks the provider per copy', () => {
  const d = shapeDeck(deckJson);
  assert.equal(d.boards.mainboard.shiny.finish, 'foil');
  assert.equal(d.boards.mainboard.twice.prices.eur, 0.5);
  assert.deepEqual(deckPrices(d, EUR), {
    cmdr: { name: 'Cmdr', price: 10.41 }, shiny: { name: 'Shiny', price: 5 }, twice: { name: 'Twice', price: 0.5 }, forest: { name: 'Forest', price: null },
  });
  assert.equal(deckPrices(d, DEFAULT_PRICING).shiny.price, 3);
});

test('pricedInfo: deck cards use the deck price, others the Scryfall field; unknown stays null', () => {
  const scry = { shiny: { name: 'Shiny', usd: 9, eur: 9 }, other: { name: 'Other', usd: 1, eur: 0.8 }, nop: { name: 'Nop', usd: 1, eur: null } };
  const info = pricedInfo(scry, EUR, deckPrices(shapeDeck(deckJson), EUR));
  assert.equal(info.shiny.price, 5); // Moxfield's foil price, not Scryfall's
  assert.equal(info.cmdr.price, 10.41); // deck card Scryfall didn't return still gets an entry
  assert.equal(info.cmdr.name, 'Cmdr');
  assert.equal(info.other.price, 0.8);
  assert.equal(info.nop.price, null);
  assert.equal(info.forest.price, null); // no eur on the deck JSON: unknown (basics → 0 in the rules)
  assert.equal(scry.other.price, undefined); // input untouched
});

test('budget "used" = mainboard + commanders in the provider currency (Moxfield total)', () => {
  const d = shapeDeck(deckJson);
  const names = [];
  for (const b of ['commanders', 'mainboard']) for (const e of Object.values(d.boards[b])) for (let i = 0; i < e.quantity; i++) names.push(e.name);
  const ctx = makeCtx({ rules: { ...RULES_DEFAULT, budget: 50 }, info: pricedInfo({}, EUR, deckPrices(d, EUR)), pricing: EUR, flags: flags(), owned: null, deckNames: names });
  assert.equal(Math.round(ctx.spent * 100) / 100, 16.41); // 10.41 + 5 + 2×0.5 + 3 basics × 0
  assert.deepEqual(ruleChips(ruleUsage(ctx)).find((c) => c.key === 'budget').text, 'Budget €16 / €50');
});

test('€ budget: over-budget reason, unknown price never free, basics at 0', () => {
  const info = pricedInfo({ spent: { name: 'Spent', eur: 8, usd: 1 }, pricey: { name: 'Pricey', eur: 3, usd: 0.1 }, nop: { name: 'Nop', eur: null, usd: 2 } }, EUR);
  const ctx = makeCtx({ rules: { ...RULES_DEFAULT, budget: 10 }, info, pricing: EUR, flags: flags(), owned: null, deckNames: ['Spent'] });
  assert.deepEqual(checkCard('Pricey', ctx), { ok: false, reason: 'Over budget (€2.00 left)' });
  assert.deepEqual(checkCard('Nop', ctx), { ok: false, reason: 'No price (budget set)' });
  assert.deepEqual(checkCard('Island', ctx), { ok: true });
});

test('€ auto-complete: picks priced in EUR, cost in EUR, € binding reason and preview summary', () => {
  const scry = {};
  const cards = Array.from({ length: 70 }, (_, i) => ({ name: `Spell ${i}`, synergy: 0.3, inclusionPct: 80, list: 'Creatures' }));
  for (const c of cards) scry[c.name.toLowerCase()] = { name: c.name, usd: 100, eur: 2 };
  const ctx = makeCtx({ rules: { ...RULES_DEFAULT, budget: 20 }, info: pricedInfo(scry, EUR), pricing: EUR, flags: flags(), owned: null, deckNames: ['Cmdr'] });
  const r = proposeFill({ tiers: buildTiers({ themeCards: cards, combos: [], ctx, keyCount: 15 }), ctx, colorIdentity: ['G'] });
  const spells = r.picks.filter((p) => p.tier !== 'land');
  assert.equal(spells.length, 10);
  assert.ok(spells.every((p) => p.price === 2));
  assert.equal(r.cost, 20);
  assert.match(r.binding, /^Over budget \(€0\.00 left\)$/);
  const t = { count: 10, deckAfter: 47, landsAfter: 36, gcAfter: 0, spentAfter: 20, cost: 20 };
  assert.match(previewSummary(t, ctx.rules, 3, EUR), / · €20\.00 \/ €20$/);
  assert.match(previewSummary(t, { ...ctx.rules, budget: null }, 3, EUR), /adds €20\.00$/);
});

test('view: priceText and the rules-form error follow the currency', () => {
  assert.equal(priceText(2.5, EUR), '€2.50');
  assert.equal(priceText(2.5), '$2.50');
  assert.equal(parseRulesForm({ bracket: '3', budget: '0' }, EUR).error, 'Budget must be more than €0');
  assert.equal(parseRulesForm({ bracket: '3', budget: '0' }).error, 'Budget must be more than $0');
});

test('chooseProvider: Bulk Edit value wins, then stored, then TCGplayer', () => {
  assert.deepEqual(chooseProvider({ pricingProvider: 'cardMarket' }, 'tcgplayer'), { provider: 'cardmarket', fromBulk: true });
  assert.deepEqual(chooseProvider(null, 'cardmarket'), { provider: 'cardmarket', fromBulk: false });
  assert.deepEqual(chooseProvider({ pricingProvider: 'weird' }, null), { provider: 'tcgplayer', fromBulk: false });
  assert.deepEqual(chooseProvider(null, 'garbage'), { provider: 'tcgplayer', fromBulk: false });
});
