import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearMissCombos } from '../src/sources/spellbook.js';

const combo = (id, useNames, produces, popularity, opts = {}) => ({
  id,
  uses: useNames.map((name) => ({ card: { name } })),
  produces: produces.map((name) => ({ feature: { name } })),
  popularity,
  bracketTag: opts.bracketTag || 'C',
  easyPrerequisites: opts.easy || '',
  notablePrerequisites: opts.notable || '',
  description: opts.description || '',
});

test('nearMissCombos: keeps combos one card short, marks the missing piece', () => {
  const results = { almostIncluded: [
    combo('a', ['Isochron Scepter', 'Dramatic Reversal'], ['Infinite mana'], 100),
  ] };
  const out = nearMissCombos(results, ['Isochron Scepter', 'Island']);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].pieces, [
    { name: 'Isochron Scepter', missing: false },
    { name: 'Dramatic Reversal', missing: true },
  ]);
  assert.equal(out[0].add, 'Dramatic Reversal');
  assert.deepEqual(out[0].produces, ['Infinite mana']);
  assert.equal(out[0].bracketTag, 'C');
});

test('nearMissCombos: drops combos missing two or more cards (not "one away")', () => {
  const results = { almostIncluded: [
    combo('b', ['Card A', 'Card B', 'Card C'], ['Win'], 50),
  ] };
  assert.equal(nearMissCombos(results, ['Card A']).length, 0);
});

test('nearMissCombos: matches DFC pieces by front face (deck holds "A // B")', () => {
  const results = { almostIncluded: [
    combo('c', ['Delver of Secrets', 'Missing Piece'], ['Value'], 10),
  ] };
  const out = nearMissCombos(results, ['Delver of Secrets // Insectile Aberration']);
  assert.equal(out.length, 1);
  assert.equal(out[0].add, 'Missing Piece');
  assert.equal(out[0].pieces.find((p) => p.name === 'Delver of Secrets').missing, false);
});

test('nearMissCombos: extracts prerequisites (easy + notable) and steps (description lines)', () => {
  const results = { almostIncluded: [
    combo('d', ['Have', 'Add'], ['x'], 5, {
      easy: 'Easy one',
      notable: 'Notable A\nNotable B',
      description: 'Step 1.\nStep 2.',
    }),
  ] };
  const out = nearMissCombos(results, ['Have']);
  assert.deepEqual(out[0].prerequisites, ['Easy one', 'Notable A', 'Notable B']);
  assert.deepEqual(out[0].steps, ['Step 1.', 'Step 2.']);
});

test('nearMissCombos: sorts by popularity desc and caps', () => {
  const results = { almostIncluded: [
    combo('lo', ['Have', 'AddLo'], ['x'], 5),
    combo('hi', ['Have', 'AddHi'], ['x'], 999),
  ] };
  const out = nearMissCombos(results, ['Have'], 1);
  assert.equal(out.length, 1);
  assert.equal(out[0].add, 'AddHi');
});

test('nearMissCombos: empty/absent results → []', () => {
  assert.deepEqual(nearMissCombos(null, ['x']), []);
  assert.deepEqual(nearMissCombos({}, ['x']), []);
  assert.deepEqual(nearMissCombos({ almostIncluded: [] }, ['x']), []);
});
