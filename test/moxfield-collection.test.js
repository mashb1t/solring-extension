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

test('authedGet refuses non-api2.moxfield.com URLs without fetching', async () => {
  globalThis.window = { addEventListener() {} };
  let called = 0;
  globalThis.fetch = async () => { called++; return { ok: true, json: async () => ({}) }; };
  const { authedGet } = await import('../src/moxfield-edit.js');
  for (const u of ['https://evil.example/x', 'http://api2.moxfield.com/x', 'https://api2.moxfield.com.evil.com/x', null])
    assert.equal(await authedGet(u), null);
  assert.equal(called, 0);
});
