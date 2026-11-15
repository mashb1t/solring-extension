import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deckComposition, flagSets, flagsAvailable, commanderMatches, infoNames, ruleChips, comboCheck, groupPicks,
  previewTotals, previewSummary, shortfallText, powerVerdict, parseRulesForm, builderStartsOpen,
} from '../src/builder-view.js';
import { RULES_DEFAULT, makeCtx, ruleUsage } from '../src/build-rules.js';

const flags = (o = {}) => ({ gameChangers: new Set(), extraTurns: new Set(), massLandDenial: new Set(), ...o });
const entry = (name, quantity = 1, isLand = false) => ({ name, quantity, isLand });
const deck = {
  boards: {
    commanders: { 'ms. bumbleflower': entry('Ms. Bumbleflower') },
    mainboard: { forest: entry('Forest', 8, true), 'command tower': entry('Command Tower', 1, true), 'howling mine': entry('Howling Mine') },
    sideboard: { 'sol ring': entry('Sol Ring') },
  },
};

test('deckComposition: commanders + mainboard only, names repeated by quantity, land copies', () => {
  const c = deckComposition(deck);
  assert.deepEqual(c.current, { cards: 11, lands: 9 });
  assert.equal(c.names.filter((n) => n === 'Forest').length, 8);
  assert.equal(c.names.length, 11);
  assert.deepEqual(c.unique, ['Ms. Bumbleflower', 'Forest', 'Command Tower', 'Howling Mine']);
  assert.ok(!c.names.includes('Sol Ring'));
});

test('deckComposition: repeated basics count toward the budget in the rules ctx', () => {
  const info = { forest: { usd: 0.25 } };
  const ctx = makeCtx({ rules: { ...RULES_DEFAULT, budget: 50 }, info, flags: flags(), owned: null, deckNames: deckComposition(deck).names });
  assert.equal(Math.round(ctx.spent * 100), 200);
});

test('flagSets: arrays → Sets; a miss / error yields empty Sets', () => {
  const f = flagSets({ gameChangers: ['rhystic study'], extraTurns: [], massLandDenial: ['armageddon'] });
  assert.ok(f.gameChangers.has('rhystic study'));
  assert.ok(f.massLandDenial.has('armageddon'));
  for (const res of [{ miss: true }, { error: 'x' }, null, undefined]) {
    const e = flagSets(res);
    assert.equal(e.gameChangers.size + e.extraTurns.size + e.massLandDenial.size, 0);
  }
});

test('commanderMatches: front face, case-insensitive, order-insensitive, partners', () => {
  assert.ok(commanderMatches(['ms. bumbleflower'], ['Ms. Bumbleflower']));
  assert.ok(commanderMatches(['Esika, God of the Tree // The Prismatic Bridge'], ['Esika, God of the Tree']));
  assert.ok(commanderMatches(['Tymna the Weaver', 'Thrasios, Triton Hero'], ['Thrasios, Triton Hero', 'Tymna the Weaver']));
  assert.ok(!commanderMatches(['Tymna the Weaver'], ['Thrasios, Triton Hero', 'Tymna the Weaver']));
  assert.ok(!commanderMatches([], []));
  assert.ok(!commanderMatches(null, ['X']));
});

test('infoNames: deck + theme + combo pieces, deduped by front face', () => {
  const names = infoNames({
    deckNames: ['Forest', 'Forest', 'Delver of Secrets // Insectile Aberration'],
    themeCards: [{ name: 'Howling Mine' }, { name: 'Delver of Secrets' }],
    comboResults: { almostIncluded: [{ uses: [{ card: { name: 'Howling Mine' } }, { card: { name: 'Seedborn Muse' } }] }] },
  });
  assert.deepEqual(names, ['Forest', 'Delver of Secrets // Insectile Aberration', 'Howling Mine', 'Seedborn Muse']);
});

test('ruleChips: GC and budget meters, uncapped GC, power target hint', () => {
  const ctx = { ...makeCtx({ rules: { ...RULES_DEFAULT, budget: 250, power: { min: 6, max: 7 } }, info: {}, flags: flags(), owned: null, deckNames: [] }), gcUsed: 1, spent: 61.4 };
  const chips = ruleChips(ruleUsage(ctx));
  assert.deepEqual(chips.map((c) => c.text), ['Bracket 3', 'Game Changers 1 / 3', 'Budget $61 / $250', 'Power 6–7']);
  assert.equal(chips[1].pct.toFixed(2), '0.33');
  assert.equal(chips[1].warn, false);
  assert.equal(chips[3].hint, 'target');
  const full = ruleChips([{ key: 'gc', used: 3, max: 3 }, { key: 'gc', used: 0, max: 0 }, { key: 'gc', used: 5, max: Infinity }]);
  assert.equal(full[0].warn, true);
  assert.equal(full[1].pct, 1);
  assert.equal(full[2].text, 'Game Changers 5 / no cap');
  assert.equal(full[2].pct, null);
});

test('comboCheck: all pieces must fit in sequence; already-owned pieces are skipped', () => {
  const gcs = new Set(['a', 'b']);
  const rules = { ...RULES_DEFAULT, gameChangerCap: 1 };
  const ctx = makeCtx({ rules, info: {}, flags: flags({ gameChangers: gcs }), owned: null, deckNames: ['Cmdr'] });
  const blocked = comboCheck({ add: ['A', 'B'] }, ctx);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /^B: Would be Game Changer #2 \(cap 1\)$/);
  const ok = comboCheck({ add: ['A', 'C'] }, ctx);
  assert.deepEqual(ok, { add: ['A', 'C'], ok: true, reason: null });
  const have = makeCtx({ rules, info: {}, flags: flags(), owned: null, deckNames: ['A', 'C'] });
  assert.equal(comboCheck({ add: ['A', 'C'] }, have).ok, false);
});

const picks = [
  { name: 'Rhystic Study', tier: 'key', qty: 1, usd: 40 },
  { name: 'Howling Mine', tier: 'theme', qty: 1, usd: 2.5 },
  { name: 'Seedborn Muse', tier: 'key', qty: 1, usd: null },
  { name: 'Forest', tier: 'land', qty: 10, usd: 0.2 },
];

test('groupPicks: key/theme/land order, original indices kept, copy counts', () => {
  const g = groupPicks(picks);
  assert.deepEqual(g.map((x) => [x.tier, x.label, x.count]), [['key', 'Key cards', 2], ['theme', 'Theme cards', 1], ['land', 'Lands', 10]]);
  assert.deepEqual(g[0].rows.map((r) => r.i), [0, 2]);
  assert.deepEqual(groupPicks([]), []);
});

test('previewTotals + previewSummary follow the ticked rows', () => {
  const ctx = { ...makeCtx({ rules: { ...RULES_DEFAULT, budget: 250 }, info: {}, flags: flags({ gameChangers: new Set(['rhystic study']) }), owned: null, deckNames: [] }), gcUsed: 1, spent: 10 };
  const all = previewTotals({ picks, ticked: new Set([0, 1, 2, 3]), ctx, current: { cards: 87, lands: 26 } });
  assert.equal(all.count, 13);
  assert.equal(all.deckAfter, 100);
  assert.equal(all.landsAfter, 36);
  assert.equal(all.gcAfter, 2);
  assert.equal(all.cost.toFixed(2), '44.50');
  const some = previewTotals({ picks, ticked: new Set([1, 3]), ctx, current: { cards: 87, lands: 26 } });
  assert.equal(some.count, 11);
  assert.equal(some.gcAfter, 1);
  assert.equal(previewSummary(all, ctx.rules, 3), '13 cards proposed · deck 100 / 100 · lands 36 / 36 · Bracket 3 · Game Changers 2 / 3 · $54.50 / $250');
  assert.match(previewSummary(all, { bracket: 4, budget: null }, Infinity), /Game Changers 2 · adds \$44\.50$/);
});

test('shortfallText: only when short; names the binding rule', () => {
  assert.equal(shortfallText({ shortfall: 0, binding: null }), null);
  assert.equal(shortfallText({ shortfall: 12, binding: 'Over budget ($1.20 left)' }), 'Short by 12 cards: Over budget ($1.20 left) is the binding rule.');
  assert.equal(shortfallText({ shortfall: 1, binding: null }), 'Short by 1 card: not enough suggestions fit the rules.');
});

test('powerVerdict: within / above / below, and unavailable for stub, miss, error', () => {
  const t = { min: 6, max: 7 };
  assert.equal(powerVerdict({ fields: { power: 6.44 } }, t), 'Power 6.4 — within target');
  assert.equal(powerVerdict({ fields: { power: 8.1 } }, t), 'Power 8.1 — above target 6–7');
  assert.equal(powerVerdict({ fields: { power: 4 } }, t), 'Power 4.0 — below target 6–7');
  for (const r of [{ unanalyzable: true }, { miss: true }, { error: 'x' }, null, { fields: {} }]) {
    assert.equal(powerVerdict(r, t), 'Power check unavailable (private deck)');
  }
});

test('parseRulesForm: blanks clear rules; invalid input reports an error', () => {
  assert.deepEqual(parseRulesForm({ bracket: '3', gcCap: '', powerMin: '', powerMax: '', budget: '' }),
    { rules: { bracket: 3, gameChangerCap: null, power: null, budget: null } });
  assert.deepEqual(parseRulesForm({ bracket: '4', gcCap: '2', powerMin: '6', powerMax: '7', budget: '50' }),
    { rules: { bracket: 4, gameChangerCap: 2, power: { min: 6, max: 7 }, budget: 50 } });
  assert.ok(parseRulesForm({ bracket: '6' }).error);
  assert.ok(parseRulesForm({ bracket: '3', gcCap: '-1' }).error);
  assert.ok(parseRulesForm({ bracket: '3', powerMin: '7', powerMax: '6' }).error);
  assert.ok(parseRulesForm({ bracket: '3', powerMin: '7' }).error);
  assert.ok(parseRulesForm({ bracket: '3', budget: '0' }).error);
  assert.ok(parseRulesForm({ bracket: '3', budget: 'abc' }).error);
});

test('ownedFilter: hides only not-owned suggestions, and only when owned-only is active', async () => {
  const { ownedFilter } = await import('../src/builder-view.js');
  const list = [
    { name: 'A', check: { ok: true } },
    { name: 'B', check: { ok: false, reason: 'Not in your collection' } },
    { name: 'C', check: { ok: false, reason: 'Would be Game Changer #4 (cap 3)' } },
  ];
  assert.deepEqual(ownedFilter(list, false), { shown: list, hidden: 0 });
  const r = ownedFilter(list, true);
  assert.deepEqual(r.shown.map((s) => s.name), ['A', 'C']);
  assert.equal(r.hidden, 1);
});

test('flagsAvailable: only a real flags response counts; a miss / error / missing list does not', () => {
  assert.equal(flagsAvailable({ gameChangers: [], extraTurns: [], massLandDenial: [] }), true);
  assert.equal(flagsAvailable({ miss: true }), false);
  assert.equal(flagsAvailable({ error: 'x' }), false);
  assert.equal(flagsAvailable(null), false);
  assert.equal(flagsAvailable({ gameChangers: [], extraTurns: [] }), false);
});

test('ruleChips: "Bracket checks unavailable" warning chip when flags are missing', () => {
  const chips = ruleChips([{ key: 'bracket', label: 'Bracket 3' }], { flagsMissing: true });
  const f = chips.find((c) => c.key === 'flags');
  assert.equal(f.text, 'Bracket checks unavailable');
  assert.equal(f.warn, true);
  assert.equal(ruleChips([{ key: 'bracket', label: 'Bracket 3' }]).some((c) => c.key === 'flags'), false);
});

test('builderStartsOpen: non-editable decks always start collapsed', () => {
  for (const setting of ['auto', 'open', 'collapsed']) {
    assert.equal(builderStartsOpen({ setting, editable: false, cards: 40 }), false);
  }
});

test('builderStartsOpen: auto opens below the legal size only', () => {
  assert.equal(builderStartsOpen({ setting: 'auto', editable: true, cards: 1 }), true);
  assert.equal(builderStartsOpen({ setting: 'auto', editable: true, cards: 99 }), true);
  assert.equal(builderStartsOpen({ setting: 'auto', editable: true, cards: 100 }), false);
  assert.equal(builderStartsOpen({ setting: 'auto', editable: true, cards: 104 }), false);
  assert.equal(builderStartsOpen({ setting: undefined, editable: true, cards: 100 }), false); // missing → auto
  assert.equal(builderStartsOpen({ setting: 'auto', editable: true, cards: undefined }), true); // unknown size → open
});

test('builderStartsOpen: open / collapsed force the state on editable decks', () => {
  assert.equal(builderStartsOpen({ setting: 'open', editable: true, cards: 100 }), true);
  assert.equal(builderStartsOpen({ setting: 'collapsed', editable: true, cards: 10 }), false);
});
