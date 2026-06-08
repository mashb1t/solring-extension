import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractDeck, extractHit, isStub } from '../src/extract.js';

const deck = JSON.parse(readFileSync(new URL('../fixtures/deck_ojer.json', import.meta.url)));
const search = JSON.parse(readFileSync(new URL('../fixtures/search_mashb1t.json', import.meta.url)));

test('extractDeck pulls the displayed metrics', () => {
  const d = extractDeck(deck);
  assert.equal(d.deckId, '9bc8a6c2106583c1fd66e0492a3a5a26');
  assert.equal(Math.round(d.power * 10) / 10, 5.9);
  assert.equal(d.bracketRealistic, 3); // csBracket
  assert.equal(d.commanderTier, 4); // T4
  assert.equal(d.threat, 394.9);
  assert.equal(d.interaction, 197);
  assert.equal(d.wincons, 347.8); // comboRating
  assert.equal(d.synergy, 1787.3);
  assert.equal(d.salt, 130.5928003116271);
  assert.equal(d.archetype, 'MIDRANGE / COMBO');
  assert.equal(d.commander, 'Ojer Axonil, Deepest Might // Temple of Power');
});

test('extractDeck drops deck value and baseline bracket on purpose', () => {
  const d = extractDeck(deck);
  assert.equal(d.value, undefined);
  assert.equal(d.bracketBaseline, undefined);
});

test('extractDeck builds a per-card map (salt + prettified tags)', () => {
  const d = extractDeck(deck);
  const ojer = d.cards['ojer axonil, deepest might'];
  assert.equal(ojer.salt, 0);
  assert.deepEqual([...ojer.tags].sort(), ['burn', 'multiplier']);
  assert.equal(d.cards['gleeful arsonist'].salt, 5.5);
  assert.ok(d.cards['gleeful arsonist'].tags.includes('recursion'));
  assert.ok(d.cards['gleeful arsonist'].tags.includes('groupslug'));
});

test('extractHit pulls per-row metrics from a search hit', () => {
  const h = extractHit(search.hits.find((x) => /ojer/i.test(x.title)));
  assert.equal(h.deckId, '9bc8a6c2106583c1fd66e0492a3a5a26');
  assert.equal(Math.round(h.power * 10) / 10, 5.9);
  assert.equal(h.salt, 130.5928003116271);
  assert.equal(h.archetypeMajor, 'MIDRANGE');
  assert.equal(h.isPrivate, false);
});

test('isStub detects unanalyzable payloads', () => {
  assert.equal(isStub(deck), false);
  assert.equal(isStub({ name: null, _cardCount: 0 }), true);
  assert.equal(isStub({ name: 'x', _cardCount: 0 }), true);
  assert.equal(isStub({}), true);
});
