import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spreadStats } from '../src/power-spread.js';

const item = (md5, power, bracket = 3, title = md5) =>
  ({ md5, title, row: null, view: { power, bracketRealistic: bracket } });

test('null when fewer than 3 decks have numeric power', () => {
  assert.equal(spreadStats([item('a', 5), item('b', null)]), null);
});
test('median/quartiles/min/max over powers', () => {
  const s = spreadStats([item('a', 4), item('b', 6), item('c', 6.4), item('d', 7), item('e', 9)]);
  assert.equal(s.median, 6.4);
  assert.equal(s.min, 4);
  assert.equal(s.max, 9);
  assert.ok(s.q1 <= s.median && s.median <= s.q3);
});
test('binning: power 10 lands in the last bin, not an 11th', () => {
  const s = spreadStats([item('a', 10), item('b', 0), item('c', 9.99)]);
  assert.equal(s.bins.length, 10);
  assert.equal(s.bins[9].count, 2);
  assert.equal(s.bins[0].count, 1);
  assert.deepEqual(s.bins[9].md5s.sort(), ['a', 'c']);
});
test('outliers = |power - median| >= 1.5, with delta', () => {
  const s = spreadStats([item('a', 6), item('b', 6.2), item('c', 6.4), item('d', 8.5)]);
  assert.deepEqual(s.outliers.map((o) => o.md5), ['d']);
  assert.ok(Math.abs(s.outliers[0].delta - (8.5 - s.median)) < 1e-9);
});
test('bracket mix + unanalyzed count', () => {
  const s = spreadStats([item('a', 5, 2), item('b', 6, 3), item('c', 7, 3), item('d', null, null)]);
  assert.equal(s.brackets[3], 2);
  assert.equal(s.unanalyzed, 1);
});
