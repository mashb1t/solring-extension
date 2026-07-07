import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prettifyTag, humanizeId, humanizeLabel, humanizeValueMaybe } from '../src/labels.js';

test('prettifies known CommanderSalt stat flags', () => {
  assert.equal(prettifyTag('multipliers'), 'multiplier');
  assert.equal(prettifyTag('fastmana'), 'fast mana');
  assert.equal(prettifyTag('boardWipes'), 'boardwipe');
  assert.equal(prettifyTag('costReduction'), 'cost↓');
  assert.equal(prettifyTag('plusOnePlusOneCounters'), '+1/+1 counters');
  assert.equal(prettifyTag('spotRemoval'), 'removal');
});

test('passes through flags with no special label', () => {
  assert.equal(prettifyTag('burn'), 'burn');
  assert.equal(prettifyTag('stax'), 'stax');
  assert.equal(prettifyTag('tokens'), 'tokens');
});

test('humanizeId: compound map, all-caps token, and camelCase', () => {
  assert.equal(humanizeId('PLUSONEPLUSONECOUNTERS'), '+1/+1 Counters'); // all-caps compound → map
  assert.equal(humanizeId('MIDRANGE'), 'Midrange');                     // all-caps single → title-case
  assert.equal(humanizeId('COMBO'), 'Combo');
  assert.equal(humanizeId('winconInconsistency'), 'Wincon inconsistency'); // camelCase split
  assert.equal(humanizeId('pipCoverageHigh'), 'Pip coverage high');
});

test('humanizeLabel humanizes each " / "-joined archetype token', () => {
  assert.equal(humanizeLabel('MIDRANGE / PLUSONEPLUSONECOUNTERS'), 'Midrange / +1/+1 Counters');
  assert.equal(humanizeLabel('MIDRANGE / COMBO'), 'Midrange / Combo');
});

test('humanizeValueMaybe only rewrites identifier-shaped values', () => {
  assert.equal(humanizeValueMaybe('winconInconsistency'), 'wincon inconsistency');
  assert.equal(humanizeValueMaybe('none'), 'none'); // no capital → untouched
  assert.equal(humanizeValueMaybe(3), 3); // non-string → untouched
});
