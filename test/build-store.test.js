import { test } from 'node:test';
import assert from 'node:assert/strict';

// In-memory chrome.storage.local with a slow get(), so concurrent read-modify-writes interleave.
function makeChrome() {
  const store = {};
  const local = {
    get: async (key) => {
      const snap = typeof key === 'string' && key in store ? { [key]: structuredClone(store[key]) } : {};
      await new Promise((r) => setTimeout(r, 5));
      return snap;
    },
    set: async (obj) => { Object.assign(store, structuredClone(obj)); },
    remove: async (key) => { delete store[key]; },
  };
  return { store, chrome: { storage: { local, onChanged: { addListener() {} } } } };
}

async function load() {
  const { store, chrome } = makeChrome();
  global.chrome = chrome;
  const mod = await import('../src/build-store.js');
  const { RULES_DEFAULT } = await import('../src/build-rules.js');
  return { store, RULES_DEFAULT, ...mod };
}

test('unknown deck returns defaults', async () => {
  const { getDeckBuild, RULES_DEFAULT } = await load();
  assert.deepEqual(await getDeckBuild('nope'), { theme: null, rules: RULES_DEFAULT });
});

test('set then get merges rules over defaults', async () => {
  const { getDeckBuild, setDeckBuild, RULES_DEFAULT } = await load();
  await setDeckBuild('d1', { theme: 'tokens', rules: { budget: 100 } });
  await setDeckBuild('d1', { rules: { ownedOnly: true } });
  const b = await getDeckBuild('d1');
  assert.equal(b.theme, 'tokens');
  assert.deepEqual(b.rules, { ...RULES_DEFAULT, budget: 100, ownedOnly: true });
});

test('rules stored before the tutor / land-hate / stax keys get their defaults; a GC cap can be cleared', async () => {
  const { getDeckBuild, setDeckBuild, store } = await load();
  store['build:old'] = { theme: null, rules: { bracket: 4, gameChangerCap: 2, power: null, budget: null, ownedOnly: false } };
  const b = await getDeckBuild('old');
  assert.equal(b.rules.tutorCap, null);
  assert.equal(b.rules.noLandHate, false);
  assert.equal(b.rules.noStax, false);
  assert.equal(b.rules.gameChangerCap, 2);
  await setDeckBuild('old', { rules: { gameChangerCap: null } });
  assert.equal((await getDeckBuild('old')).rules.gameChangerCap, null);
});

test('concurrent setDeckBuild patches do not clobber each other', async () => {
  const { getDeckBuild, setDeckBuild } = await load();
  await Promise.all([
    setDeckBuild('d2', { rules: { budget: 50 } }),
    setDeckBuild('d2', { rules: { power: 7 } }),
    setDeckBuild('d2', { theme: 'x' }),
  ]);
  const b = await getDeckBuild('d2');
  assert.equal(b.rules.budget, 50);
  assert.equal(b.rules.power, 7);
  assert.equal(b.theme, 'x');
});

test('takePendingBuild returns once then null, and removes the key', async () => {
  const { setPendingBuild, takePendingBuild, store } = await load();
  await setPendingBuild({ commanders: ['A', 'B'], theme: 't' });
  assert.deepEqual(await takePendingBuild(), { commanders: ['A', 'B'], theme: 't' });
  assert.equal(await takePendingBuild(), null);
  assert.equal('build:pending' in store, false);
});

test('pending older than 10 minutes is ignored and removed', async () => {
  const { setPendingBuild, takePendingBuild, store } = await load();
  await setPendingBuild({ commanders: ['A'], theme: null });
  store['build:pending'].at -= 10 * 60 * 1000 + 1;
  assert.equal(await takePendingBuild(), null);
  assert.equal('build:pending' in store, false);
});

test('peekPendingBuild reads without consuming; stale reads as null', async () => {
  const { setPendingBuild, peekPendingBuild, takePendingBuild, store } = await load();
  assert.equal(await peekPendingBuild(), null);
  await setPendingBuild({ commanders: ['A'], theme: 't' });
  assert.deepEqual(await peekPendingBuild(), { commanders: ['A'], theme: 't' });
  assert.equal('build:pending' in store, true);
  assert.deepEqual(await takePendingBuild(), { commanders: ['A'], theme: 't' });
  await setPendingBuild({ commanders: ['A'], theme: 't' });
  store['build:pending'].at -= 10 * 60 * 1000 + 1;
  assert.equal(await peekPendingBuild(), null);
});
