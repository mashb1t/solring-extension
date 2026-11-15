import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deckComposition, flagSets, flagsAvailable, commanderMatches, infoNames, ruleChips, comboCheck, groupPicks,
  previewTotals, previewSummary, shortfallText, powerVerdict, parseRulesForm, builderStartsOpen, rulesAreDefault, deckSizeStatus,
  cleanupCuts, deckSyncTarget, mergeSyncWant, syncNeeded, deckSignature, deckRowEntries, rowsAhead, pruneSelection,
} from '../src/builder-view.js';
import { RULES_DEFAULT, makeCtx, ruleUsage, effectiveRules } from '../src/build-rules.js';

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
  const info = { forest: { price: 0.25 } };
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
  assert.deepEqual(chips.map((c) => c.text), ['Bracket 3', 'Game Changers 1 / 3 (Bracket 3)', 'Budget $61 / $250', 'No land hate (Bracket 3)', 'Power 6–7']);
  assert.equal(chips[1].pct.toFixed(2), '0.33');
  assert.equal(chips[1].warn, false);
  assert.equal(chips[4].hint, 'target');
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
  { name: 'Rhystic Study', tier: 'key', qty: 1, price: 40 },
  { name: 'Howling Mine', tier: 'theme', qty: 1, price: 2.5 },
  { name: 'Seedborn Muse', tier: 'key', qty: 1, price: null },
  { name: 'Forest', tier: 'land', qty: 10, price: 0.2 },
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

test('previewTotals + previewSummary: tutors after picks, shown only with a tutor cap', () => {
  const tp = [{ name: 'Demonic Tutor', qty: 1, price: 30, tier: 'key' }, { name: 'Sol Ring', qty: 1, price: 1, tier: 'key' }];
  const ctx = { ...makeCtx({ rules: { ...RULES_DEFAULT, tutorCap: 2 }, info: {}, flags: flags({ tutors: new Set(['demonic tutor']) }), owned: null, deckNames: [] }), tutorUsed: 1 };
  const t = previewTotals({ picks: tp, ticked: new Set([0, 1]), ctx, current: { cards: 98, lands: 36 } });
  assert.equal(t.tutorsAfter, 2);
  assert.equal(previewTotals({ picks: tp, ticked: new Set([1]), ctx, current: { cards: 98, lands: 36 } }).tutorsAfter, 1);
  assert.match(previewSummary(t, ctx.rules, 3), / · Game Changers 0 \/ 3 · Tutors 2 \/ 2 · adds \$31\.00$/);
  assert.doesNotMatch(previewSummary(t, { ...ctx.rules, tutorCap: null }, 3), /Tutors/);
  // An old flags object without a tutor list counts none.
  const old = { ...makeCtx({ rules: RULES_DEFAULT, info: {}, flags: flags(), owned: null, deckNames: [] }) };
  assert.equal(previewTotals({ picks: tp, ticked: new Set([0]), ctx: old, current: { cards: 98, lands: 36 } }).tutorsAfter, 0);
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
    { rules: { bracket: 3, gameChangerCap: null, power: null, budget: null, tutorCap: null, noLandHate: null, noStax: false } });
  assert.deepEqual(parseRulesForm({ bracket: '4', gcCap: '2', powerMin: '6', powerMax: '7', budget: '50' }),
    { rules: { bracket: 4, gameChangerCap: 2, power: { min: 6, max: 7 }, budget: 50, tutorCap: null, noLandHate: null, noStax: false } });
  assert.ok(parseRulesForm({ bracket: '6' }).error);
  assert.ok(parseRulesForm({ bracket: '3', gcCap: '-1' }).error);
  assert.ok(parseRulesForm({ bracket: '3', powerMin: '7', powerMax: '6' }).error);
  assert.ok(parseRulesForm({ bracket: '3', powerMin: '7' }).error);
  assert.ok(parseRulesForm({ bracket: '3', budget: '0' }).error);
  assert.ok(parseRulesForm({ bracket: '3', budget: 'abc' }).error);
});

test('parseRulesForm: tutor cap — blank = no limit, whole number ≥ 0', () => {
  assert.equal(parseRulesForm({ bracket: '3', tutorCap: '' }).rules.tutorCap, null);
  assert.equal(parseRulesForm({ bracket: '3', tutorCap: '0' }).rules.tutorCap, 0);
  assert.equal(parseRulesForm({ bracket: '3', tutorCap: '4' }).rules.tutorCap, 4);
  assert.equal(parseRulesForm({ bracket: '3', tutorCap: '-1' }).error, 'Tutor cap must be a whole number ≥ 0');
  assert.ok(parseRulesForm({ bracket: '3', tutorCap: '2.5' }).error);
});

test('parseRulesForm: no land hate / no stax checkboxes', () => {
  const r = parseRulesForm({ bracket: '4', noLandHate: true, noStax: true }).rules;
  assert.equal(r.noLandHate, true);
  assert.equal(r.noStax, true);
  assert.equal(parseRulesForm({ bracket: '4', noLandHate: false }).rules.noLandHate, false);
});

test('ruleChips: no land hate / no stax chips are plain labels', () => {
  const chips = ruleChips([{ key: 'noLandHate', label: 'No land hate' }, { key: 'noStax', label: 'No stax' }]);
  assert.deepEqual(chips.map((c) => c.text), ['No land hate', 'No stax']);
});

test('ruleChips: tutor meter', () => {
  const [c] = ruleChips([{ key: 'tutors', label: 'Tutors', used: 1, max: 2 }]);
  assert.deepEqual(c, { key: 'tutors', text: 'Tutors 1 / 2', pct: 0.5, warn: false });
  assert.equal(ruleChips([{ key: 'tutors', label: 'Tutors', used: 2, max: 2 }])[0].warn, true);
  assert.equal(ruleChips([{ key: 'tutors', label: 'Tutors', used: 0, max: 0 }])[0].pct, 1);
});

test('ruleChips gc: bracket default vs your own cap', () => {
  const t = (u) => ruleChips([{ key: 'gc', label: 'Game Changers', ...u }])[0].text;
  assert.equal(t({ used: 2, max: 3, bracket: 3, custom: false }), 'Game Changers 2 / 3 (Bracket 3)');
  assert.equal(t({ used: 0, max: 0, bracket: 2, custom: false }), 'Game Changers 0 / 0 (Bracket 2)');
  assert.equal(t({ used: 1, max: 2, bracket: 3, custom: true }), 'Game Changers 1 / 2 (your cap, Bracket 3 allows 3)');
  assert.equal(t({ used: 1, max: 2, bracket: 4, custom: true }), 'Game Changers 1 / 2 (your cap)');
  assert.equal(t({ used: 5, max: Infinity, bracket: 4, custom: false }), 'Game Changers 5 / no cap');
});

test('parseRulesForm: the GC cap is clamped to the bracket; blank / at-max is the bracket default', () => {
  const cap = (bracket, gcCap) => parseRulesForm({ bracket, gcCap }).rules.gameChangerCap;
  assert.equal(cap('3', ''), null); // cleared field → bracket default
  assert.equal(cap('3', '  '), null);
  assert.equal(cap('3', '2'), 2);
  assert.equal(cap('3', '3'), null);
  assert.equal(cap('3', '7'), null); // never above the bracket's 3
  assert.equal(cap('2', '2'), null); // bracket changed 3 → 2 with 2 still in the field
  assert.equal(cap('2', '0'), null);
  assert.equal(cap('4', '7'), 7); // B4+: no bracket cap, the user's cap stands
  assert.ok(parseRulesForm({ bracket: '3', gcCap: '1.5' }).error);
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

test('flagsAvailable: the tutor list is required only while a tutor cap is set (old cache without it)', () => {
  const old = { gameChangers: [], extraTurns: [], massLandDenial: [] };
  assert.equal(flagsAvailable(old, { ...RULES_DEFAULT }), true);
  assert.equal(flagsAvailable(old, { ...RULES_DEFAULT, tutorCap: 2 }), false);
  assert.equal(flagsAvailable({ ...old, tutors: [] }, { ...RULES_DEFAULT, tutorCap: 2 }), true);
  assert.deepEqual([...flagSets({ ...old, tutors: ['demonic tutor'] }).tutors], ['demonic tutor']);
  assert.equal(flagSets(old).tutors.size, 0);
  assert.equal(flagsAvailable(old, { ...RULES_DEFAULT, noStax: true }), false);
  assert.equal(flagsAvailable({ ...old, stax: [] }, { ...RULES_DEFAULT, noStax: true }), true);
  assert.equal(flagsAvailable(old, { ...RULES_DEFAULT, noLandHate: true }), true); // MLD is a base list
  // v2 entry whose optional query failed: null blocks only its own rule.
  const v2 = { v: 2, gameChangers: [], extraTurns: [], massLandDenial: [], tutors: null, stax: [] };
  assert.equal(flagsAvailable(v2, { ...RULES_DEFAULT }), true);
  assert.equal(flagsAvailable(v2, { ...RULES_DEFAULT, noStax: true }), true);
  assert.equal(flagsAvailable(v2, { ...RULES_DEFAULT, tutorCap: 1 }), false);
  assert.equal(flagsAvailable({ ...v2, tutors: [], stax: null }, { ...RULES_DEFAULT, noStax: true }), false);
  assert.deepEqual([...flagSets({ ...old, stax: ['rule of law'] }).stax], ['rule of law']);
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

test('deckSyncTarget: this deck → version / unknown; other decks and non-deck messages → null', () => {
  assert.equal(deckSyncTarget({ v: 1, kind: 'deck', publicId: 'abc', prevVersion: 80, version: 81, isTruncated: false }, 'abc'), 81);
  assert.equal(deckSyncTarget({ kind: 'deck', publicId: 'abc' }, 'abc'), 'unknown');
  assert.equal(deckSyncTarget({ kind: 'deck', publicId: 'other', version: 3 }, 'abc'), null);
  assert.equal(deckSyncTarget({ kind: 'collection', publicId: 'abc', version: 3 }, 'abc'), null);
  for (const m of [null, undefined, 'x', 42]) assert.equal(deckSyncTarget(m, 'abc'), null);
  assert.equal(deckSyncTarget({ kind: 'deck', publicId: 'abc', version: 1 }, null), null);
});

test('mergeSyncWant: highest version wins; unknown sticks; null leaves the want alone', () => {
  let w = mergeSyncWant(null, 81);
  assert.deepEqual(w, { version: 81, unknown: false });
  w = mergeSyncWant(w, 80);
  assert.equal(w.version, 81);
  w = mergeSyncWant(w, 83);
  assert.equal(w.version, 83);
  assert.deepEqual(mergeSyncWant(w, null), w);
  assert.deepEqual(mergeSyncWant(w, 'unknown'), { version: 83, unknown: true });
});

test('syncNeeded: our own write echo (already applied) needs nothing; newer versions and DOM changes do', () => {
  assert.equal(syncNeeded(null, 80), false);
  assert.equal(syncNeeded({ version: 81, unknown: false }, 81), false); // own write: refreshDeck already read 81
  assert.equal(syncNeeded({ version: 80, unknown: false }, 81), false); // stale message
  assert.equal(syncNeeded({ version: 82, unknown: false }, 81), true);
  assert.equal(syncNeeded({ version: 82, unknown: false }, null), true);
  assert.equal(syncNeeded({ version: null, unknown: true }, 81), true);
  assert.equal(syncNeeded({ version: null, unknown: false }, 81), false);
});

test('deckSignature: order-insensitive, front face, quantities; empty → null', () => {
  const a = deckSignature([{ name: 'Sol Ring', qty: 1 }, { name: 'Forest', qty: '8' }]);
  const b = deckSignature([{ name: 'forest', qty: 8 }, { name: 'Sol Ring', qty: 1 }, { name: 'Sol Ring', qty: 1 }]);
  assert.equal(a, b);
  assert.notEqual(a, deckSignature([{ name: 'Sol Ring', qty: 1 }, { name: 'Forest', qty: 7 }]));
  assert.notEqual(a, deckSignature([{ name: 'Forest', qty: 8 }]));
  assert.equal(deckSignature([{ name: 'Delver of Secrets // Insectile Aberration', qty: 1 }]), deckSignature([{ name: 'Delver of Secrets', qty: 1 }]));
  assert.equal(deckSignature([]), null);
  assert.equal(deckSignature(null), null);
});

// Rows shaped like the decklist DOM path (render-builder deckRows): row keys as Moxfield renders
// them (LIVE-VERIFY 2026-11-15), names from the row link, qty from the quantity input (a string).
const domRows = [
  { rowKey: 'mainboard-commander-0|7vaMd', name: 'Ms. Bumbleflower', qty: '1' },
  { rowKey: 'mainboard-main-0|aa', name: 'Forest', qty: '8' },
  { rowKey: 'mainboard-main-1|bb', name: 'Command Tower', qty: '1' },
  { rowKey: 'mainboard-main-2|cc', name: 'Howling Mine', qty: '1' },
  { rowKey: 'mainboard-sideboard-0|dd', name: 'Sol Ring', qty: '1' },
  { rowKey: 'maybeboard-main-0|ee', name: 'Seedborn Muse', qty: '1' },
];

test('deckRowEntries: commander + main sections only (sideboard / maybeboard rows dropped)', () => {
  assert.deepEqual(deckRowEntries(domRows).map((e) => e.name), ['Ms. Bumbleflower', 'Forest', 'Command Tower', 'Howling Mine']);
  assert.deepEqual(deckRowEntries(null), []);
});

test('rowsAhead: rows matching the deck state (incl. commander, sideboard present) are not ahead', () => {
  assert.equal(rowsAhead(deckRowEntries(domRows), deck), false);
});

test('rowsAhead: an added card or a changed quantity is ahead; a filtered subset is not', () => {
  const added = [...domRows, { rowKey: 'mainboard-main-3|ff', name: 'Consecrated Sphinx', qty: '1' }];
  assert.equal(rowsAhead(deckRowEntries(added), deck), true);
  const qty = domRows.map((r) => (r.name === 'Forest' ? { ...r, qty: '7' } : r));
  assert.equal(rowsAhead(deckRowEntries(qty), deck), true);
  assert.equal(rowsAhead(deckRowEntries(domRows.slice(0, 2)), deck), false); // Moxfield search/filter
  assert.equal(rowsAhead([], deck), false);
});

test('pruneSelection: keeps selected cards still in the mainboard, drops removed ones', () => {
  const sel = new Map([['forest', 'Forest'], ['howling mine', 'Howling Mine'], ['sol ring', 'Sol Ring']]);
  const kept = pruneSelection(sel, deck.boards.mainboard);
  assert.deepEqual([...kept.keys()], ['forest', 'howling mine']);
  assert.equal(pruneSelection(sel, {}).size, 0);
  assert.equal(pruneSelection(null, deck.boards.mainboard).size, 0);
});

test('rulesAreDefault: only RULES_DEFAULT-equivalent rules count as default', () => {
  assert.equal(rulesAreDefault({ bracket: 3, gameChangerCap: null, power: null, budget: null, ownedOnly: false }), true);
  assert.equal(rulesAreDefault({ bracket: 3 }), true);
  assert.equal(rulesAreDefault({ bracket: 4 }), false);
  assert.equal(rulesAreDefault({ bracket: 3, gameChangerCap: 0 }), false);
  assert.equal(rulesAreDefault({ bracket: 3, gameChangerCap: 9 }), true); // legacy cap above the bracket's = default
  assert.equal(rulesAreDefault({ bracket: 3, power: { min: 6, max: 7 } }), false);
  assert.equal(rulesAreDefault({ bracket: 3, budget: 200 }), false);
  assert.equal(rulesAreDefault({ bracket: 3, ownedOnly: true }), false);
  assert.equal(rulesAreDefault({ bracket: 3, tutorCap: 0 }), false);
  assert.equal(rulesAreDefault({ bracket: 3, tutorCap: null }), true);
  assert.equal(rulesAreDefault({ bracket: 3, noLandHate: true }), false);
  assert.equal(rulesAreDefault({ bracket: 3, noStax: true }), false);
  assert.equal(rulesAreDefault({ bracket: 3, noLandHate: false, noStax: false }), true);
});

test('deckSizeStatus: exactly 100 is legal, anything else is flagged with how far off', () => {
  assert.deepEqual(deckSizeStatus(100), { legal: true, diff: 0, label: '' });
  assert.deepEqual(deckSizeStatus(99), { legal: false, diff: -1, label: 'Not legal: 99 / 100 cards (1 under)' });
  assert.deepEqual(deckSizeStatus(101), { legal: false, diff: 1, label: 'Not legal: 101 / 100 cards (1 over)' });
  assert.deepEqual(deckSizeStatus(0), { legal: false, diff: -100, label: 'Not legal: 0 / 100 cards (100 under)' });
  assert.equal(deckSizeStatus(60, 60).legal, true);
});

const cutDeck = {
  commanders: ['Ms. Bumbleflower'],
  boards: {
    commanders: { 'ms. bumbleflower': entry('Ms. Bumbleflower') },
    mainboard: {
      forest: entry('Forest', 8, true), 'howling mine': entry('Howling Mine'), 'sol ring': entry('Sol Ring'),
      'brightclimb pathway': entry('Brightclimb Pathway // Grimclimb Pathway', 1, true), 'arcane signet': entry('Arcane Signet'),
      'mind stone': entry('Mind Stone'), 'fellwar stone': entry('Fellwar Stone'), 'swiftfoot boots': entry('Swiftfoot Boots'),
    },
    sideboard: { 'rhystic study': entry('Rhystic Study') },
  },
};

test('cleanupCuts: nothing when the deck is not over', () => {
  const cuts = [{ name: 'Howling Mine', score: 9 }];
  assert.deepEqual(cleanupCuts({ cuts, deck: cutDeck, over: 0 }), []);
  assert.deepEqual(cleanupCuts({ cuts, deck: cutDeck, over: -3 }), []);
  assert.deepEqual(cleanupCuts({ cuts: null, deck: cutDeck, over: 2 }), []);
});

test('cleanupCuts: never the commander, sideboard or not-in-deck cards; multi-copy lines skipped', () => {
  const cuts = [
    { name: 'Ms. Bumbleflower', score: 99 }, { name: 'Rhystic Study', score: 80 }, { name: 'Not A Card', score: 70 },
    { name: 'Forest', score: 60 }, { name: 'Howling Mine', score: 50 },
  ];
  assert.deepEqual(cleanupCuts({ cuts, deck: cutDeck, over: 1 }), [{ name: 'Howling Mine', score: 50 }]);
});

test('cleanupCuts: keeps EDHREC order, maps to the mainboard name (DFC), dedupes, caps at over + 5', () => {
  const cuts = [
    { name: 'Sol Ring', score: 1 }, { name: 'Brightclimb Pathway', score: 5 }, { name: 'sol ring', score: 1 },
    { name: 'Arcane Signet', score: 3 }, { name: 'Mind Stone', score: 2 }, { name: 'Fellwar Stone', score: 2 },
    { name: 'Swiftfoot Boots', score: 2 }, { name: 'Howling Mine', score: 9 },
  ];
  const out = cleanupCuts({ cuts, deck: cutDeck, over: 1 });
  assert.equal(out.length, 6);
  assert.deepEqual(out.slice(0, 2), [{ name: 'Sol Ring', score: 1 }, { name: 'Brightclimb Pathway // Grimclimb Pathway', score: 5 }]);
  assert.deepEqual(cleanupCuts({ cuts, deck: cutDeck, over: 3 }).map((c) => c.name).at(-1), 'Howling Mine');
});

test('cleanupCuts positiveOnly: scores ≤ 0 are dropped BEFORE the over + 5 cap', () => {
  const cuts = [
    { name: 'Sol Ring', score: 0 }, { name: 'Arcane Signet', score: -1 }, { name: 'Mind Stone', score: null },
    { name: 'Fellwar Stone', score: 4 }, { name: 'Swiftfoot Boots', score: 3 }, { name: 'Howling Mine', score: 2 },
  ];
  assert.deepEqual(cleanupCuts({ cuts, deck: cutDeck, over: 1, positiveOnly: true }).map((c) => c.name), ['Fellwar Stone', 'Swiftfoot Boots', 'Howling Mine']);
  assert.equal(cleanupCuts({ cuts, deck: cutDeck, over: 1 }).length, 6); // off (default): all, capped at 6
  const many = [...cuts.slice(0, 3), ...cuts.slice(0, 3), { name: 'Fellwar Stone', score: 4 }];
  assert.deepEqual(cleanupCuts({ cuts: many, deck: cutDeck, over: 1, positiveOnly: true }).map((c) => c.name), ['Fellwar Stone']);
});

test('bracket presets: chips name the bracket for preset-derived rules, "your cap" for overrides', () => {
  const chipsOf = (rules) => ruleChips(ruleUsage(makeCtx({ rules: { ...RULES_DEFAULT, ...rules }, info: {}, flags: flags({ tutors: new Set(['demonic tutor']) }), owned: null, deckNames: ['Demonic Tutor'] }))).map((c) => c.text);
  assert.deepEqual(chipsOf({ bracket: 2 }), ['Bracket 2', 'Game Changers 0 / 0 (Bracket 2)', 'Tutors 1 / 3 (Bracket 2)', 'No land hate (Bracket 2)']);
  assert.deepEqual(chipsOf({ bracket: 2, tutorCap: 5, noLandHate: false }), ['Bracket 2', 'Game Changers 0 / 0 (Bracket 2)', 'Tutors 1 / 5 (your cap)', 'Land hate allowed (your rule)']);
  assert.deepEqual(chipsOf({ bracket: 4, noLandHate: true }), ['Bracket 4', 'Game Changers 0 / no cap', 'No land hate']);
});

test('parseRulesForm: presets (blank / untouched) vs overrides round-trip', () => {
  const p = (o) => parseRulesForm({ bracket: '2', ...o }).rules;
  assert.equal(p({}).tutorCap, null);
  assert.equal(p({}).noLandHate, null);
  assert.equal(p({ noLandHate: null }).noLandHate, null);
  assert.equal(p({ tutorCap: '5' }).tutorCap, 5); // above the B2 preset: kept, not clamped
  assert.equal(p({ noLandHate: false }).noLandHate, false);
  assert.equal(p({ noLandHate: true }).noLandHate, true);
  // Saved patch → effective rules → the form again
  const saved = { ...RULES_DEFAULT, ...p({}) };
  const e = effectiveRules(saved);
  assert.deepEqual([e.tutorCap, e.noLandHate], [3, true]);
  assert.deepEqual([effectiveRules({ ...saved, bracket: 4 }).tutorCap, effectiveRules({ ...saved, bracket: 4 }).noLandHate], [null, false]);
  const over = { ...RULES_DEFAULT, ...p({ tutorCap: '5', noLandHate: false }) };
  assert.deepEqual([effectiveRules({ ...over, bracket: 4 }).tutorCap, effectiveRules({ ...over, bracket: 4 }).noLandHate], [5, false]);
});

test('rulesAreDefault: preset-following rules are default; overrides (v2) are not', () => {
  assert.equal(rulesAreDefault({ ...RULES_DEFAULT }), true);
  assert.equal(rulesAreDefault({ ...RULES_DEFAULT, noLandHate: false }), false);
  assert.equal(rulesAreDefault({ ...RULES_DEFAULT, noLandHate: true }), false);
  assert.equal(rulesAreDefault({ bracket: 3, noLandHate: false }), true); // legacy false = untouched
});

test('previewSummary + flagsAvailable use the effective (preset) tutor cap', () => {
  const t = { count: 1, deckAfter: 50, landsAfter: 20, gcAfter: 0, tutorsAfter: 2, spentAfter: 0, cost: 1 };
  assert.match(previewSummary(t, { ...RULES_DEFAULT, bracket: 2 }, 0), / · Tutors 2 \/ 3 · /);
  assert.doesNotMatch(previewSummary(t, { ...RULES_DEFAULT, bracket: 4 }, Infinity), /Tutors/);
  const old = { gameChangers: [], extraTurns: [], massLandDenial: [] };
  assert.equal(flagsAvailable(old, { ...RULES_DEFAULT, bracket: 2 }), false);
  assert.equal(flagsAvailable(old, { ...RULES_DEFAULT, bracket: 4 }), true);
});
