import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  csRatingGrade, csGradeFromPct, csRatingPct,
  saltTier, powerTier, deckAvgPower,
} from '../src/ratings.js';

test('grades from the reference deck (verified against CommanderSalt)', () => {
  assert.equal(csRatingGrade(130.5928, 'saltRating'), 'C+');   // 43.5%
  assert.equal(csRatingGrade(197, 'interactionRating'), 'B–'); // 49.2%
  assert.equal(csRatingGrade(347.8, 'comboRating'), 'A+');     // 100% (capped)
  assert.equal(csRatingGrade(1787.3, 'synergyRating'), 'B+');  // 71.5%
});

test('pct caps at 100 and floors at 0', () => {
  assert.equal(csRatingPct(999, 'comboRating'), 100);
  assert.equal(csRatingPct(0, 'saltRating'), 0);
});

test('ladder boundaries', () => {
  assert.equal(csGradeFromPct(0), 'D–');
  assert.equal(csGradeFromPct(1.99), 'D–');
  assert.equal(csGradeFromPct(100), 'A+');
});

test('saltTier — flat cutoffs, >=5 is the red salty cluster', () => {
  assert.equal(saltTier(8.7), 'a');
  assert.equal(saltTier(5), 'a');
  assert.equal(saltTier(4.9), 'b');
  assert.equal(saltTier(2), 'c');
  assert.equal(saltTier(0.3), 'd');
  assert.equal(saltTier(undefined), null);
});

test('powerTier — red only above 2x the deck average', () => {
  const avg = 10; // 2x = 20
  assert.equal(powerTier(20.1, avg), 'a');
  assert.equal(powerTier(20, avg), null);   // strictly greater
  assert.equal(powerTier(5, avg), null);
  assert.equal(powerTier(50, 0), null);     // no average → no flag
  assert.equal(powerTier(undefined, avg), null);
});

test('deckAvgPower — uses scoring.total when given, else sums cards', () => {
  const cards = { a: { powerTotal: 10 }, b: { powerTotal: 20 }, c: { powerTotal: 0 } };
  assert.equal(deckAvgPower(cards, 789.8), 789.8 / 3);
  assert.equal(deckAvgPower(cards, 0), 30 / 3);   // falsy total → sum fallback (=10)
  assert.equal(deckAvgPower({}, 100), 0);
});
