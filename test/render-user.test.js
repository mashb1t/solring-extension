import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averageViews } from '../src/render-user.js';

const v = (o) => ({
  power: null, bracketRealistic: null, salt: null, synergy: null,
  threat: null, interaction: null, wincons: null, commanderTier: null, ...o,
});

test('averageViews — averages each metric over the views that have it, with coverage', () => {
  const views = [
    v({ power: 8, bracketRealistic: 4, salt: 100, threat: 200 }),
    v({ power: 6, bracketRealistic: 5, salt: 200, threat: null }), // no threat (not scanned)
    v({ power: 4, bracketRealistic: 3, salt: 300, threat: 100 }),
  ];
  const a = averageViews(views);
  assert.equal(a.total, 3);
  assert.equal(a.power.v, 6); // (8+6+4)/3
  assert.equal(a.power.n, 3);
  assert.equal(a.bracket.v, 4); // (4+5+3)/3
  assert.equal(a.salt.v, 200);
  assert.equal(a.threat.v, 150); // (200+100)/2 — only the two with threat
  assert.equal(a.threat.n, 2); // coverage: 2 of 3
});

test('averageViews — a metric absent from every view yields null/0', () => {
  const a = averageViews([v({ power: 5 }), v({ power: 7 })]);
  assert.equal(a.power.v, 6);
  assert.equal(a.wincons.v, null);
  assert.equal(a.wincons.n, 0);
});

test('averageViews — empty input', () => {
  const a = averageViews([]);
  assert.equal(a.total, 0);
  assert.equal(a.power.v, null);
  assert.equal(a.power.n, 0);
});
