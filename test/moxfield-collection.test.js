import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shapeCollectionPage } from '../src/moxfield-collection.js';

const fx = JSON.parse(readFileSync(new URL('../fixtures/moxfield_collection_page.json', import.meta.url)));

test('shapeCollectionPage keys by lowercased front face, keeps paging', () => {
  const s = shapeCollectionPage(fx);
  assert.deepEqual(s.names, ['abrade', 'abrade', 'ojer axonil, deepest might']);
  assert.equal(s.totalPages, 2);
});
test('shapeCollectionPage tolerates junk', () => {
  assert.deepEqual(shapeCollectionPage(null), { names: [], totalPages: 0 });
  assert.deepEqual(shapeCollectionPage({}), { names: [], totalPages: 0 });
});
