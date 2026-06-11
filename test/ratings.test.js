import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  csRatingGrade, csGradeFromPct, csRatingPct,
  deckAvgPower, powerMark, saltMark, synergyCutoff, synergyMark,
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

test('deckAvgPower — uses scoring.total when given, else sums cards', () => {
  const cards = { a: { powerTotal: 10 }, b: { powerTotal: 20 }, c: { powerTotal: 0 } };
  assert.equal(deckAvgPower(cards, 789.8), 789.8 / 3);
  assert.equal(deckAvgPower(cards, 0), 30 / 3);   // falsy total → sum fallback (=10)
  assert.equal(deckAvgPower({}, 100), 0);
});

test('powerMark — default 2x avg, and a custom multiple', () => {
  const avg = 10;
  assert.equal(powerMark(20.1, avg), true);     // > 2x default
  assert.equal(powerMark(20, avg), false);      // strictly greater
  assert.equal(powerMark(15.1, avg, 1.5), true); // custom 1.5x
  assert.equal(powerMark(15, avg, 1.5), false);
  assert.equal(powerMark(99, 0), false);        // no average
  assert.equal(powerMark(undefined, avg), false);
});

test('saltMark — default >=5, and a custom threshold', () => {
  assert.equal(saltMark(5), true);
  assert.equal(saltMark(4.9), false);
  assert.equal(saltMark(4, 3.5), true);  // custom cutoff
  assert.equal(saltMark(3, 3.5), false);
  assert.equal(saltMark(undefined), false);
});

test('synergyCutoff — nearest-rank percentile of per-card scores (0s included)', () => {
  // scores: 0,0,0,0,0,0,0, 10, 50, 100 (10 cards; 7 with no synergy)
  const cards = {};
  [0, 0, 0, 0, 0, 0, 0, 10, 50, 100].forEach((s, i) => { cards[i] = { combos: s ? { score: s } : null }; });
  assert.equal(synergyCutoff(cards, 90), 50);   // 90th pct → idx ceil(.9*10)-1 = 8 → 50
  assert.equal(synergyCutoff(cards, 100), 100);  // top only
  assert.equal(synergyCutoff(cards, 0), 0);      // everyone (cutoff = min)
  assert.equal(synergyCutoff({}, 90), Infinity); // no cards → nothing marked
});

test('synergyMark — nonzero score at/above the cutoff', () => {
  assert.equal(synergyMark(50, 50), true);
  assert.equal(synergyMark(49.9, 50), false);
  assert.equal(synergyMark(0, 0), false);          // never mark a 0-synergy card
  assert.equal(synergyMark(10, Infinity), false);  // empty deck cutoff
  assert.equal(synergyMark(undefined, 50), false);
});
