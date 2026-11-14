import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editBulkText, countsAgree, unmatchedRemovals } from '../src/moxfield-ui.js';

const BULK = [
  '1 Sol Ring (CMM) 400',
  '8 Forest',
  '1 Ojer Axonil, Deepest Might // Temple of Power',
  '1 Cultivate (M21) 177 *F*',
  '1 Command Tower',
].join('\n');

const lines = (t) => t.split('\n');

test('editBulkText: removes a set-annotated line by front-face name, case-insensitive', () => {
  const out = editBulkText(BULK, { add: [], remove: ['sol ring'] });
  assert.ok(!lines(out).includes('1 Sol Ring (CMM) 400'));
  assert.equal(lines(out).length, 4);
});

test('editBulkText: appends a new card at the end', () => {
  const out = editBulkText(BULK, { add: [{ name: 'Howling Mine', qty: 1 }], remove: [] });
  assert.equal(lines(out).at(-1), '1 Howling Mine');
});

test('editBulkText: bumps the quantity of an existing line', () => {
  const out = editBulkText(BULK, { add: [{ name: 'Forest', qty: 3 }], remove: [] });
  assert.ok(lines(out).includes('11 Forest'));
  assert.ok(!lines(out).includes('8 Forest'));
  assert.equal(lines(out).length, 5);
});

test('editBulkText: DFC line matched by its front face', () => {
  const out = editBulkText(BULK, { add: [], remove: ['ojer axonil, deepest might'] });
  assert.ok(!out.includes('Ojer Axonil'));
});

test('editBulkText: untouched lines stay byte-for-byte identical', () => {
  const out = editBulkText(BULK, {
    add: [{ name: 'Forest', qty: 3 }, { name: 'Howling Mine', qty: 1 }],
    remove: ['sol ring', 'ojer axonil, deepest might'],
  });
  assert.deepEqual(lines(out), ['11 Forest', '1 Cultivate (M21) 177 *F*', '1 Command Tower', '1 Howling Mine']);
});

test('editBulkText: bump keeps set code / foil suffix of the existing line', () => {
  const out = editBulkText(BULK, { add: [{ name: 'cultivate', qty: 1 }], remove: [] });
  assert.ok(lines(out).includes('2 Cultivate (M21) 177 *F*'));
});

test('editBulkText: empty text and empty edits', () => {
  assert.equal(editBulkText('', { add: [{ name: 'Sol Ring', qty: 1 }], remove: [] }), '1 Sol Ring');
  assert.equal(editBulkText(BULK, { add: [], remove: [] }), BULK);
  assert.equal(editBulkText(BULK, {}), BULK);
});

test('editBulkText: blank / header lines are preserved, CRLF tolerated', () => {
  const t = '1 Sol Ring\r\n\r\n1 Command Tower\r\n';
  const out = editBulkText(t, { add: [], remove: ['command tower'] });
  assert.equal(out, '1 Sol Ring\r\n\r\n');
});

test('countsAgree: fails closed when no count source is available', () => {
  assert.equal(countsAgree({ parsed: 60, label: null, view: null }), false);
  assert.equal(countsAgree({ parsed: 0, label: null, view: null }), false);
});

test('countsAgree: an empty textarea against a non-empty deck is refused', () => {
  assert.equal(countsAgree({ parsed: 0, label: null, view: { main: 60, total: 61 } }), false);
  assert.equal(countsAgree({ parsed: 0, label: 0, view: { main: 60, total: 61 } }), false);
  assert.equal(countsAgree({ parsed: 0, label: 60, view: null }), false);
});

test('countsAgree: matching counts pass; any mismatching source fails', () => {
  assert.equal(countsAgree({ parsed: 60, label: 60, view: { main: 60, total: 61 } }), true);
  assert.equal(countsAgree({ parsed: 60, label: 60, view: null }), true);
  assert.equal(countsAgree({ parsed: 61, label: null, view: { main: 60, total: 61 } }), true); // summary counts commanders
  assert.equal(countsAgree({ parsed: 59, label: 60, view: null }), false);
  assert.equal(countsAgree({ parsed: 60, label: 60, view: { main: 58, total: 59 } }), false);
  // A genuinely empty mainboard (commander only) still works.
  assert.equal(countsAgree({ parsed: 0, label: 0, view: null }), true);
  assert.equal(countsAgree({ parsed: 0, label: 0, view: { main: 0, total: 1 } }), true);
});

test('unmatchedRemovals: names with no card line in the bulk text (front face, case-insensitive)', () => {
  assert.deepEqual(unmatchedRemovals(BULK, ['sol ring', 'Ojer Axonil, Deepest Might', 'Rhystic Study']), ['Rhystic Study']);
  assert.deepEqual(unmatchedRemovals(BULK, ['Forest']), []);
  assert.deepEqual(unmatchedRemovals(BULK, []), []);
  assert.deepEqual(unmatchedRemovals('', ['Forest']), ['Forest']);
});
