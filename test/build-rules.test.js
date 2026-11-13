import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RULES_DEFAULT, effectiveGcCap, comboAllowed, makeCtx, checkCard, ruleUsage, addToCtx,
} from '../src/build-rules.js';

const card = (name, o = {}) => ({ name, usd: 1, gameChanger: false, colorIdentity: [], typeLine: '', image: '', ...o });
const flags = (o = {}) => ({ gameChangers: new Set(), extraTurns: new Set(), massLandDenial: new Set(), ...o });
const ctxOf = (o = {}) => makeCtx({
  rules: { ...RULES_DEFAULT }, info: {}, flags: flags(), owned: null, deckNames: [], ...o,
});

test('gc cap by bracket and explicit cap', () => {
  assert.equal(effectiveGcCap(RULES_DEFAULT), 3);
  assert.equal(effectiveGcCap({ ...RULES_DEFAULT, gameChangerCap: 2 }), 2);
  assert.equal(effectiveGcCap({ ...RULES_DEFAULT, gameChangerCap: 9 }), 3);
  assert.equal(effectiveGcCap({ ...RULES_DEFAULT, bracket: 4 }), Infinity);
  assert.equal(effectiveGcCap({ ...RULES_DEFAULT, bracket: 4, gameChangerCap: 1 }), 1);
  assert.equal(effectiveGcCap({ ...RULES_DEFAULT, bracket: 2 }), 0);
  assert.equal(effectiveGcCap({ ...RULES_DEFAULT, bracket: 1 }), 0);
  assert.equal(effectiveGcCap({ ...RULES_DEFAULT, bracket: 5 }), Infinity);
});

test('4th game changer rejected, via flags or info', () => {
  const gc = new Set(['a', 'b', 'c', 'd']);
  const ctx = ctxOf({
    flags: flags({ gameChangers: gc }),
    deckNames: ['A', 'B', 'C'],
  });
  assert.equal(ctx.gcUsed, 3);
  assert.deepEqual(checkCard('D', ctx), { ok: false, reason: 'Would be Game Changer #4 (cap 3)' });
  const ctx2 = ctxOf({ info: { e: card('E', { gameChanger: true }) }, deckNames: ['x'], rules: { ...RULES_DEFAULT, bracket: 2 } });
  assert.deepEqual(checkCard('E', ctx2), { ok: false, reason: 'Would be Game Changer #1 (cap 0)' });
  assert.equal(checkCard('Plain', ctx).ok, true);
});

test('extra turn and mass land denial by bracket', () => {
  const f = flags({ extraTurns: new Set(['time warp']), massLandDenial: new Set(['armageddon']) });
  const b3 = ctxOf({ flags: f });
  assert.deepEqual(checkCard('Time Warp', b3), { ok: false, reason: 'Not allowed at Bracket 3 (extra turn)' });
  assert.deepEqual(checkCard('Armageddon', b3), { ok: false, reason: 'Not allowed at Bracket 3 (mass land denial)' });
  const b4 = ctxOf({ flags: f, rules: { ...RULES_DEFAULT, bracket: 4 } });
  assert.equal(checkCard('Time Warp', b4).ok, true);
  assert.equal(checkCard('Armageddon', b4).ok, true);
});

test('budget: over budget, unknown price, absent card', () => {
  const rules = { ...RULES_DEFAULT, budget: 10 };
  const info = { owned1: card('Owned1', { usd: 8 }), pricey: card('Pricey', { usd: 3 }), cheap: card('Cheap', { usd: 2 }), nop: card('Nop', { usd: null }) };
  const ctx = ctxOf({ rules, info, deckNames: ['Owned1'] });
  assert.equal(ctx.spent, 8);
  assert.deepEqual(checkCard('Pricey', ctx), { ok: false, reason: 'Over budget ($2.00 left)' });
  assert.equal(checkCard('Cheap', ctx).ok, true);
  assert.deepEqual(checkCard('Nop', ctx), { ok: false, reason: 'No price (budget set)' });
  assert.deepEqual(checkCard('Missing', ctx), { ok: false, reason: 'No price (budget set)' });
  const free = ctxOf({ info });
  assert.equal(checkCard('Nop', free).ok, true);
  assert.equal(checkCard('Missing', free).ok, true);
});

test('owned only', () => {
  const ctx = ctxOf({ rules: { ...RULES_DEFAULT, ownedOnly: true }, owned: new Set(['sol ring']) });
  assert.equal(checkCard('Sol Ring', ctx).ok, true);
  assert.deepEqual(checkCard('Mana Crypt', ctx), { ok: false, reason: 'Not in your collection' });
  assert.equal(checkCard('Forest', ctx).ok, true);
});

test('already in deck by front face; basics repeatable', () => {
  const ctx = ctxOf({ deckNames: ['Ojer Axonil, Deepest Might // Temple of Power', 'Forest', 'Forest'] });
  assert.deepEqual(checkCard('Ojer Axonil, Deepest Might', ctx), { ok: false, reason: 'Already in deck' });
  assert.deepEqual(checkCard('Ojer Axonil, Deepest Might // Temple of Power', ctx), { ok: false, reason: 'Already in deck' });
  assert.equal(checkCard('Forest', ctx).ok, true);
  assert.equal(checkCard('Snow-Covered Island', ctx).ok, true);
});

test('comboAllowed', () => {
  assert.equal(comboAllowed('P', 3), true);
  assert.equal(comboAllowed('R', 3), false);
  assert.equal(comboAllowed('R', 4), true);
  assert.equal(comboAllowed('E', 1), true);
  assert.equal(comboAllowed('O', 1), false);
  assert.equal(comboAllowed(null, 3), false);
  assert.equal(comboAllowed(null, 4), true);
  assert.equal(comboAllowed('Z', 3), false);
});

test('addToCtx returns a new ctx with the card counted', () => {
  const info = { a: card('A', { usd: 4, gameChanger: true }) };
  const ctx = ctxOf({ info, rules: { ...RULES_DEFAULT, budget: 10 } });
  const next = addToCtx(ctx, 'A');
  assert.equal(ctx.gcUsed, 0);
  assert.equal(ctx.spent, 0);
  assert.equal(next.gcUsed, 1);
  assert.equal(next.spent, 4);
  assert.deepEqual(checkCard('A', next), { ok: false, reason: 'Already in deck' });
  assert.equal(checkCard('A', ctx).ok, true);
});

test('ruleUsage', () => {
  const ctx = ctxOf({ rules: { ...RULES_DEFAULT, budget: 50, power: { min: 5, max: 7 } } });
  const u = Object.fromEntries(ruleUsage(ctx).map((r) => [r.key, r]));
  assert.equal(u.gc.used, 0);
  assert.equal(u.gc.max, 3);
  assert.equal(u.budget.max, 50);
  assert.match(u.bracket.label, /3/);
  assert.ok(u.power);
  assert.equal(ruleUsage(ctxOf()).some((r) => r.key === 'budget'), false);
});

test('budget: basics absent from info count as $0, basics in info use their price', () => {
  const rules = { ...RULES_DEFAULT, budget: 10 };
  const ctx = ctxOf({ rules, info: { island: { name: 'Island', usd: 3 } } });
  assert.deepEqual(checkCard('Forest', ctx), { ok: true });
  assert.deepEqual(checkCard('Snow-Covered Swamp', ctx), { ok: true });
  assert.deepEqual(checkCard('Island', ctx), { ok: true });
  assert.equal(addToCtx(ctx, 'Forest').spent, 0);
  assert.equal(addToCtx(ctx, 'Island').spent, 3);
  const tight = ctxOf({ rules: { ...RULES_DEFAULT, budget: 2 }, info: { island: { name: 'Island', usd: 3 } } });
  assert.equal(checkCard('Island', tight).ok, false);
  assert.equal(checkCard('Nonbasic', ctx).reason, 'No price (budget set)');
});

test('budget: a basic in info with no price (Scryfall usd null) counts as $0, not blocked', () => {
  const rules = { ...RULES_DEFAULT, budget: 10 };
  const ctx = ctxOf({ rules, info: { forest: { name: 'Forest', usd: null }, nonbasic: { name: 'Nonbasic', usd: null } } });
  assert.deepEqual(checkCard('Forest', ctx), { ok: true });
  assert.equal(addToCtx(ctx, 'Forest').spent, 0);
  assert.equal(checkCard('Nonbasic', ctx).reason, 'No price (budget set)');
});
