import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearMissCombos, spellbookComboUrl, keyCombos } from '../src/sources/spellbook.js';

const combo = (id, useNames, produces, popularity, opts = {}) => ({
  id,
  uses: useNames.map((name) => ({ card: { name, imageUriFrontNormal: `img:${name}` } })),
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
    { name: 'Isochron Scepter', image: 'img:Isochron Scepter', missing: false },
    { name: 'Dramatic Reversal', image: 'img:Dramatic Reversal', missing: true },
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

test('keyCombos: 1-2 missing, bracket-filtered, popularity desc, capped', () => {
  const results = { almostIncluded: [
    combo('one', ['A', 'B'], [], 10, { bracketTag: 'C' }),
    combo('two', ['A', 'X', 'Y'], [], 50, { bracketTag: 'S' }),
    combo('three', ['X', 'Y', 'Z'], [], 99, { bracketTag: 'C' }),
    combo('ruthless', ['A', 'Q'], [], 90, { bracketTag: 'R' }),
    combo('p4', ['A', 'P'], [], 5, { bracketTag: 'C' }),
    combo('p5', ['A', 'P2'], [], 4, { bracketTag: 'C' }),
  ] };
  const out = keyCombos(results, ['A', 'Island'], 3, 3);
  assert.deepEqual(out.map((c) => c.id), ['two', 'one', 'p4']);
  assert.deepEqual(out[1].pieces, [{ name: 'A', image: 'img:A', missing: false }, { name: 'B', image: 'img:B', missing: true }]);
  assert.deepEqual(out[1].produces, []);
  assert.deepEqual(out[0].add, ['X', 'Y']);
  assert.equal(out[0].bracketTag, 'S');
  assert.equal(out[0].popularity, 50);
  assert.ok(!keyCombos(results, ['A'], 3).some((c) => c.id === 'ruthless'));
  assert.ok(keyCombos(results, ['A'], 4, 10).some((c) => c.id === 'ruthless'));
  assert.deepEqual(keyCombos(null, [], 3), []);
});

test('keyCombos: keeps produces names', () => {
  const results = { almostIncluded: [combo('u', ['A', 'B'], ['Infinite untaps', 'Infinite mana'], 1, { bracketTag: 'C' })] };
  assert.deepEqual(keyCombos(results, ['A'], 3)[0].produces, ['Infinite untaps', 'Infinite mana']);
});

test('spellbookComboUrl: the public combo page, null without an id', () => {
  assert.equal(spellbookComboUrl('123-456'), 'https://commanderspellbook.com/combo/123-456/');
  assert.equal(spellbookComboUrl(''), null);
  assert.equal(spellbookComboUrl(null), null);
});
