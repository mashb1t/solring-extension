import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRuleZeroText } from '../src/rule-zero.js';
import { humanizeLabel } from '../src/labels.js';

const fields = {
  commander: 'Ojer Axonil, Deepest Might // Temple of Power',
  power: 5.9879, powerScoreTotal: 789.8,
  bracketRealistic: 3, bracketBaseline: 3,
  commanderTier: 4, archetype: 'MIDRANGE / COMBO',
  salt: 129.7, saltPersonality: { headline: 'Punisher', intensity: 'moderate' },
  combos: [{ pieces: ['Ojer Axonil, Deepest Might', 'Pyrohemia'] }],
  powerProfile: { antiPatterns: [{ label: 'Group-slug pressure', severity: 'minor' }, { label: 'Multi-deficit penalty', severity: 'major' }] },
  deckId: '9bc8a6c2106583c1fd66e0492a3a5a26',
};

test('includes title, commander, and rounded power', () => {
  const t = buildRuleZeroText(fields, '[Primer] Ojer Axonil BURN');
  assert.match(t, /\[Primer\] Ojer Axonil BURN — Ojer Axonil, Deepest Might/);
  assert.match(t, /Power 6\.0\/10/);
  assert.match(t, /Bracket 3 \(baseline 3\)/);
  assert.match(t, /Tier T4/);
});
test('salt grade with personality, combo pieces, and CS link', () => {
  const t = buildRuleZeroText(fields, 'X');
  assert.match(t, /Salt: .+\(Punisher, moderate\)/);
  assert.match(t, /Combos: 1 \(Ojer Axonil, Deepest Might \+ Pyrohemia\)/);
  assert.match(t, /commandersalt\.com\/details\/deck\/9bc8a6c2106583c1fd66e0492a3a5a26/);
});
test('anti-patterns listed most-severe first', () => {
  const t = buildRuleZeroText(fields, 'X');
  assert.match(t, /Watch for: Multi-deficit penalty \(major\), Group-slug pressure \(minor\)/);
});
test('omits optional segments when absent (no undefined leaks)', () => {
  const t = buildRuleZeroText({ commander: 'X', power: 7, combos: [] }, 'D');
  assert.doesNotMatch(t, /undefined/);
  assert.doesNotMatch(t, /Watch for:/);
});
test('humanizes the archetype label', () => {
  assert.equal(humanizeLabel('MIDRANGE / COMBO'), 'Midrange / Combo');
  const t = buildRuleZeroText(fields, 'X');
  assert.match(t, /Midrange \/ Combo/);
});
