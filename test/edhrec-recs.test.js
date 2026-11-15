import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutRecs, positiveCuts } from '../src/sources/edhrec-recs.js';

test('cutRecs: shapes outRecs, sorts by score desc, caps', () => {
  const json = { outRecs: [
    { name: 'Low', score: 12, salt: 0.2 },
    { name: 'High', score: 88, salt: 0.3 },
    { name: 'Mid', score: 55, salt: 0.4 },
  ] };
  const out = cutRecs(json, 2);
  assert.deepEqual(out, [{ name: 'High', score: 88 }, { name: 'Mid', score: 55 }]);
});

test('cutRecs: drops entries without a name; missing/empty → []', () => {
  assert.deepEqual(cutRecs({ outRecs: [{ score: 5 }, null, { name: 'Keep', score: 1 }] }), [{ name: 'Keep', score: 1 }]);
  assert.deepEqual(cutRecs(null), []);
  assert.deepEqual(cutRecs({}), []);
});

test('positiveCuts: on drops scores ≤ 0 and missing scores; off keeps everything', () => {
  const cuts = [{ name: 'A', score: 3 }, { name: 'B', score: 0 }, { name: 'C', score: -2 }, { name: 'D', score: null }, { name: 'E' }, { name: 'F', score: 0.5 }];
  assert.deepEqual(positiveCuts(cuts, true).map((c) => c.name), ['A', 'F']);
  assert.deepEqual(positiveCuts(cuts).map((c) => c.name), ['A', 'F']); // default on
  assert.equal(positiveCuts(cuts, false), cuts);
  assert.equal(positiveCuts(cuts, true)[0], cuts[0]); // same objects (callers mutate quantity)
  assert.deepEqual(positiveCuts(null, true), []);
  assert.deepEqual(positiveCuts(null, false), []);
});
