import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comboBreakers, dropCombosWith, comboUrl } from '../src/combo-breakers.js';

const combo = (id, names, produces = [], popularity = 0) => ({
  id,
  uses: names.map((name) => ({ card: { name } })),
  produces: produces.map((name) => ({ feature: { name } })),
  popularity,
});

test('comboBreakers: maps every piece of a fully present combo to that combo', () => {
  const results = { included: [combo('1-2', ['Isochron Scepter', 'Dramatic Reversal'], ['Infinite mana'], 50)] };
  const m = comboBreakers(results, ['Isochron Scepter', 'Dramatic Reversal', 'Island']);
  assert.deepEqual([...m.keys()].sort(), ['dramatic reversal', 'isochron scepter']);
  assert.deepEqual(m.get('isochron scepter'), [
    { id: '1-2', pieces: ['Isochron Scepter', 'Dramatic Reversal'], produces: ['Infinite mana'], popularity: 50 },
  ]);
  assert.equal(m.has('island'), false);
});

test('comboBreakers: skips combos with a piece missing from the deck', () => {
  const results = { included: [combo('x', ['A', 'B'])] };
  assert.equal(comboBreakers(results, ['A']).size, 0);
});

test('comboBreakers: matches DFC front faces and case-insensitively', () => {
  const results = { included: [combo('d', ['Delver of Secrets', 'Thing'])] };
  const m = comboBreakers(results, ['Delver of Secrets // Insectile Aberration', 'THING']);
  assert.equal(m.get('delver of secrets').length, 1);
});

test('comboBreakers: commander counts as present (pass it in deckNames)', () => {
  const results = { included: [combo('c', ['Kinnan, Bonder Prodigy', 'Basalt Monolith'])] };
  const m = comboBreakers(results, ['Kinnan, Bonder Prodigy', 'Basalt Monolith']);
  assert.equal(m.get('basalt monolith')[0].id, 'c');
});

test('comboBreakers: sorts a card\'s combos by popularity desc and dedupes ids', () => {
  const results = { included: [combo('lo', ['A', 'B'], [], 1), combo('hi', ['A', 'C'], [], 9), combo('hi', ['A', 'C'], [], 9)] };
  const m = comboBreakers(results, ['A', 'B', 'C']);
  assert.deepEqual(m.get('a').map((c) => c.id), ['hi', 'lo']);
});

test('comboBreakers: fail-silent on bad input', () => {
  assert.equal(comboBreakers(null, ['A']).size, 0);
  assert.equal(comboBreakers({}, null).size, 0);
  assert.equal(comboBreakers({ included: [null, { uses: null }, { id: 'e', uses: [] }] }, ['A']).size, 0);
});

test('dropCombosWith: removing a piece clears the combo from its partners', () => {
  const results = { included: [combo('ab', ['A', 'B']), combo('ac', ['A', 'C']), combo('bc', ['B', 'C'])] };
  const m = dropCombosWith(comboBreakers(results, ['A', 'B', 'C']), 'A');
  assert.equal(m.has('a'), false);
  assert.deepEqual(m.get('b').map((c) => c.id), ['bc']);
  assert.deepEqual(m.get('c').map((c) => c.id), ['bc']);
});

test('dropCombosWith: a partner left with no combos is removed', () => {
  const results = { included: [combo('ab', ['A', 'B'])] };
  const m = dropCombosWith(comboBreakers(results, ['A', 'B']), 'a');
  assert.equal(m.size, 0);
});

test('comboUrl: Commander Spellbook combo page', () => {
  assert.equal(comboUrl('12-34'), 'https://commanderspellbook.com/combo/12-34/');
});

test('backdropDismisses: only a full click on the backdrop after the grace period', async () => {
  const { backdropDismisses, BACKDROP_GRACE_MS } = await import('../src/combo-breakers.js');
  const base = { openedAt: 1000, downOnBackdrop: true, clickOnBackdrop: true };
  assert.equal(BACKDROP_GRACE_MS, 400);
  assert.equal(backdropDismisses({ ...base, now: 1150 }), false); // double-click's 2nd click
  assert.equal(backdropDismisses({ ...base, now: 1399 }), false);
  assert.equal(backdropDismisses({ ...base, now: 1400 }), true);
  assert.equal(backdropDismisses({ ...base, now: 5000, downOnBackdrop: false }), false); // drag out of the dialog
  assert.equal(backdropDismisses({ ...base, now: 5000, clickOnBackdrop: false }), false); // click inside
  assert.equal(backdropDismisses({ ...base, now: 1100, graceMs: 0 }), true);
});
