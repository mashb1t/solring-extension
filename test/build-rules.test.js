import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RULES_DEFAULT, effectiveGcCap, clampGcCap, bracketGcCap, comboAllowed, makeCtx, checkCard, ruleUsage, addToCtx, comboGuards,
} from '../src/build-rules.js';

const card = (name, o = {}) => ({ name, price: 1, gameChanger: false, colorIdentity: [], typeLine: '', image: '', ...o });
const flags = (o = {}) => ({ gameChangers: new Set(), extraTurns: new Set(), massLandDenial: new Set(), ...o });
const ctxOf = (o = {}) => makeCtx({
  rules: { ...RULES_DEFAULT }, info: {}, flags: flags(), owned: null, deckNames: [], ...o,
});

test('RULES_DEFAULT: tutor cap, no land hate and no stax off', () => {
  assert.equal(RULES_DEFAULT.tutorCap, null);
  assert.equal(RULES_DEFAULT.noLandHate, false);
  assert.equal(RULES_DEFAULT.noStax, false);
});

test('no land hate: mass land denial blocked at any bracket; off = bracket rules only', () => {
  const f = flags({ massLandDenial: new Set(['armageddon']) });
  const b4 = ctxOf({ flags: f, rules: { ...RULES_DEFAULT, bracket: 4, noLandHate: true } });
  assert.deepEqual(checkCard('Armageddon', b4), { ok: false, reason: 'Blocked by your rules (mass land denial)' });
  assert.equal(checkCard('Strip Mine', b4).ok, true); // single-target land destruction isn't covered
  assert.equal(checkCard('Armageddon', ctxOf({ flags: f, rules: { ...RULES_DEFAULT, bracket: 5 } })).ok, true);
  // At B1–3 the bracket already bars it; that reason wins.
  const b3 = ctxOf({ flags: f, rules: { ...RULES_DEFAULT, noLandHate: true } });
  assert.deepEqual(checkCard('Armageddon', b3), { ok: false, reason: 'Not allowed at Bracket 3 (mass land denial)' });
});

test('no stax: stax cards blocked at any bracket; older flags without the list never throw', () => {
  const f = flags({ stax: new Set(['rule of law']) });
  const on = ctxOf({ flags: f, rules: { ...RULES_DEFAULT, bracket: 5, noStax: true } });
  assert.deepEqual(checkCard('Rule of Law', on), { ok: false, reason: 'Blocked by your rules (stax)' });
  assert.equal(checkCard('Sol Ring', on).ok, true);
  assert.equal(checkCard('Rule of Law', ctxOf({ flags: f })).ok, true);
  assert.equal(checkCard('Rule of Law', ctxOf({ rules: { ...RULES_DEFAULT, noStax: true } })).ok, true);
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

test('clampGcCap: a cap at/above the bracket cap is the bracket default (null)', () => {
  assert.equal(bracketGcCap(2), 0);
  assert.equal(bracketGcCap(3), 3);
  assert.equal(bracketGcCap(4), Infinity);
  assert.equal(clampGcCap(null, 3), null);
  assert.equal(clampGcCap(2, 3), 2);
  assert.equal(clampGcCap(3, 3), null);
  assert.equal(clampGcCap(9, 3), null);
  assert.equal(clampGcCap(0, 3), 0);
  assert.equal(clampGcCap(1, 2), null); // B1–2 allow none: anything is the default 0
  assert.equal(clampGcCap(0, 1), null);
  assert.equal(clampGcCap(7, 4), 7); // no bracket cap at B4+
});

test('ruleUsage gc: carries the bracket and whether the cap is the user\'s own', () => {
  const gcOf = (rules) => ruleUsage(ctxOf({ rules: { ...RULES_DEFAULT, ...rules } })).find((r) => r.key === 'gc');
  assert.deepEqual(gcOf({}), { key: 'gc', label: 'Game Changers', used: 0, max: 3, bracket: 3, custom: false });
  assert.deepEqual(gcOf({ gameChangerCap: 2 }), { key: 'gc', label: 'Game Changers', used: 0, max: 2, bracket: 3, custom: true });
  assert.deepEqual(gcOf({ gameChangerCap: 9 }), { key: 'gc', label: 'Game Changers', used: 0, max: 3, bracket: 3, custom: false });
  assert.equal(gcOf({ bracket: 4, gameChangerCap: 1 }).custom, true);
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

test('tutor cap: tutors already in the deck count; one over the cap is blocked', () => {
  const tutors = new Set(['demonic tutor', 'vampiric tutor', 'worldly tutor']);
  const rules = { ...RULES_DEFAULT, tutorCap: 2 };
  const ctx = ctxOf({ rules, flags: flags({ tutors }), deckNames: ['Demonic Tutor', 'Sol Ring'] });
  assert.equal(ctx.tutorUsed, 1);
  assert.equal(checkCard('Vampiric Tutor', ctx).ok, true);
  const next = addToCtx(ctx, 'Vampiric Tutor');
  assert.equal(next.tutorUsed, 2);
  assert.deepEqual(checkCard('Worldly Tutor', next), { ok: false, reason: 'Would be tutor #3 (cap 2)' });
  assert.equal(checkCard('Sol Ring', next).ok, false); // already in deck, unrelated
  assert.equal(checkCard('Plain', next).ok, true);
  const zero = ctxOf({ rules: { ...RULES_DEFAULT, tutorCap: 0 }, flags: flags({ tutors }) });
  assert.deepEqual(checkCard('Demonic Tutor', zero), { ok: false, reason: 'Would be tutor #1 (cap 0)' });
  // No cap (default): tutors are only counted
  const free = ctxOf({ flags: flags({ tutors }), deckNames: ['Demonic Tutor', 'Vampiric Tutor'] });
  assert.equal(free.tutorUsed, 2);
  assert.equal(checkCard('Worldly Tutor', free).ok, true);
  // A ctx built from older flags (no tutors list) never throws
  assert.equal(checkCard('Worldly Tutor', ctxOf({ rules })).ok, true);
});

test('budget: over budget, unknown price, absent card', () => {
  const rules = { ...RULES_DEFAULT, budget: 10 };
  const info = { owned1: card('Owned1', { price: 8 }), pricey: card('Pricey', { price: 3 }), cheap: card('Cheap', { price: 2 }), nop: card('Nop', { price: null }) };
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
  const info = { a: card('A', { price: 4, gameChanger: true }) };
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
  assert.equal(ruleUsage(ctxOf()).some((r) => r.key === 'tutors'), false);
  const t = ruleUsage(ctxOf({ rules: { ...RULES_DEFAULT, tutorCap: 2 }, flags: flags({ tutors: new Set(['mystical tutor']) }), deckNames: ['Mystical Tutor'] }))
    .find((r) => r.key === 'tutors');
  assert.deepEqual(t, { key: 'tutors', label: 'Tutors', used: 1, max: 2 });
  const keys = (rules) => ruleUsage(ctxOf({ rules: { ...RULES_DEFAULT, ...rules } })).map((r) => r.key);
  assert.equal(keys({}).includes('noLandHate'), false);
  assert.equal(keys({}).includes('noStax'), false);
  const both = ruleUsage(ctxOf({ rules: { ...RULES_DEFAULT, noLandHate: true, noStax: true } }));
  assert.deepEqual(both.filter((r) => r.key === 'noLandHate' || r.key === 'noStax').map((r) => r.label), ['No land hate', 'No stax']);
});

test('budget: basics absent from info count as $0, basics in info use their price', () => {
  const rules = { ...RULES_DEFAULT, budget: 10 };
  const ctx = ctxOf({ rules, info: { island: { name: 'Island', price: 3 } } });
  assert.deepEqual(checkCard('Forest', ctx), { ok: true });
  assert.deepEqual(checkCard('Snow-Covered Swamp', ctx), { ok: true });
  assert.deepEqual(checkCard('Island', ctx), { ok: true });
  assert.equal(addToCtx(ctx, 'Forest').spent, 0);
  assert.equal(addToCtx(ctx, 'Island').spent, 3);
  const tight = ctxOf({ rules: { ...RULES_DEFAULT, budget: 2 }, info: { island: { name: 'Island', price: 3 } } });
  assert.equal(checkCard('Island', tight).ok, false);
  assert.equal(checkCard('Nonbasic', ctx).reason, 'No price (budget set)');
});

test('budget: a basic in info with no price (Scryfall usd null) counts as $0, not blocked', () => {
  const rules = { ...RULES_DEFAULT, budget: 10 };
  const ctx = ctxOf({ rules, info: { forest: { name: 'Forest', price: null }, nonbasic: { name: 'Nonbasic', price: null } } });
  assert.deepEqual(checkCard('Forest', ctx), { ok: true });
  assert.equal(addToCtx(ctx, 'Forest').spent, 0);
  assert.equal(checkCard('Nonbasic', ctx).reason, 'No price (budget set)');
});

// Spellbook almostIncluded → combo data for makeCtx: the deck holds Exquisite Blood; Sanguine
// Bond is the last missing piece of a bracket-3 ('S') infinite.
const SANGUINE = { almostIncluded: [{ bracketTag: 'S', uses: [{ card: { name: 'Exquisite Blood' } }, { card: { name: 'Sanguine Bond' } }] }] };

test('comboGuards: almostIncluded → front-face key sets + bracket tag', () => {
  assert.deepEqual(comboGuards(SANGUINE), [{ keys: ['exquisite blood', 'sanguine bond'], bracketTag: 'S' }]);
  assert.deepEqual(comboGuards(null), []);
  assert.deepEqual(comboGuards({ almostIncluded: [{ uses: [] }] }), []);
});

test('a card completing a combo above the bracket is blocked (B2), allowed at B3', () => {
  const combos = comboGuards(SANGUINE);
  const b2 = ctxOf({ rules: { ...RULES_DEFAULT, bracket: 2 }, deckNames: ['Exquisite Blood'], combos });
  assert.deepEqual(checkCard('Sanguine Bond', b2), { ok: false, reason: 'Would complete a combo not allowed at Bracket 2' });
  const b3 = ctxOf({ rules: { ...RULES_DEFAULT, bracket: 3 }, deckNames: ['Exquisite Blood'], combos });
  assert.equal(checkCard('Sanguine Bond', b3).ok, true);
  // Not the last missing piece (Exquisite Blood absent) → nothing to complete yet.
  const empty = ctxOf({ rules: { ...RULES_DEFAULT, bracket: 2 }, combos });
  assert.equal(checkCard('Sanguine Bond', empty).ok, true);
  // The running ctx carries the combo data: adding the first piece arms the block.
  assert.equal(checkCard('Sanguine Bond', addToCtx(empty, 'Exquisite Blood')).ok, false);
});

test('a Banned-tagged (B) combo is never allowed', () => {
  assert.equal(comboAllowed('B', 5), false);
  const combos = [{ keys: ['a', 'b'], bracketTag: 'B' }];
  const b5 = ctxOf({ rules: { ...RULES_DEFAULT, bracket: 5 }, deckNames: ['A'], combos });
  assert.deepEqual(checkCard('B', b5), { ok: false, reason: 'Would complete a combo not allowed at Bracket 5' });
});
