import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugifyQuery, titleCase, groupResults, namesNeedingInfo, applyInfo, deckName } from '../src/picker-logic.js';

test('slugifyQuery: lowercase, non-alphanumerics to single dashes, trimmed', () => {
  assert.equal(slugifyQuery('Group Hug'), 'group-hug');
  assert.equal(slugifyQuery('  --Group   Hug!! '), 'group-hug');
  assert.equal(slugifyQuery('+1/+1 Counters'), '1-1-counters');
  assert.equal(slugifyQuery("Pillow-Fort's"), 'pillow-forts');
  assert.equal(slugifyQuery('Énergie'), 'energie');
  assert.equal(slugifyQuery(''), '');
  assert.equal(slugifyQuery(null), '');
});

test('titleCase', () => {
  assert.equal(titleCase('group  hug '), 'Group Hug');
  assert.equal(titleCase('howling mine'), 'Howling Mine');
});

test('groupResults: theme group first, then name group, deduped by front face', () => {
  const groups = groupResults({
    label: 'group hug',
    byTheme: { commanders: [{ name: 'Kynaios and Tiro of Meletis', decks: 3920 }, { name: 'Ms. Bumbleflower', decks: 2140 }] },
    byName: { commanders: [{ name: 'Ms. Bumbleflower', colorIdentity: ['G', 'U', 'W'], image: 'x.jpg' }, { name: 'Phelddagrif', colorIdentity: ['G', 'U', 'W'], image: 'p.jpg' }] },
  });
  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, 'Commanders · theme “Group Hug”');
  assert.deepEqual(groups[0].items.map((i) => i.name), ['Kynaios and Tiro of Meletis', 'Ms. Bumbleflower']);
  assert.deepEqual(groups[0].items[0], { name: 'Kynaios and Tiro of Meletis', decks: 3920, colorIdentity: null, image: null });
  assert.equal(groups[1].title, 'Commanders · by name');
  assert.deepEqual(groups[1].items.map((i) => i.name), ['Phelddagrif']);
  assert.equal(groups[1].items[0].decks, null);
});

test('groupResults: misses/errors/empties are omitted; caps at max', () => {
  assert.deepEqual(groupResults({ byTheme: { miss: true }, byName: { error: 'x' } }), []);
  assert.deepEqual(groupResults({ byTheme: null, byName: undefined }), []);
  const many = { commanders: Array.from({ length: 30 }, (_, i) => ({ name: `C${i}` })) };
  const [g] = groupResults({ byName: many });
  assert.equal(g.items.length, 12);
  assert.equal(groupResults({ byName: many, max: 3 })[0].items.length, 3);
});

test('groupResults: DFC names dedupe by front face', () => {
  const groups = groupResults({
    byTheme: { commanders: [{ name: 'Ojer Axonil, Deepest Might // Temple of Power', decks: 10 }] },
    byName: { commanders: [{ name: 'Ojer Axonil, Deepest Might' }] },
  });
  assert.equal(groups.length, 1);
});

test('groupResults: build-around group', () => {
  const groups = groupResults({ label: 'howling mine', byCard: { commanders: [{ name: 'Phelddagrif', decks: 5 }] } });
  assert.deepEqual(groups.map((g) => g.title), ['Commanders · build around “Howling Mine”']);
  assert.deepEqual(groupResults({ label: 'x', byCard: { miss: true } }), []);
});

test('namesNeedingInfo + applyInfo fill art and colours by front face', () => {
  const groups = groupResults({
    byTheme: { commanders: [{ name: 'Ojer Axonil, Deepest Might // Temple of Power', decks: 10 }] },
    byName: { commanders: [{ name: 'Phelddagrif', colorIdentity: ['G'], image: 'p.jpg' }] },
  });
  assert.deepEqual(namesNeedingInfo(groups), ['Ojer Axonil, Deepest Might // Temple of Power']);
  const filled = applyInfo(groups, { 'ojer axonil, deepest might': { image: 'o.jpg', colorIdentity: ['R'] } });
  assert.equal(filled[0].items[0].image, 'o.jpg');
  assert.deepEqual(filled[0].items[0].colorIdentity, ['R']);
  assert.equal(filled[1].items[0].image, 'p.jpg');
  assert.deepEqual(namesNeedingInfo(filled), []);
  assert.deepEqual(applyInfo(groups, null), groups);
});

test('deckName', () => {
  assert.equal(deckName('Ms. Bumbleflower', 'Group Hug'), 'Ms. Bumbleflower – Group Hug');
  assert.equal(deckName('Ms. Bumbleflower', null), 'Ms. Bumbleflower');
});

test('themeHelp: EDHREC description, else built-in text, else the fallback', async () => {
  const { themeHelp, THEME_HELP, THEME_HELP_FALLBACK } = await import('../src/picker-logic.js');
  assert.equal(themeHelp('group-hug', 'From EDHREC.'), 'From EDHREC.');
  assert.equal(themeHelp('group-hug', '  '), THEME_HELP['group-hug']);
  assert.equal(themeHelp('Voltron', ''), THEME_HELP.voltron);
  assert.equal(themeHelp('some-new-theme', null), THEME_HELP_FALLBACK);
  assert.equal(THEME_HELP_FALLBACK, "Playstyle from EDHREC's theme lists.");
});
