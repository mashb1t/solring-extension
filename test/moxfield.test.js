import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeckId, parseUsername, pageType } from '../src/moxfield.js';

test('parseDeckId extracts public ids, rejects reserved words and other routes', () => {
  assert.equal(parseDeckId('https://moxfield.com/decks/1OeRLCXjAUC9dNmkw3e_7g'), '1OeRLCXjAUC9dNmkw3e_7g');
  assert.equal(parseDeckId('https://www.moxfield.com/decks/abc-123'), 'abc-123');
  assert.equal(parseDeckId('https://moxfield.com/decks/personal'), null);
  assert.equal(parseDeckId('https://moxfield.com/decks/all'), null);
  assert.equal(parseDeckId('https://moxfield.com/users/mashb1t'), null);
  assert.equal(parseDeckId('https://moxfield.com/decks/abc/primer'), null);
});

test('parseDeckId rejects all deck-manager routes (incl. liked/following/private) + lookalikes', () => {
  for (const r of ['liked', 'following', 'private', 'public', 'bookmarks', 'shared']) {
    assert.equal(parseDeckId(`https://moxfield.com/decks/${r}`), null, r);
  }
  // future short all-lowercase manager routes are auto-excluded by the shape heuristic…
  assert.equal(parseDeckId('https://moxfield.com/decks/tokens'), null);
  // …but real long mixed-case deck ids (even all-lowercase 22-char) are still decks.
  assert.equal(parseDeckId('https://moxfield.com/decks/-_dCL0Vx_k6oG_wMGuplrg'), '-_dCL0Vx_k6oG_wMGuplrg');
});

test('parseUsername', () => {
  assert.equal(parseUsername('https://moxfield.com/users/mashb1t'), 'mashb1t');
  assert.equal(parseUsername('https://moxfield.com/decks/abc'), null);
});

test('pageType', () => {
  assert.equal(pageType('https://moxfield.com/decks/abc-123'), 'deck');
  assert.equal(pageType('https://moxfield.com/users/mashb1t'), 'user');
  assert.equal(pageType('https://moxfield.com/decks/personal'), 'personal');
  assert.equal(pageType('https://moxfield.com/decks/personal/Folder%20A'), 'personal');
  assert.equal(pageType('https://moxfield.com/decks/all'), 'personal');
  assert.equal(pageType('https://moxfield.com/decks/liked'), 'personal');
  assert.equal(pageType('https://moxfield.com/decks/following'), 'personal');
  assert.equal(pageType('https://moxfield.com/'), null);
});
