import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutsViewAction } from '../src/cuts-view.js';

test('cutsViewAction: nothing while the Recommended tab shows', () => {
  assert.equal(cutsViewAction({ active: false, cuts: null, rendered: false }), 'none');
  assert.equal(cutsViewAction({ active: false, cuts: [{}], rendered: false }), 'none');
});

test('cutsViewAction: Cuts opened before the data → loading, then render once it arrives', () => {
  assert.equal(cutsViewAction({ active: true, cuts: null, rendered: false }), 'loading');
  assert.equal(cutsViewAction({ active: true, cuts: [{ name: 'X' }], rendered: false }), 'render');
  assert.equal(cutsViewAction({ active: true, cuts: [{ name: 'X' }], rendered: true }), 'none');
});

test('cutsViewAction: a genuinely empty result renders (the empty-state message), once', () => {
  assert.equal(cutsViewAction({ active: true, cuts: [], rendered: false }), 'render');
  assert.equal(cutsViewAction({ active: true, cuts: [], rendered: true }), 'none');
});
