import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csRatingGrade, csGradeFromPct, csRatingPct } from '../src/ratings.js';

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
