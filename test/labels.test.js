import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prettifyTag } from '../src/labels.js';

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
