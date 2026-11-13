import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchEdhrecPage, themesOf, themeCards, topCommanders, cardSlug } from '../src/sources/edhrec-build.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url)));
const ojer = load('edhrec_ojer.json');
const spellslinger = load('edhrec_ojer_spellslinger.json');
const groupHug = load('edhrec_tag_group-hug.json');
const howlingMine = load('edhrec_card_howling-mine.json');

test('themesOf: taglinks → {slug,name,decks} sorted by decks desc', () => {
  const themes = themesOf(ojer);
  assert.deepEqual(themes[0], { slug: 'burn', name: 'Burn', decks: 1512 });
  assert.ok(themes.some((t) => t.slug === 'spellslinger'));
  for (let i = 1; i < themes.length; i++) assert.ok(themes[i - 1].decks >= themes[i].decks);
});
test('themesOf: no panels → []', () => {
  assert.deepEqual(themesOf(null), []);
  assert.deepEqual(themesOf({}), []);
});

test('themeCards: synergy + inclusion%, list header, New Cards excluded', () => {
  const cards = themeCards(spellslinger);
  const archer = cards.find((c) => c.name === 'Firebrand Archer');
  assert.equal(archer.inclusionPct, 90); // 307 / 342
  assert.ok(Math.abs(archer.synergy - 0.8128) < 1e-3);
  assert.equal(archer.list, 'Top Cards');
  // Koth, the Geomancer is listed only under "New Cards" (recency, not staple-ness)
  assert.equal(cards.some((c) => c.name === 'Koth, the Geomancer'), false);
  assert.ok(cards.length >= 3);
});
test('themeCards: dedupes by front face keeping max synergy; synergy defaults to 0', () => {
  const json = { container: { json_dict: { cardlists: [
    { header: 'A', cardviews: [{ name: 'Foo // Bar', synergy: 0.1, num_decks: 5, potential_decks: 10 }] },
    { header: 'B', cardviews: [{ name: 'Foo', synergy: 0.3, num_decks: 5, potential_decks: 10 }, { name: 'Baz', num_decks: 1, potential_decks: 4 }] },
  ] } } };
  const cards = themeCards(json);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.find((c) => c.name === 'Foo'), { name: 'Foo', synergy: 0.3, inclusionPct: 50, list: 'B' });
  assert.equal(cards.find((c) => c.name === 'Baz').synergy, 0);
});

test('topCommanders: tag and card pages', () => {
  for (const json of [groupHug, howlingMine]) {
    const cmds = topCommanders(json);
    assert.ok(cmds.length >= 3);
    for (const c of cmds) {
      assert.equal(typeof c.name, 'string');
      assert.equal(typeof c.decks, 'number');
    }
  }
  assert.deepEqual(topCommanders(null), []);
});

test('cardSlug: same normalization as commanderSlug for one name', () => {
  assert.equal(cardSlug('Ojer Axonil, Deepest Might // Temple of Power'), 'ojer-axonil-deepest-might');
  assert.equal(cardSlug("Sol Ring"), 'sol-ring');
});

test('fetchEdhrecPage: non-OK → null, simple request (no headers)', async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push([url, opts]); return { ok: false, status: 403 }; };
  try {
    assert.equal(await fetchEdhrecPage('tags/group-hug'), null);
  } finally { globalThis.fetch = real; }
  assert.equal(calls[0][0], 'https://json.edhrec.com/pages/tags/group-hug.json');
  assert.ok(!calls[0][1] || !('headers' in calls[0][1]));
});
test('fetchEdhrecPage: throw → null; ok → json', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('net'); };
    assert.equal(await fetchEdhrecPage('x'), null);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ a: 1 }) });
    assert.deepEqual(await fetchEdhrecPage('x'), { a: 1 });
  } finally { globalThis.fetch = real; }
});
