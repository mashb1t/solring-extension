import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearMissCombos } from '../src/sources/spellbook.js';

const combo = (id, useNames, produces, popularity, bracketTag = 'C') => ({
  id,
  uses: useNames.map((name) => ({ card: { name } })),
  produces: produces.map((name) => ({ feature: { name } })),
  popularity,
  bracketTag,
});

test('nearMissCombos: keeps combos exactly one card short, names the card to add', () => {
  const results = { almostIncluded: [
    combo('a', ['Isochron Scepter', 'Dramatic Reversal'], ['Infinite mana'], 100),
  ] };
  const deck = ['Isochron Scepter', 'Island'];
  const out = nearMissCombos(results, deck);
  assert.equal(out.length, 1);
  assert.equal(out[0].add, 'Dramatic Reversal');
  assert.deepEqual(out[0].produces, ['Infinite mana']);
  assert.equal(out[0].bracketTag, 'C');
});

test('nearMissCombos: drops combos missing two or more cards (not "one away")', () => {
  const results = { almostIncluded: [
    combo('b', ['Card A', 'Card B', 'Card C'], ['Win'], 50), // deck has only A → 2 missing
  ] };
  assert.equal(nearMissCombos(results, ['Card A']).length, 0);
});

test('nearMissCombos: matches DFC pieces by front face (deck holds "A // B")', () => {
  const results = { almostIncluded: [
    combo('c', ['Delver of Secrets', 'Missing Piece'], ['Value'], 10),
  ] };
  // deck lists the DFC by its full name; the combo lists the front face
  const out = nearMissCombos(results, ['Delver of Secrets // Insectile Aberration']);
  assert.equal(out.length, 1);
  assert.equal(out[0].add, 'Missing Piece');
});

test('nearMissCombos: sorts by popularity desc and caps', () => {
  const results = { almostIncluded: [
    combo('lo', ['Have', 'AddLo'], ['x'], 5),
    combo('hi', ['Have', 'AddHi'], ['x'], 999),
  ] };
  const out = nearMissCombos(results, ['Have'], 1);
  assert.equal(out.length, 1);
  assert.equal(out[0].add, 'AddHi'); // most popular first, capped to 1
});

test('nearMissCombos: empty/absent results → []', () => {
  assert.deepEqual(nearMissCombos(null, ['x']), []);
  assert.deepEqual(nearMissCombos({}, ['x']), []);
  assert.deepEqual(nearMissCombos({ almostIncluded: [] }, ['x']), []);
});
