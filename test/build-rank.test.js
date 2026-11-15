import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { themeCards } from '../src/sources/edhrec-build.js';
import { RULES_DEFAULT, makeCtx } from '../src/build-rules.js';
import { keyScore, buildTiers } from '../src/build-rank.js';

const cards = themeCards(JSON.parse(readFileSync(new URL('../fixtures/edhrec_ojer_spellslinger.json', import.meta.url))));
const flags = () => ({ gameChangers: new Set(), extraTurns: new Set(), massLandDenial: new Set() });
const ctxOf = (o = {}) => makeCtx({ rules: RULES_DEFAULT, info: {}, flags: flags(), owned: null, deckNames: [], ...o });
const isLand = (c) => c.list === 'Lands' || c.list === 'Utility Lands';
const byName = Object.fromEntries(cards.map((c) => [c.name, c]));

test('keyScore formula', () => {
  const c = { name: 'Foo', synergy: 0.5, inclusionPct: 40 };
  assert.ok(Math.abs(keyScore(c, {}, new Set()) - (0.3 + 0.1)) < 1e-9);
  assert.ok(Math.abs(keyScore(c, { foo: { gameChanger: true } }, new Set(['foo'])) - 0.55) < 1e-9);
});

test('buildTiers: tiers from fixture', () => {
  const t = buildTiers({ themeCards: cards, combos: [], ctx: ctxOf() });
  assert.ok(t.key.length > 0 && t.key.length <= 15);
  const info = {};
  const scores = t.key.map((s) => keyScore(s, info, new Set()));
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  for (const s of t.key) assert.ok(s.synergy >= 0.15 && !isLand(byName[s.name]));
  for (const s of [...t.key, ...t.theme]) assert.ok(!isLand(byName[s.name]));
  for (const s of t.lands) assert.ok(isLand(byName[s.name]));
  const pcts = t.theme.map((s) => s.inclusionPct);
  assert.deepEqual(pcts, [...pcts].sort((a, b) => b - a));
  assert.equal(t.key.length + t.theme.length, cards.filter((c) => !isLand(c)).length);
  assert.deepEqual(t.combos, []);
});

test('buildTiers: GC beyond cap stays with check.ok false; usd; deck cards excluded', () => {
  const top = buildTiers({ themeCards: cards, combos: [], ctx: ctxOf() }).key[0].name;
  const f = flags(); f.gameChangers.add(top.toLowerCase());
  const ctx = ctxOf({ flags: f, rules: { ...RULES_DEFAULT, bracket: 2 }, info: { [top.toLowerCase()]: { price: 1.5 } } });
  const t = buildTiers({ themeCards: cards, combos: [], ctx });
  const s = t.key.find((x) => x.name === top);
  assert.equal(s.gameChanger, true);
  assert.equal(s.check.ok, false);
  assert.equal(s.price, 1.5);
  const t2 = buildTiers({ themeCards: cards, combos: [], ctx: ctxOf({ deckNames: [top] }) });
  assert.ok(![...t2.key, ...t2.theme, ...t2.lands].some((x) => x.name === top));
});

test('buildTiers: null/empty theme cards -> empty tiers', () => {
  for (const tc of [null, []]) {
    const t = buildTiers({ themeCards: tc, combos: [{ id: 1 }], ctx: ctxOf() });
    assert.deepEqual([t.key, t.theme, t.lands], [[], [], []]);
    assert.deepEqual(t.combos, [{ id: 1 }]);
  }
});

test('buildTiers: keyCount limits key', () => {
  const t = buildTiers({ themeCards: cards, combos: [], ctx: ctxOf(), keyCount: 2 });
  assert.equal(t.key.length, 2);
});

test('buildTiers: land lists go to lands tier by inclusionPct', () => {
  const extra = [
    { name: 'Command Tower', synergy: 0, inclusionPct: 90, list: 'Lands' },
    { name: 'Scalding Tarn', synergy: 0.3, inclusionPct: 95, list: 'Utility Lands' },
  ];
  const t = buildTiers({ themeCards: [...cards, ...extra], combos: [], ctx: ctxOf() });
  assert.deepEqual(t.lands.map((s) => s.name), ['Scalding Tarn', 'Command Tower']);
  assert.ok(![...t.key, ...t.theme].some((s) => extra.some((e) => e.name === s.name)));
});

test('buildTiers: land vs spell by Scryfall typeLine (front face) when known, list header otherwise', () => {
  const themeList = [
    { name: 'Dryad Arbor', synergy: 0.5, inclusionPct: 30, list: 'Creatures' }, // "Land Creature" → land
    { name: 'Emeria\'s Call // Emeria, Shattered Skyclave', synergy: 0.5, inclusionPct: 30, list: 'Lands' }, // MDFC spell front → spell
    { name: 'Command Tower', synergy: 0, inclusionPct: 90, list: 'Lands' }, // no info → header
    { name: 'Sol Ring', synergy: 0.5, inclusionPct: 90, list: 'Artifacts' },
  ];
  const info = {
    'dryad arbor': { typeLine: 'Land Creature — Forest Dryad' },
    "emeria's call": { typeLine: 'Sorcery // Land' },
    'sol ring': { typeLine: 'Artifact' },
  };
  const t = buildTiers({ themeCards: themeList, combos: [], ctx: ctxOf({ info }) });
  assert.deepEqual(t.lands.map((s) => s.name).sort(), ['Command Tower', 'Dryad Arbor']);
  const spellNames = [...t.key, ...t.theme].map((s) => s.name).sort();
  assert.deepEqual(spellNames, ["Emeria's Call // Emeria, Shattered Skyclave", 'Sol Ring']);
});
