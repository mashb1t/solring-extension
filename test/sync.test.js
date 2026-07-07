import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDelay } from '../src/sync.js';

test('nextDelay doubles on error, caps at the ceiling, resets on success', () => {
  assert.equal(nextDelay(400, false), 800); // first error → 2× base
  assert.equal(nextDelay(800, false), 1600);
  assert.equal(nextDelay(20000, false), 30000); // 40000 clamped to the 30s ceiling
  assert.equal(nextDelay(30000, false), 30000); // stays at the ceiling
  assert.equal(nextDelay(6400, true), 400); // any success snaps back to base
});
