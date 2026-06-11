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
  assert.equal(d.combosCount, 1); // deck-level Spellbook combo count (5th row-2 tile)
  assert.equal(d.powerScoreTotal, 789.8); // scoring.total — basis for per-card % + avg
  assert.equal(d.analyzedAt, 1780256803317); // ingestDate — for edit-detection re-analysis
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
  // powerTotal = sum across every (deduped) category, so it's at least the top contributor.
  assert.equal(typeof jw.powerTotal, 'number');
  assert.ok(jw.powerTotal >= Math.max(...jw.power.map((x) => x.score)), `powerTotal ${jw.powerTotal}`);
});

test('extractDeck shapes the deck combo list for display', () => {
  const d = extractDeck(deck);
  assert.equal(d.combos.length, 1);
  const c = d.combos[0];
  assert.ok(c.pieces.includes('Pyrohemia'), `pieces: ${c.pieces}`);
  assert.equal(c.score, 25);
  assert.equal(Math.round(c.complexity * 100), 46); // bias.final
  assert.equal(c.extraMana, 1);
  assert.ok(c.categories.includes('infinite-damage'));
  assert.ok(c.needsBoard);
  assert.ok(c.prerequisites.length >= 1);
  assert.ok(c.steps.length >= 1 && c.steps.some((s) => s.payMana));
  assert.ok(c.produces.length >= 1);
  assert.ok(/commanderspellbook\.com/.test(c.spellbookUri));
});

test('extractDeck attaches synergy combos (anchors + score) to cards that have them', () => {
  const d = extractDeck(deck);
  const withCombos = Object.values(d.cards).filter((c) => c.combos && c.combos.anchors && c.combos.anchors.length > 0);
  assert.ok(withCombos.length > 0, 'expected at least one card with synergy combos');
  // synergy score = Σ conditionScoring.total (CommanderSalt's per-card anchor score)
  assert.ok(withCombos.every((c) => typeof c.combos.score === 'number'), 'every combo carries a numeric score');
  assert.ok(withCombos.some((c) => c.combos.score > 0), 'at least one card has a positive synergy score');
  const anchors = withCombos[0].combos.anchors;
  assert.ok(Array.isArray(anchors) && anchors.length > 0);
  // each anchor is { name, image } — image is the deck print, upgraded to the full card
  assert.ok(anchors.every((a) => typeof a.name === 'string' && a.name.length));
  const withImg = anchors.find((a) => a.image);
  assert.ok(withImg, 'expected at least one anchor with an image');
  assert.ok(withImg.image.includes('/normal/') && !withImg.image.includes('/border_crop/'));
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
