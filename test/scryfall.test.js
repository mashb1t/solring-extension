import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shapeCards, resolveRequested, fetchCardLookup, fetchCardInfo, searchCommanders, fetchFlagSets, commanderQuery } from '../src/sources/scryfall.js';

const collection = JSON.parse(readFileSync(new URL('../fixtures/scryfall_collection.json', import.meta.url)));
const jsonRes = (body, ok = true) => ({ ok, json: async () => body });

async function withFetch(stub, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test('shapeCards: Game Changer flag, usd parsed, null price stays null', () => {
  const info = shapeCards(collection);
  assert.equal(info['rhystic study'].gameChanger, true);
  assert.equal(info['rhystic study'].usd, 67.93);
  assert.equal(info['sol ring'].gameChanger, false);
  assert.equal(info['black lotus'].usd, null);
  assert.deepEqual(info['command tower'].colorIdentity, []);
  assert.equal(info['rhystic study'].typeLine, 'Enchantment');
});

test('shapeCards: DFC keyed by front face, image from card_faces', () => {
  const info = shapeCards(collection);
  const ojer = info['ojer axonil, deepest might'];
  assert.equal(ojer.name, 'Ojer Axonil, Deepest Might // Temple of Power');
  assert.deepEqual(ojer.colorIdentity, ['R']);
  assert.match(ojer.image, /^https:\/\//);
  assert.equal(info['ojer axonil, deepest might // temple of power'], undefined);
});

test('shapeCards: junk input → {}', () => {
  assert.deepEqual(shapeCards(null), {});
  assert.deepEqual(shapeCards({}), {});
});

test('fetchCardInfo: 80 names → exactly 2 POSTs (75 + 5), merged', async () => {
  const names = Array.from({ length: 80 }, (_, i) => `Card ${i}`);
  const sizes = [];
  const stub = async (url, opts) => {
    assert.match(url, /\/cards\/collection$/);
    assert.equal(opts.method, 'POST');
    const ids = JSON.parse(opts.body).identifiers;
    sizes.push(ids.length);
    return jsonRes({ data: ids.map((i) => ({ name: i.name, prices: { usd: '1.00' }, color_identity: [], type_line: 'Artifact', game_changer: false })) });
  };
  const info = await withFetch(stub, () => fetchCardInfo(names, { delayMs: 0 }));
  assert.deepEqual(sizes, [75, 5]);
  assert.equal(Object.keys(info).length, 80);
});

test('fetchCardInfo: failed batch is skipped, never throws', async () => {
  const names = Array.from({ length: 76 }, (_, i) => `Card ${i}`);
  let n = 0;
  const stub = async (_u, opts) => {
    if (n++ === 0) throw new Error('net');
    const ids = JSON.parse(opts.body).identifiers;
    return jsonRes({ data: ids.map((i) => ({ name: i.name, prices: {}, color_identity: [] })) });
  };
  const info = await withFetch(stub, () => fetchCardInfo(names, { delayMs: 0 }));
  assert.deepEqual(Object.keys(info), ['card 75']);
  assert.deepEqual(await withFetch(stub, () => fetchCardInfo([], { delayMs: 0 })), {});
});

test('searchCommanders: shapes first page, [] on failure', async () => {
  let url;
  const stub = async (u) => { url = u; return jsonRes({ data: collection.data }); };
  const res = await withFetch(stub, () => searchCommanders('ojer'));
  assert.match(decodeURIComponent(url), /q=is:commander \(ojer or t:ojer\)&order=edhrec/);
  assert.equal(res.length, collection.data.length);
  assert.deepEqual(Object.keys(res[0]), ['name', 'colorIdentity', 'image']);
  assert.deepEqual(await withFetch(async () => jsonRes({}, false), () => searchCommanders('x')), []);
  assert.deepEqual(await withFetch(async () => { throw new Error('x'); }, () => searchCommanders('x')), []);
});

test('fetchFlagSets: follows next_page, sets of front keys', async () => {
  const calls = [];
  const stub = async (u) => {
    calls.push(u);
    const q = decodeURIComponent(u);
    if (q.includes('is:gamechanger') && !q.includes('page2')) {
      return jsonRes({ has_more: true, next_page: 'https://api.scryfall.com/cards/search?page2=1&q=is:gamechanger', data: [{ name: 'Rhystic Study' }] });
    }
    if (q.includes('is:gamechanger')) return jsonRes({ has_more: false, data: [{ name: 'Ojer Axonil, Deepest Might // Temple of Power' }] });
    if (q.includes('otag:extra-turn')) return jsonRes({ data: [{ name: 'Time Warp' }] });
    if (q.includes('otag:tutor')) return jsonRes({ data: [{ name: 'Demonic Tutor' }] });
    if (q.includes('otag:rule-of-law')) return jsonRes({ data: [{ name: 'Rule of Law' }] });
    return jsonRes({ data: [{ name: 'Armageddon' }] });
  };
  const f = await withFetch(stub, () => fetchFlagSets({ delayMs: 0 }));
  assert.deepEqual([...f.gameChangers].sort(), ['ojer axonil, deepest might', 'rhystic study']);
  assert.deepEqual([...f.extraTurns], ['time warp']);
  assert.deepEqual([...f.massLandDenial], ['armageddon']);
  assert.ok(calls.some((u) => decodeURIComponent(u).includes('otag:mass-land-denial')));
  assert.deepEqual([...f.tutors], ['demonic tutor']);
  // Land tutors (Cultivate, Evolving Wilds) are ramp, not tutors: excluded from the query.
  assert.ok(calls.some((u) => decodeURIComponent(u).includes('otag:tutor -otag:tutor-land')));
  // No otag:stax exists on Scryfall: rule-of-law + cost-increaser stand in.
  assert.deepEqual([...f.stax], ['rule of law']);
  assert.ok(calls.some((u) => decodeURIComponent(u).includes('(otag:rule-of-law or otag:cost-increaser)')));
});

test('fetchFlagSets: a failed stax query alone → null', async () => {
  const stub = async (u) => (decodeURIComponent(u).includes('rule-of-law') ? jsonRes({}, false) : jsonRes({ data: [{ name: 'X' }] }));
  assert.equal(await withFetch(stub, () => fetchFlagSets({ delayMs: 0 })), null);
});

test('fetchFlagSets: a failed tutor query alone → null', async () => {
  const stub = async (u) => (decodeURIComponent(u).includes('otag:tutor') ? jsonRes({}, false) : jsonRes({ data: [{ name: 'X' }] }));
  assert.equal(await withFetch(stub, () => fetchFlagSets({ delayMs: 0 })), null);
});

test('fetchFlagSets: the tutor list follows has_more', async () => {
  const stub = async (u) => {
    const q = decodeURIComponent(u);
    if (q.includes('otag:tutor') && !q.includes('page2')) return jsonRes({ has_more: true, next_page: 'https://api.scryfall.com/cards/search?page2=1&q=otag:tutor', data: [{ name: 'Demonic Tutor' }] });
    if (q.includes('otag:tutor')) return jsonRes({ has_more: false, data: [{ name: 'Vampiric Tutor' }] });
    return jsonRes({ data: [] });
  };
  const f = await withFetch(stub, () => fetchFlagSets({ delayMs: 0 }));
  assert.deepEqual([...f.tutors].sort(), ['demonic tutor', 'vampiric tutor']);
});

test('fetchFlagSets: any failed query → null (no partial lists)', async () => {
  const stub = async (u) => (decodeURIComponent(u).includes('extra-turn') ? jsonRes({}, false) : jsonRes({ data: [{ name: 'X' }] }));
  assert.equal(await withFetch(stub, () => fetchFlagSets({ delayMs: 0 })), null);
});

test('resolveRequested: maps to requested keys, reports not_found, leaves unknowns out', () => {
  const json = {
    data: [{ name: 'Fire // Ice', prices: {}, color_identity: ['R', 'U'] }, { name: 'Rhystic Study', prices: {}, color_identity: ['U'] }],
    not_found: [{ name: 'Nope Card' }],
  };
  const res = resolveRequested(['Fire // Ice', 'rhystic study', 'Nope Card', 'Mystery'], json);
  assert.deepEqual(Object.keys(res.info).sort(), ['fire', 'rhystic study']);
  assert.deepEqual(res.notFound, ['nope card']);
});

test('fetchCardLookup: not_found reported; failed batch reports nothing', async () => {
  const ok = async () => jsonRes({ data: [{ name: 'A', prices: {}, color_identity: [] }], not_found: [{ name: 'B' }] });
  const res = await withFetch(ok, () => fetchCardLookup(['A', 'B'], { delayMs: 0 }));
  assert.deepEqual(Object.keys(res.info), ['a']);
  assert.deepEqual(res.notFound, ['b']);
  const bad = async () => { throw new Error('net'); };
  assert.deepEqual(await withFetch(bad, () => fetchCardLookup(['A', 'B'], { delayMs: 0 })), { info: {}, notFound: [] });
});

test('commanderQuery: single word also matches the type line, plurals singularised', () => {
  assert.equal(commanderQuery('Fairy'), 'is:commander (Fairy or t:Faerie)');
  assert.equal(commanderQuery('Faeries'), 'is:commander (Faeries or t:Faerie)');
  assert.equal(commanderQuery('Fairies'), 'is:commander (Fairies or t:Faerie)');
  assert.equal(commanderQuery('Zombies'), 'is:commander (Zombies or t:Zombie)');
  assert.equal(commanderQuery('elves'), 'is:commander (elves or t:Elf)');
  assert.equal(commanderQuery('  ojer '), 'is:commander (ojer or t:ojer)');
  assert.equal(commanderQuery('Ms. Bumbleflower'), 'is:commander Ms. Bumbleflower');
});

const landFixture = JSON.parse(readFileSync(new URL('../fixtures/scryfall_land_formula.json', import.meta.url)));

test('shapeCards: keeps cmc, oracle, layout, rarity, frontType (DFC faces joined, front type)', () => {
  const info = shapeCards(landFixture);
  const b = info.brainstorm;
  assert.equal(b.cmc, 1);
  assert.match(b.oracle, /^Draw three cards/);
  assert.equal(b.layout, 'normal');
  assert.equal(b.rarity, 'common');
  assert.equal(b.frontType, 'Instant');
  const m = info['malakir rebirth'];
  assert.equal(m.layout, 'modal_dfc');
  assert.equal(m.cmc, 1);
  assert.equal(m.frontType, 'Instant');
  assert.equal(m.typeLine, 'Instant // Land');
  assert.match(m.oracle, /Choose target creature[\s\S]*\n[\s\S]*Add \{B\}/);
  assert.equal(info['shatterskull smashing'].rarity, 'mythic');
});

test('fetchCardLookup: asks Scryfall by front face, keys the result by the requested name', async () => {
  let sent = null;
  const stub = async (_url, opts) => {
    sent = JSON.parse(opts.body).identifiers.map((i) => i.name);
    return { ok: true, json: async () => ({ data: [{ name: "Toralf, God of Fury // Toralf's Hammer", layout: 'modal_dfc', card_faces: [{ image_uris: { normal: 'img' } }] }], not_found: [] }) };
  };
  const res = await withFetch(stub, () => fetchCardLookup(["Toralf, God of Fury // Toralf's Hammer"], { delayMs: 0 }));
  assert.deepEqual(sent, ['Toralf, God of Fury']);
  assert.equal(res.info['toralf, god of fury'].image, 'img');
  assert.deepEqual(res.notFound, []);
});
