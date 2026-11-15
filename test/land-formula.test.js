import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shapeCards } from '../src/sources/scryfall.js';
import { classifyCheap, isMdfcLand, splitCards, landTarget, landBasis } from '../src/land-formula.js';

// Real Scryfall /cards/collection data for the article's examples (fetched once with curl).
const info = shapeCards(JSON.parse(readFileSync(new URL('../fixtures/scryfall_land_formula.json', import.meta.url))));
const card = (name) => { const c = info[name.toLowerCase()]; assert.ok(c, `fixture has ${name}`); return c; };
const cls = (name) => classifyCheap(card(name));

test('classifyCheap: the article\'s cheap card draw examples count as draw', () => {
  for (const n of ['Brainstorm', 'Faithless Looting', 'Deadly Dispute', 'Omen of the Sea', 'Growth Spiral',
    'Drannith Stinger', 'Expressive Iteration', 'Manamorphose', 'Ice-Fang Coatl']) assert.equal(cls(n), 'draw', n);
});

test('classifyCheap: the article\'s non-examples are neither draw nor ramp', () => {
  for (const n of ['Augur of Bolas', 'Trail of Crumbs', 'Esper Sentinel', 'Fateful Absence', 'Ledger Shredder',
    'Edgewall Innkeeper', 'Improbable Alliance', 'Ox of Agonas', 'Bloodtithe Harvester', 'Shark Typhoon',
    'Hydroid Krasis', 'Ravenous Squirrel']) assert.equal(cls(n), null, n);
});

test('classifyCheap: the article\'s cheap ramp examples count as ramp', () => {
  for (const n of ['Llanowar Elves', 'Skirk Prospector', 'Springleaf Drum', 'Lotus Cobra', 'Dark Ritual',
    'Sylvan Scrying', 'Wolfwillow Haven', 'Aether Vial', 'Sol Ring']) assert.equal(cls(n), 'ramp', n);
});

test('classifyCheap: ramp non-examples (lore/ability, MDFC, dies, sacrifice) are null; Manamorphose is draw, not ramp', () => {
  for (const n of ['Ranger Class', 'Tangled Florahedron', 'Shambling Ghast', 'Crop Rotation']) assert.equal(cls(n), null, n);
  assert.equal(cls('Manamorphose'), 'draw');
});

test('classifyCheap: lands, land/spell MDFCs (back-face "add " text) and missing data are null', () => {
  assert.equal(cls('Command Tower'), null);
  assert.equal(cls('Malakir Rebirth'), null);
  assert.equal(classifyCheap({ ...card('Dark Ritual'), cmc: null }), null);
  assert.equal(classifyCheap({ cmc: 1 }), null);
  assert.equal(classifyCheap(null), null);
});

test('classifyCheap: cycling for exactly one mana at any MV; {2}, {X}{1}{U} and life costs do not', () => {
  const big = (oracle) => ({ cmc: 6, oracle, frontType: 'Creature — Beast', layout: 'normal' });
  assert.equal(classifyCheap(big('Trample\nCycling {1} ({1}, Discard this card: Draw a card.)')), 'draw');
  assert.equal(classifyCheap(big('Cycling {U} ({U}, Discard this card: Draw a card.)')), 'draw');
  assert.equal(classifyCheap(big('Cycling {2} ({2}, Discard this card: Draw a card.)')), null);
  assert.equal(classifyCheap(big('Cycling {X}{1}{U} ({X}{1}{U}, Discard this card: Draw a card.)')), null);
  assert.equal(classifyCheap(big('Cycling—Pay 2 life. (Pay 2 life, Discard this card: Draw a card.)')), null);
  assert.equal(classifyCheap(big('Swampcycling {2} ({2}, Discard this card: Search your library for a Swamp card.)')), null);
});

test('isMdfcLand: land/spell MDFCs only', () => {
  assert.equal(isMdfcLand(card('Malakir Rebirth')), true);
  assert.equal(isMdfcLand(card('Shatterskull Smashing')), true);
  assert.equal(isMdfcLand(card('Tangled Florahedron')), true);
  assert.equal(isMdfcLand(card('Brainstorm')), false);
  assert.equal(isMdfcLand({ layout: 'modal_dfc', typeLine: 'Instant // Sorcery', frontType: 'Instant' }), false);
  assert.equal(isMdfcLand({ layout: 'modal_dfc', typeLine: 'Land // Land', frontType: 'Land' }), false);
});

test('splitCards: lands out, MDFCs counted as nonland AND partial land, info-less cards use isLand', () => {
  const { nonlands, mdfcs } = splitCards([
    { info: card('Brainstorm'), qty: 1 },
    { info: card('Command Tower'), qty: 1 },
    { info: card('Malakir Rebirth'), qty: 1 },
    { info: null, qty: 10, isLand: true },
    { info: null, qty: 2, isLand: false },
  ]);
  assert.equal(nonlands.length, 3);
  assert.deepEqual(mdfcs, [{ rarity: 'uncommon', qty: 1 }]);
});

test('landTarget: formula, average over cards with cmc only, MDFC credit before one rounding', () => {
  // MVs 1 (Brainstorm, draw), 1 (Dark Ritual, ramp), 4 (no-text filler), unknown (excluded) → avg 2.
  const filler = { cmc: 4, oracle: 'Flying', frontType: 'Creature — Bird', layout: 'normal' };
  const r = landTarget({ nonlands: [card('Brainstorm'), card('Dark Ritual'), filler, { oracle: 'x' }], mdfcs: [] });
  assert.equal(r.avgMv, 2);
  assert.equal(r.cheap, 2);
  assert.ok(Math.abs(r.raw - (31.42 + 3.13 * 2 - 0.28 * 2)) < 1e-9); // 37.12
  assert.equal(r.target, 37);
  const m = landTarget({ nonlands: [card('Brainstorm'), card('Dark Ritual'), filler], mdfcs: [{ rarity: 'mythic' }, { rarity: 'uncommon', qty: 1 }] });
  assert.ok(Math.abs(m.mdfcCredit - 1.12) < 1e-9);
  assert.equal(m.target, 36); // 37.12 − 1.12 = 36.0
  assert.equal(landBasis(r), 'Karsten: 31.42 + 3.13 × 2.00 − 0.28 × 2 = 37.1 → 37');
  assert.equal(landBasis(m), 'Karsten: 31.42 + 3.13 × 2.00 − 0.28 × 2 = 37.1 − 1.12 MDFC → 36');
});

test('landTarget: qty weights; no cmc at all → target null', () => {
  const r = landTarget({ nonlands: [{ ...card('Dark Ritual'), qty: 3 }, { cmc: 4, oracle: '', frontType: 'Sorcery', qty: 1 }] });
  assert.equal(r.avgMv, 7 / 4);
  assert.equal(r.cheap, 3);
  assert.equal(landTarget({ nonlands: [{ oracle: 'x' }] }).target, null);
  assert.equal(landTarget().target, null);
  assert.match(landBasis(landTarget()), /using 36/);
});
