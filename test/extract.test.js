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

test('extractDeck drops deck value; keeps both brackets (baseline only for the delta arrow)', () => {
  const d = extractDeck(deck);
  assert.equal(d.value, undefined);
  assert.equal(d.bracketRealistic, 3); // csBracket — the displayed number
  assert.equal(d.bracketBaseline, 3); // wotcBracket — drives the up/down arrow
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

test('extractDeck enriches cards with bracket flags + power/salt breakdowns', () => {
  const d = extractDeck(deck);
  const jw = d.cards["jeska's will"];
  assert.ok(jw, "expected Jeska's Will in the card map");
  assert.deepEqual([...jw.flags].sort(), ['Game Changer', 'cEDH staple']);
  const powerCats = jw.power.map((x) => x.cat);
  assert.ok(powerCats.includes('draw') && powerCats.includes('fastmana'), `power cats: ${powerCats}`);
  assert.ok(jw.saltBreakdown.length > 0);
  assert.ok(!jw.saltBreakdown.some((x) => x.cat === 'cardPrice'), 'cardPrice excluded from salt');
  assert.ok(jw.power.every((x) => typeof x.score === 'number'));
});

test('extractDeck attaches synergy combos (anchors) to cards that have them', () => {
  const d = extractDeck(deck);
  const withCombos = Object.values(d.cards).filter((c) => c.combos && c.combos.total > 0);
  assert.ok(withCombos.length > 0, 'expected at least one card with synergy combos');
  assert.ok(Array.isArray(withCombos[0].combos.anchors));
});

test('power breakdown de-duplicates wincon_X into X (no doubles)', () => {
  const d = extractDeck(deck);
  const c = d.cards['agate instigator']; // appears in both `burn` and `wincon_burn`
  assert.ok(c, 'expected Agate Instigator in the card map');
  const cats = c.power.map((x) => x.cat);
  assert.ok(cats.includes('burn'));
  assert.ok(!cats.some((x) => x.startsWith('wincon')), `no wincon_ cats: ${cats}`);
  assert.equal(cats.filter((x) => x === 'burn').length, 1, 'burn appears once');
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
