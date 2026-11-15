import { test } from 'node:test';
import assert from 'node:assert/strict';

// chrome.storage.local stub whose get() is artificially slow, so two concurrent
// read-modify-write setters interleave — the classic lost-update the queue must prevent.
function makeChrome() {
  const store = {};
  const local = {
    get: async (key) => {
      // Snapshot at call time, resolve later: both concurrent setters capture the
      // pre-write store, so a naive read-modify-write loses one patch. A serialized
      // queue defers the second read until the first write lands.
      const snap = key in store ? { [key]: { ...store[key] } } : {};
      await new Promise((r) => setTimeout(r, 10));
      return snap;
    },
    set: async (obj) => { Object.assign(store, obj); },
  };
  return { store, chrome: { storage: { local, onChanged: { addListener() {} } } } };
}

test('concurrent setCardPrefs patches do not clobber each other', async () => {
  const { store, chrome } = makeChrome();
  global.chrome = chrome;
  const { setCardPrefs } = await import('../src/prefs.js');
  // Both fields default to false; each setter flips a different one. Without a write
  // queue the two read-modify-writes both read the (false,false) base and the last
  // write wins, reverting the other flip — so one field ends up lost.
  await Promise.all([setCardPrefs({ synergy: true }), setCardPrefs({ tags: true })]);
  const saved = store['prefs:cardData'];
  assert.equal(saved.synergy, true); // first patch survived
  assert.equal(saved.tags, true); // second patch survived (not lost to a stale read)
});

test('setOptions deep-merges sources: patching one source preserves the others', async () => {
  const { store, chrome } = makeChrome();
  global.chrome = chrome;
  const { setOptions, getOptions } = await import('../src/prefs.js');
  await setOptions({ sources: { edhrec: true, spellbook: true } });
  await setOptions({ sources: { edhrec: false } });
  const o = await getOptions();
  assert.equal(o.sources.edhrec, false);
  assert.equal(o.sources.spellbook, true); // sibling preserved, not dropped
});

test('getOptions: builder / picker / cuts settings default on, builder panel auto', async () => {
  const { chrome } = makeChrome();
  global.chrome = chrome;
  const { getOptions } = await import('../src/prefs.js');
  const o = await getOptions();
  assert.equal(o.builderEnabled, true);
  assert.equal(o.statsEnabled, true);
  assert.equal(o.builderPanelDefault, 'auto');
  assert.equal(o.pickerEnabled, true);
  assert.equal(o.cutsEnabled, true);
});

test('setOptions: new builder keys persist and merge with stored options', async () => {
  const { store, chrome } = makeChrome();
  global.chrome = chrome;
  // An options blob saved before these keys existed keeps its values and gains the defaults.
  store['prefs:options'] = { autoFetch: false, sources: { spellbook: false } };
  const { setOptions, getOptions } = await import('../src/prefs.js');
  let o = await getOptions();
  assert.equal(o.autoFetch, false);
  assert.equal(o.builderEnabled, true);
  assert.equal(o.sources.edhrec, true);
  await setOptions({ builderEnabled: false, builderPanelDefault: 'collapsed' });
  await setOptions({ pickerEnabled: false });
  o = await getOptions();
  assert.equal(o.builderEnabled, false);
  assert.equal(o.builderPanelDefault, 'collapsed');
  assert.equal(o.pickerEnabled, false);
  assert.equal(o.cutsEnabled, true);
  assert.equal(o.autoFetch, false); // unrelated stored value untouched
  assert.equal(o.sources.spellbook, false);
});
