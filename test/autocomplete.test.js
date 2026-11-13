import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeFill } from '../src/autocomplete.js';
import { RULES_DEFAULT, makeCtx } from '../src/build-rules.js';
import { buildTiers } from '../src/build-rank.js';

const flags = (o = {}) => ({ gameChangers: new Set(), extraTurns: new Set(), massLandDenial: new Set(), ...o });
const mk = (o = {}) => makeCtx({ rules: { ...RULES_DEFAULT }, info: {}, flags: flags(), owned: null, deckNames: ['Cmdr'], ...o });
const spells = (n, o = {}) => Array.from({ length: n }, (_, i) => ({ name: `Spell ${i}`, synergy: 0.3 - i * 0.001, inclusionPct: 90 - (i % 50), list: 'Creatures', ...o }));
const landCards = (n) => Array.from({ length: n }, (_, i) => ({ name: `Land ${i}`, synergy: 0, inclusionPct: 50, list: 'Lands' }));
const tiersOf = (ctx, cards, combos = []) => buildTiers({ themeCards: cards, combos, ctx, keyCount: 15 });
const sum = (r, f = () => true) => r.picks.filter(f).reduce((n, p) => n + p.qty, 0);
const CI = ['W', 'U', 'B', 'R', 'G'];

test('empty deck + commander fills to 100 with 36 lands', () => {
  const ctx = mk();
  const r = proposeFill({ tiers: tiersOf(ctx, [...spells(90), ...landCards(10)]), ctx, colorIdentity: CI });
  assert.equal(sum(r) + 1, 100);
  assert.equal(sum(r, (p) => p.tier === 'land'), 36);
  assert.equal(r.shortfall, 0);
  assert.equal(r.binding, null);
  const basics = r.picks.filter((p) => ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(p.name));
  assert.equal(basics.length, 5);
  assert.equal(basics.reduce((n, p) => n + p.qty, 0), 26);
  assert.ok(basics.every((p) => p.qty >= 5 && p.qty <= 6));
});

test('empty colour identity uses Wastes', () => {
  const ctx = mk();
  const r = proposeFill({ tiers: tiersOf(ctx, spells(90)), ctx, colorIdentity: [] });
  const w = r.picks.find((p) => p.name === 'Wastes');
  assert.equal(w.qty, 36);
});

test('gameChangerCap 1 yields at most 1 GC', () => {
  const rules = { ...RULES_DEFAULT, gameChangerCap: 1 };
  const cards = spells(90);
  const gcs = new Set(cards.slice(0, 10).map((c) => c.name.toLowerCase()));
  const ctx = mk({ rules, flags: flags({ gameChangers: gcs }) });
  const r = proposeFill({ tiers: tiersOf(ctx, cards), ctx, colorIdentity: CI });
  assert.ok(r.picks.filter((p) => gcs.has(p.name.toLowerCase())).length <= 1);
  assert.equal(sum(r) + 1, 100);
});

test('no duplicates when the deck holds a DFC by full name', () => {
  const names = ['Cmdr', 'Delver of Secrets // Insectile Aberration', ...spells(8).map((c) => c.name)];
  const ctx = mk({ deckNames: names });
  const cards = [{ name: 'Delver of Secrets', synergy: 0.5, inclusionPct: 99, list: 'Creatures' }, ...spells(120)];
  const r = proposeFill({ tiers: tiersOf(ctx, cards), ctx, colorIdentity: CI, current: { cards: 10, lands: 0 } });
  const seen = new Set(names.map((n) => n.split(' // ')[0].toLowerCase()));
  for (const p of r.picks.filter((x) => x.tier !== 'land' || x.qty === 1)) {
    const k = p.name.toLowerCase();
    if (['plains', 'island', 'swamp', 'mountain', 'forest'].includes(k)) continue;
    assert.ok(!seen.has(k), `dup ${p.name}`);
    seen.add(k);
  }
  assert.equal(sum(r) + 10, 100);
});

test('budget $20 caps cost, reports shortfall and Over budget binding', () => {
  const cards = spells(90);
  const info = {};
  for (const c of cards) info[c.name.toLowerCase()] = { name: c.name, usd: 2 };
  const ctx = mk({ rules: { ...RULES_DEFAULT, budget: 20 }, info });
  const r = proposeFill({ tiers: tiersOf(ctx, cards), ctx, colorIdentity: CI });
  assert.ok(r.cost <= 20);
  assert.ok(r.shortfall > 0);
  assert.ok(r.binding.startsWith('Over budget'));
  assert.equal(sum(r, (p) => p.tier === 'land'), 36);
});

test('ownedOnly: only owned names plus basics', () => {
  const cards = spells(30);
  const owned = new Set(cards.slice(0, 5).map((c) => c.name.toLowerCase()));
  const ctx = mk({ rules: { ...RULES_DEFAULT, ownedOnly: true }, owned });
  const r = proposeFill({ tiers: tiersOf(ctx, cards), ctx, colorIdentity: CI });
  const nonBasic = r.picks.filter((p) => !['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(p.name));
  assert.equal(nonBasic.length, 5);
  assert.ok(nonBasic.every((p) => owned.has(p.name.toLowerCase())));
  assert.ok(r.shortfall > 0);
  assert.ok(r.binding.startsWith('Not in your collection'));
});

test('combo pieces are taken all-or-nothing and first', () => {
  const ctx = mk();
  const cards = spells(90);
  const combos = [
    { id: 'a', pieces: [], add: ['Combo A1', 'Combo A2'], bracketTag: 'S', popularity: 1 },
    { id: 'b', pieces: [], add: ['Combo B1', 'Spell 3'], bracketTag: 'S', popularity: 1 },
  ];
  const gc = new Set(['combo a2']);
  const c2 = mk({ rules: { ...RULES_DEFAULT, gameChangerCap: 0 }, flags: flags({ gameChangers: gc }) });
  const r = proposeFill({ tiers: tiersOf(c2, cards, combos), ctx: c2, colorIdentity: CI });
  const names = r.picks.map((p) => p.name);
  assert.ok(!names.includes('Combo A1') && !names.includes('Combo A2'));
  assert.deepEqual(names.slice(0, 2), ['Combo B1', 'Spell 3']);
  assert.equal(names.filter((n) => n === 'Spell 3').length, 1);
  void ctx;
});

test('basics use the budget at their info price; absent basics are free', () => {
  const info = { forest: { name: 'Forest', usd: 1 } };
  const ctx = mk({ rules: { ...RULES_DEFAULT, budget: 3 }, info });
  const r = proposeFill({ tiers: tiersOf(ctx, []), ctx, colorIdentity: ['G'], current: { cards: 1, lands: 0 } });
  assert.equal(r.picks.find((p) => p.name === 'Forest').qty, 3);
  assert.equal(r.cost, 3);
});

test('over-target non-lands: land slots shrink so the deck never exceeds size', () => {
  const ctx = mk();
  // 70 non-lands + 20 lands = 90 cards: only 10 slots left, all of them lands.
  const r = proposeFill({ tiers: tiersOf(ctx, [...spells(90), ...landCards(10)]), ctx, colorIdentity: CI, current: { cards: 90, lands: 20 } });
  assert.equal(sum(r), 10);
  assert.equal(sum(r, (p) => p.tier === 'land'), 10);
  assert.equal(r.shortfall, 0);
});

test('over-target lands: non-land slots shrink so the deck never exceeds size', () => {
  const ctx = mk();
  // 50 lands + 40 non-lands = 90 cards: 10 slots left, none of them lands.
  const r = proposeFill({ tiers: tiersOf(ctx, [...spells(90), ...landCards(10)]), ctx, colorIdentity: CI, current: { cards: 90, lands: 50 } });
  assert.equal(sum(r), 10);
  assert.equal(sum(r, (p) => p.tier === 'land'), 0);
  assert.equal(r.shortfall, 0);
});

test('deck already over size: nothing proposed, shortfall never negative', () => {
  const ctx = mk();
  const r = proposeFill({ tiers: tiersOf(ctx, [...spells(90), ...landCards(10)]), ctx, colorIdentity: CI, current: { cards: 105, lands: 20 } });
  assert.equal(r.total, 0);
  assert.equal(r.shortfall, 0);
});
