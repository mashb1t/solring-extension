import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setEntry, evictOldestCache, isFresh, SCHEMA_VERSION, recordPowerPoint, getPowerHistory, POWER_HISTORY_CAP } from '../src/cache.js';

// Minimal in-memory chrome.storage.local with a byte quota (JSON length as a proxy).
// set() rejects with a quota error once the store would exceed the cap, like Chrome.
function makeChrome(quotaBytes, seed = {}) {
  const store = { ...seed };
  const local = {
    get: async (keys) => {
      if (keys == null) return { ...store };
      if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {};
      const out = {}; for (const k of keys) if (k in store) out[k] = store[k]; return out;
    },
    set: async (obj) => {
      const next = { ...store, ...obj };
      if (JSON.stringify(next).length > quotaBytes) throw new Error('QUOTA_BYTES quota exceeded');
      Object.assign(store, obj);
    },
    remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
    getBytesInUse: async () => JSON.stringify(store).length,
  };
  return { store, chrome: { storage: { local } } };
}

const big = (n) => 'x'.repeat(n);
const seedDecks = (count, size) => {
  const s = {};
  for (let i = 1; i <= count; i += 1) s[`deck:${i}`] = { fetchedAt: i * 100, data: big(size) };
  s['prefs:keep'] = { value: 'settings' }; // not a cache key → must survive eviction
  return s;
};

test('setEntry persists normally when there is room', async () => {
  const { store, chrome } = makeChrome(1e6);
  global.chrome = chrome;
  const e = await setEntry('deck:abc', { power: 8 });
  assert.equal(store['deck:abc'].data.power, 8);
  assert.equal(typeof e.fetchedAt, 'number');
});

test('setEntry stamps the current SCHEMA_VERSION', async () => {
  const { store, chrome } = makeChrome(1e6);
  global.chrome = chrome;
  await setEntry('deck:ver', { power: 8 });
  assert.equal(store['deck:ver'].v, SCHEMA_VERSION);
});

test('isFresh: schema-stale (old/missing v) entries are not fresh, even when recent', () => {
  const now = Date.now();
  assert.ok(isFresh({ v: SCHEMA_VERSION, fetchedAt: now, data: {} }), 'current version + recent → fresh');
  assert.ok(!isFresh({ v: SCHEMA_VERSION - 1, fetchedAt: now, data: {} }), 'older version → stale (backfills new fields)');
  assert.ok(!isFresh({ fetchedAt: now, data: {} }), 'unversioned (pre-guard) entry → stale');
  assert.ok(!isFresh({ v: SCHEMA_VERSION, fetchedAt: 0, data: {} }), 'current version but past TTL → stale');
});

test('setEntry evicts the oldest cached analyses + retries when storage is full', async () => {
  const seed = seedDecks(8, 200);
  const { store, chrome } = makeChrome(JSON.stringify(seed).length, seed); // exactly full
  global.chrome = chrome;
  await setEntry('deck:new', big(200)); // over quota → evict 25% (oldest 2) → retry succeeds
  assert.ok(store['deck:new'], 'new entry persisted after eviction');
  assert.ok(!store['deck:1'] && !store['deck:2'], 'two oldest cache entries evicted');
  assert.ok(store['deck:8'], 'newer cache entries kept');
  assert.ok(store['prefs:keep'], 'non-cache (prefs) entries never evicted');
});

test('setEntry degrades gracefully (no throw) when even eviction cannot free enough', async () => {
  const { store, chrome } = makeChrome(10, {}); // quota too small for any real entry
  global.chrome = chrome;
  const e = await setEntry('deck:huge', big(500)); // can never fit
  assert.equal(typeof e.fetchedAt, 'number'); // returns the entry (caller keeps fields)
  assert.ok(!store['deck:huge'], 'not persisted, but no rejection');
});

test('evictOldestCache removes the oldest fraction, cache keys only', async () => {
  const seed = seedDecks(4, 50);
  const { store, chrome } = makeChrome(1e6, seed);
  global.chrome = chrome;
  const n = await evictOldestCache(0.5); // drop oldest 2 of 4
  assert.equal(n, 2);
  assert.ok(!store['deck:1'] && !store['deck:2']);
  assert.ok(store['deck:3'] && store['deck:4'] && store['prefs:keep']);
});

test('isFreshTtl ignores schema version, gates on age only', async () => {
  const { isFreshTtl } = await import('../src/cache.js');
  const now = Date.now();
  assert.equal(isFreshTtl({ v: 1, fetchedAt: now }, 1000), true);         // stale schema, fresh age
  assert.equal(isFreshTtl({ v: 999, fetchedAt: now - 5000 }, 1000), false); // too old
  assert.equal(isFreshTtl(null, 1000), false);
});

test('recordPowerPoint appends one point per distinct analysis (dedup by analyzedAt)', async () => {
  const { store, chrome } = makeChrome(1e6);
  global.chrome = chrome;
  await recordPowerPoint('m1', { analyzedAt: 1000, power: 6.1, bracketRealistic: 3 });
  await recordPowerPoint('m1', { analyzedAt: 1000, power: 6.1, bracketRealistic: 3 }); // same analysis → no dup
  let hist = await getPowerHistory('m1');
  assert.equal(hist.length, 1);
  assert.deepEqual(hist[0], { at: 1000, power: 6.1, bracket: 3 });
  await recordPowerPoint('m1', { analyzedAt: 2000, power: 6.8, bracketRealistic: 4 }); // re-analysis → new point
  hist = await getPowerHistory('m1');
  assert.equal(hist.length, 2);
  assert.deepEqual(hist.map((p) => p.power), [6.1, 6.8]);
});

test('recordPowerPoint sorts ascending by analyzedAt and caps length', async () => {
  const { chrome } = makeChrome(1e7);
  global.chrome = chrome;
  // insert out of order + more than the cap
  for (let i = POWER_HISTORY_CAP + 20; i >= 1; i -= 1) {
    await recordPowerPoint('m2', { analyzedAt: i * 10, power: 5, bracketRealistic: 3 });
  }
  const hist = await getPowerHistory('m2');
  assert.equal(hist.length, POWER_HISTORY_CAP);            // capped
  for (let i = 1; i < hist.length; i += 1) assert.ok(hist[i - 1].at < hist[i].at); // ascending
});

test('recordPowerPoint ignores entries with no analyzedAt or no power', async () => {
  const { chrome } = makeChrome(1e6);
  global.chrome = chrome;
  await recordPowerPoint('m3', { power: 6 });                       // no analyzedAt
  await recordPowerPoint('m3', { analyzedAt: 100 });                // no power
  await recordPowerPoint('', { analyzedAt: 100, power: 6 });        // no md5
  assert.equal((await getPowerHistory('m3')).length, 0);
});
