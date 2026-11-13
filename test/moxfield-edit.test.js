import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeDeck } from '../src/moxfield-edit.js';

const card = (id, name, type_line, extra = {}) => ({ id, name, type_line, layout: 'normal', ...extra });
const json = {
  id: 'edit1', name: 'Test', format: 'commander', colorIdentity: ['W', 'U', 'G'],
  boards: {
    commanders: { cards: { e0: { quantity: 1, card: card('c1', 'Ms. Bumbleflower', 'Legendary Creature — Rabbit Citizen', { color_identity: ['G', 'W', 'U'] }) } } },
    mainboard: {
      cards: {
        e1: { quantity: 8, card: card('f1', 'Forest', 'Basic Land — Forest') },
        e2: { quantity: 1, card: card('s1', 'Howling Mine', 'Artifact') },
        e3: { quantity: 1, card: card('m1', 'Bala Ged Recovery // Bala Ged Sanctuary', 'Sorcery // Land', { layout: 'modal_dfc', card_faces: [{ id: 'fa' }, { id: 'fb' }] }) },
        e4: { quantity: 1, card: card('l1', 'Command Tower', 'Land') },
      },
    },
  },
};

test('shapeDeck: boards keyed by front face, quantities, land-ness on the front face', () => {
  const d = shapeDeck(json);
  assert.equal(d.editId, 'edit1');
  assert.equal(d.format, 'commander');
  assert.deepEqual(d.commanders, ['Ms. Bumbleflower']);
  assert.equal(d.boards.mainboard.forest.quantity, 8);
  assert.equal(d.boards.mainboard.forest.isLand, true);
  assert.equal(d.boards.mainboard['command tower'].isLand, true);
  assert.equal(d.boards.mainboard['howling mine'].isLand, false);
  assert.equal(d.boards.mainboard['bala ged recovery'].isLand, false); // MDFC spell front
  assert.equal(d.boards.mainboard['bala ged recovery'].faces.length, 2);
  assert.deepEqual(d.boards.sideboard, {});
});

test('shapeDeck: colour identity from the commanders in WUBRG order, deck field as fallback', () => {
  assert.deepEqual(shapeDeck(json).colorIdentity, ['W', 'U', 'G']);
  const noCmd = { ...json, boards: { ...json.boards, commanders: { cards: {} } } };
  assert.deepEqual(shapeDeck(noCmd).colorIdentity, ['W', 'U', 'G']);
  assert.deepEqual(shapeDeck({ id: 'x', boards: {} }).commanders, []);
});
