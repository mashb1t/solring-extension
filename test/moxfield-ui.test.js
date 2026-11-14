import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  editBulkText, countsAgree, unmatchedRemovals, bulkEditBody, bulkEditOutcome, deckBoardCount, bulkCount, deckSyncMessage,
} from '../src/moxfield-ui.js';

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

test('countsAgree: fails closed when the deck count is unknown', () => {
  assert.equal(countsAgree({ parsed: 60, expected: null }), false);
  assert.equal(countsAgree({ parsed: 0, expected: undefined }), false);
  assert.equal(countsAgree({ parsed: 60, expected: NaN }), false);
  assert.equal(countsAgree({ parsed: null, expected: 60 }), false);
});

test('countsAgree: an empty bulk text against a non-empty deck is refused', () => {
  assert.equal(countsAgree({ parsed: 0, expected: 60 }), false);
});

test('countsAgree: only an exact match passes (incl. a genuinely empty mainboard)', () => {
  assert.equal(countsAgree({ parsed: 60, expected: 60 }), true);
  assert.equal(countsAgree({ parsed: 59, expected: 60 }), false);
  assert.equal(countsAgree({ parsed: 0, expected: 0 }), true);
});

test('bulkCount: sums quantities over card lines only', () => {
  assert.equal(bulkCount(BULK), 12);
  assert.equal(bulkCount(''), 0);
  assert.equal(bulkCount('2 Island\r\n\r\n// comment\n1 Sol Ring'), 3);
});

test('deckBoardCount: sums a raw v3 board\'s quantities; null when the shape is unknown', () => {
  const deck = { boards: { mainboard: { count: 3, cards: { a: { quantity: 2, card: { name: 'Island' } }, b: { quantity: 1, card: { name: 'Sol Ring' } } } }, sideboard: { count: 0, cards: {} } } };
  assert.equal(deckBoardCount(deck, 'mainboard'), 3);
  assert.equal(deckBoardCount(deck, 'sideboard'), 0);
  assert.equal(deckBoardCount(deck, 'maybeboard'), null);
  assert.equal(deckBoardCount(null, 'mainboard'), null);
  assert.equal(deckBoardCount({ boards: { mainboard: { cards: { a: { quantity: 'x' } } } } }, 'mainboard'), null);
});

// LIVE-VERIFY 2026-11-14: GET /v2/decks/{id}/bulk-edit response (throwaway deck).
const BULK_GET = {
  boards: {
    mainboard: '1 Loran of the Third Path (BLC) 143\n1 Mind Over Matter (EXO) 40',
    sideboard: '1 Swords to Plowshares (STA) 10', maybeboard: '1 Rhystic Study', companions: '', attractions: '',
    stickers: '', contraptions: '', planes: '', schemes: '', tokens: '',
  },
  pricingProvider: 'cardMarket', allowMultiplePrintings: false, usePrefPrintings: false, ignoreFlavorNames: false,
};

test('bulkEditBody: replaces only the mainboard; every other board passes through byte-identical', () => {
  const body = bulkEditBody(BULK_GET, '1 Island');
  assert.equal(body.boards.mainboard, '1 Island');
  for (const k of Object.keys(BULK_GET.boards)) if (k !== 'mainboard') assert.equal(body.boards[k], BULK_GET.boards[k], k);
  assert.deepEqual(Object.keys(body.boards).sort(), Object.keys(BULK_GET.boards).sort());
  assert.equal(body.pricingProvider, 'cardMarket');
  // Moxfield's own Save sends these as true regardless of the GET's echo.
  assert.equal(body.usePrefPrintings, true);
  assert.equal(body.ignoreFlavorNames, true);
  assert.equal(body.allowMultiplePrintings, true);
  assert.equal(BULK_GET.boards.mainboard.startsWith('1 Loran'), true); // input not mutated
});

test('bulkEditBody: null when the GET shape is not the known one (never builds boards from scratch)', () => {
  assert.equal(bulkEditBody(null, 'x'), null);
  assert.equal(bulkEditBody({}, 'x'), null);
  assert.equal(bulkEditBody({ boards: { sideboard: '' } }, 'x'), null); // no mainboard text
  assert.equal(bulkEditBody({ boards: { mainboard: '', sideboard: 5 } }, 'x'), null); // non-string board
  assert.equal(bulkEditBody(BULK_GET, null), null);
});

test('bulkEditOutcome: 200 + isSuccessful → ok', () => {
  assert.deepEqual(bulkEditOutcome({ ok: true, status: 200, json: { isSuccessful: true, errors: { boards: { mainboard: [] } } } }), { ok: true });
});

test('bulkEditOutcome: 200 + isSuccessful:false with line errors → rejected with Moxfield\'s message', () => {
  // LIVE-VERIFY 2026-11-14: an unknown card name is HTTP 200, not a 4xx.
  const json = {
    isSuccessful: false,
    errors: { boards: { mainboard: [{ lineNumber: 6, errorMessage: 'Could not find card "Notarealcardname".', originalText: '1 Notarealcardname' }], sideboard: [] } },
  };
  assert.deepEqual(bulkEditOutcome({ ok: true, status: 200, json }), {
    ok: false, reason: 'rejected', message: 'Line 6 of mainboard: Could not find card "Notarealcardname". (1 Notarealcardname)',
  });
  const two = { isSuccessful: false, errors: { boards: { mainboard: [{ lineNumber: 1, errorMessage: 'A.' }], sideboard: [{ lineNumber: 2, errorMessage: 'B.', originalText: '1 B' }] } } };
  assert.equal(bulkEditOutcome({ ok: true, status: 200, json: two }).message, 'Line 1 of mainboard: A.; Line 2 of sideboard: B. (1 B)');
});

test('bulkEditOutcome: 401/403 → not-editable', () => {
  assert.deepEqual(bulkEditOutcome({ ok: false, status: 401, json: null }), { ok: false, reason: 'not-editable' });
  assert.deepEqual(bulkEditOutcome({ ok: false, status: 403, json: { message: 'nope' } }), { ok: false, reason: 'not-editable' });
});

test('bulkEditOutcome: a 4xx carrying line errors is still rejected', () => {
  const json = { isSuccessful: false, errors: { boards: { mainboard: [{ lineNumber: 3, errorMessage: 'Bad.' }] } } };
  assert.equal(bulkEditOutcome({ ok: false, status: 400, json }).reason, 'rejected');
});

test('bulkEditOutcome: anything else → ui-changed', () => {
  const UI = { ok: false, reason: 'ui-changed' };
  assert.deepEqual(bulkEditOutcome(null), UI); // network error / no token
  assert.deepEqual(bulkEditOutcome({ ok: false, status: 0, json: null }), UI);
  assert.deepEqual(bulkEditOutcome({ ok: false, status: 500, json: null }), UI);
  assert.deepEqual(bulkEditOutcome({ ok: false, status: 404, json: null }), UI);
  assert.deepEqual(bulkEditOutcome({ ok: true, status: 200, json: null }), UI); // non-JSON
  assert.deepEqual(bulkEditOutcome({ ok: true, status: 200, json: {} }), UI); // no isSuccessful
  assert.deepEqual(bulkEditOutcome({ ok: true, status: 200, json: { isSuccessful: false, errors: { boards: { mainboard: [] } } } }), UI); // failed, no reason
  assert.deepEqual(bulkEditOutcome({ ok: false, status: 400, json: { title: 'Bad Request' } }), UI);
});

test('deckSyncMessage: Moxfield\'s cross-tab "deck changed, refetch" message', () => {
  assert.deepEqual(deckSyncMessage({ publicId: 'NI5kZZpj4Um1X0CjHozDOw', ownerUserId: 'owK3W', prevVersion: 67, version: 68 }), {
    channel: 'moxfield-sync-owK3W',
    message: { v: 1, kind: 'deck', publicId: 'NI5kZZpj4Um1X0CjHozDOw', prevVersion: 67, version: 68, isTruncated: true },
  });
  assert.equal(deckSyncMessage({ publicId: 'x', ownerUserId: null, prevVersion: 1, version: 2 }), null);
  assert.equal(deckSyncMessage({ publicId: 'x', ownerUserId: 'u', prevVersion: 1, version: undefined }), null);
});

test('unmatchedRemovals: names with no card line in the bulk text (front face, case-insensitive)', () => {
  assert.deepEqual(unmatchedRemovals(BULK, ['sol ring', 'Ojer Axonil, Deepest Might', 'Rhystic Study']), ['Rhystic Study']);
  assert.deepEqual(unmatchedRemovals(BULK, ['Forest']), []);
  assert.deepEqual(unmatchedRemovals(BULK, []), []);
  assert.deepEqual(unmatchedRemovals('', ['Forest']), ['Forest']);
});
