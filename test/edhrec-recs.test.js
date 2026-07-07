import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutRecs } from '../src/sources/edhrec-recs.js';

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
