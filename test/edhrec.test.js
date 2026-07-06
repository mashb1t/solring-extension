import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commanderSlug, inclusionByName, stockMeter, commanderPopularity } from '../src/sources/edhrec.js';

const ojer = JSON.parse(readFileSync(new URL('../fixtures/edhrec_ojer.json', import.meta.url)));

test('commanderSlug: front face, comma dropped', () => {
  assert.equal(commanderSlug(['Ojer Axonil, Deepest Might // Temple of Power']), 'ojer-axonil-deepest-might');
});
test('commanderSlug: apostrophe removed, not hyphenated', () => {
  assert.equal(commanderSlug(["K'rrik, Son of Yawgmoth"]), 'krrik-son-of-yawgmoth');
});
test('commanderSlug: diacritics stripped', () => {
  assert.equal(commanderSlug(['Márton Stromgald']), 'marton-stromgald');
});
test('commanderSlug: DFC uses front face only', () => {
  assert.equal(commanderSlug(['Esika, God of the Tree // The Prismatic Bridge']), 'esika-god-of-the-tree');
});
test('commanderSlug: partners join alphabetically regardless of input order', () => {
  const a = commanderSlug(['Thrasios, Triton Hero', 'Tymna the Weaver']);
  const b = commanderSlug(['Tymna the Weaver', 'Thrasios, Triton Hero']);
  assert.equal(a, 'thrasios-triton-hero-tymna-the-weaver');
  assert.equal(b, a);
});
test('commanderSlug: empty → null', () => {
  assert.equal(commanderSlug([]), null);
  assert.equal(commanderSlug(null), null);
});

test('inclusionByName: pct per front-face name, dedup keeps max', () => {
  const inc = inclusionByName(ojer);
  assert.equal(inc['ruby medallion'], 72); // 7496 / 10460
  assert.ok(!('' in inc));
});
test('inclusionByName: DFC keyed by front face', () => {
  const inc = inclusionByName({ container: { json_dict: { cardlists: [
    { header: 'Top Cards', cardviews: [{ name: 'Front Face // Back', inclusion: 50, potential_decks: 100 }] },
  ] } } });
  assert.equal(inc['front face'], 50);
});
test('inclusionByName: keeps the higher pct when a card appears in multiple lists', () => {
  const inc = inclusionByName({ container: { json_dict: { cardlists: [
    { header: 'Top Cards', cardviews: [{ name: 'Dupe Card', inclusion: 30, potential_decks: 100 }] },
    { header: 'Creatures', cardviews: [{ name: 'Dupe Card', inclusion: 70, potential_decks: 100 }] },
  ] } } });
  assert.equal(inc['dupe card'], 70); // max wins, not first/last
});
test('inclusionByName: excludes the "New Cards" list', () => {
  const inc = inclusionByName({ container: { json_dict: { cardlists: [
    { header: 'New Cards', cardviews: [{ name: 'Brand New', inclusion: 90, potential_decks: 100 }] },
    { header: 'Top Cards', cardviews: [{ name: 'Old Staple', inclusion: 50, potential_decks: 100 }] },
  ] } } });
  assert.equal('brand new' in inc, false);
  assert.equal(inc['old staple'], 50);
});

test('stockMeter: mean inclusion%, offMeta = absent cards, basics + commander excluded', () => {
  const inc = { 'ruby medallion': 72, 'guttersnipe': 64 };
  const s = stockMeter(inc, ['Ruby Medallion', 'Guttersnipe', 'My Spicy Brew', 'Mountain', 'Ojer Axonil, Deepest Might // Temple of Power'], ['Ojer Axonil, Deepest Might // Temple of Power']);
  assert.equal(s.cards, 3);                        // Mountain (basic) + the commander excluded
  assert.deepEqual(s.offMeta, ['My Spicy Brew']);  // the one absent, non-commander, non-basic card
  assert.equal(s.brew, 1);
  assert.equal(s.stockScore, Math.round((72 + 64 + 0) / 3)); // 45
});
test('stockMeter: offMeta shows the front face, deduped', () => {
  const s = stockMeter({}, ['Brew // Back', 'Brew // Back'], []);
  assert.deepEqual(s.offMeta, ['Brew']);
});
test('stockMeter: null when only basics/commanders remain', () => {
  assert.equal(stockMeter({}, ['Mountain', 'Island']), null);
  assert.equal(stockMeter({}, ['Solo Cmdr'], ['Solo Cmdr']), null);
});

test('commanderPopularity: deckCount from max potential_decks + bracket_counts', () => {
  const pop = commanderPopularity(ojer);
  assert.equal(pop.deckCount, 10460);
  assert.equal(pop.brackets['2'], 1138);
});
