import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mergeView, compareViews, SORT_KEYS } from '../src/decklist.js';
import { extractHit } from '../src/extract.js';
import { deckMd5, canonicalDeckUrl } from '../src/md5.js';

const search = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/search_mashb1t.json', import.meta.url))));

test('join: a deck publicId hashes to a CommanderSalt deckId (md5 form)', () => {
  // The known vector both sides agree on (mirrors md5.test.js + the live deckId shape).
  assert.equal(deckMd5(canonicalDeckUrl('1OeRLCXjAUC9dNmkw3e_7g')), '9bc8a6c2106583c1fd66e0492a3a5a26');
  // Every search hit's deckId is a 32-char md5 — the value we join DOM rows against.
  for (const h of search.hits) assert.match(h.deckId, /^[0-9a-f]{32}$/);
});

test('mergeView — hit only: hit metrics present, full-only metrics null, not analyzed', () => {
  const hit = { deckId: 'abc', power: 8.5, bracketRating: 4.98, salt: 103.6, synergy: 3463.7, archetypeMajor: 'MIDRANGE', isPrivate: false };
  const v = mergeView(hit, null);
  assert.equal(v.analyzed, false);
  assert.equal(v.power, 8.5);
  assert.equal(v.bracketRealistic, 5); // rounded from 4.98
  assert.equal(v.bracketBaseline, null); // hits carry no baseline → no delta arrow
  assert.equal(v.salt, 103.6);
  assert.equal(v.synergy, 3463.7);
  assert.equal(v.archetype, 'MIDRANGE');
  assert.equal(v.threat, null);
  assert.equal(v.commanderTier, null);
});

test('mergeView — full payload wins and supplies full-only metrics', () => {
  const hit = { deckId: 'abc', power: 8.5, bracketRating: 4.98, salt: 103.6, archetypeMajor: 'MIDRANGE' };
  const full = {
    deckId: 'abc', power: 8.9, bracketRealistic: 4, bracketBaseline: 3, salt: 130.6,
    synergy: 1787.3, archetype: 'Landfall', threat: 200, interaction: 197, wincons: 347.8,
    commanderTier: 2, combosCount: 13,
  };
  const v = mergeView(hit, full);
  assert.equal(v.analyzed, true);
  assert.equal(v.power, 8.9);
  assert.equal(v.bracketRealistic, 4);
  assert.equal(v.bracketBaseline, 3); // now we have an arrow basis
  assert.equal(v.archetype, 'Landfall');
  assert.equal(v.threat, 200);
  assert.equal(v.commanderTier, 2);
  assert.equal(v.combosCount, 13);
});

test('mergeView — real fixture hit (through extractHit, the production path)', () => {
  const h = extractHit(search.hits.find((x) => x.commanders && x.commanders.length));
  const v = mergeView(h, null);
  assert.equal(v.deckId, h.deckId);
  assert.equal(v.power, h.power);
  assert.equal(v.bracketRealistic, Math.round(h.bracketRating));
  assert.equal(v.salt, h.salt);
  assert.equal(v.synergy, h.synergy);
  assert.equal(v.analyzed, false);
});

test('compareViews — desc by power, missing-metric rows always last', () => {
  const views = [
    mergeView({ power: 5 }, null),
    mergeView({ power: 9 }, null),
    mergeView({}, null), // no power → last
    mergeView({ power: 7 }, null),
  ];
  const sorted = [...views].sort(compareViews('power', 'desc'));
  assert.deepEqual(sorted.map((v) => v.power), [9, 7, 5, null]);
});

test('compareViews — asc keeps missing last (not first)', () => {
  const views = [mergeView({ power: 5 }, null), mergeView({}, null), mergeView({ power: 2 }, null)];
  const sorted = [...views].sort(compareViews('power', 'asc'));
  assert.deepEqual(sorted.map((v) => v.power), [2, 5, null]);
});

test('compareViews — a full-only key (threat) sorts analyzed rows, parks hit-only rows last', () => {
  const analyzed = mergeView({ power: 5 }, { threat: 300 });
  const hitOnly = mergeView({ power: 9 }, null);
  const sorted = [analyzed, hitOnly].sort(compareViews('threat', 'desc'));
  assert.deepEqual(sorted, [analyzed, hitOnly]);
  assert.equal(SORT_KEYS.threat.hit, false);
  assert.equal(SORT_KEYS.power.hit, true);
});
