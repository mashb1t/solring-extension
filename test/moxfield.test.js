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
  assert.equal(pageType('https://moxfield.com/'), null);
});
