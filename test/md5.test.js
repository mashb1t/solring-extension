import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md5Hex, deckMd5, canonicalDeckUrl } from '../src/md5.js';

test('md5Hex matches known vectors', () => {
  assert.equal(md5Hex(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(md5Hex('The quick brown fox jumps over the lazy dog'),
    '9e107d9d372bb6826bd81d3542a419d6');
});

test('deckMd5 of canonical Moxfield URL matches the CommanderSalt deck id', () => {
  assert.equal(
    deckMd5('https://moxfield.com/decks/1OeRLCXjAUC9dNmkw3e_7g'),
    '9bc8a6c2106583c1fd66e0492a3a5a26'
  );
});

test('canonicalDeckUrl normalizes a public id', () => {
  assert.equal(
    canonicalDeckUrl('1OeRLCXjAUC9dNmkw3e_7g'),
    'https://moxfield.com/decks/1OeRLCXjAUC9dNmkw3e_7g'
  );
});
