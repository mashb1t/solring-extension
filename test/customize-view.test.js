import { test } from 'node:test';
import assert from 'node:assert/strict';

// customize-view.js imports prefs.js, which reads chrome.storage. Stub it before the
// dynamic import (mirrors the chrome stub pattern in cache.test.js).
global.chrome = {
  storage: {
    local: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener: () => {} },
  },
};

// Minimal DOM stub: a "group" with the querySelector/append/dataset semantics
// injectInto touches. append pushes real-ish nodes; querySelector finds our sentinel.
function fakeGroup() {
  const children = [];
  return {
    children,
    dataset: {},
    querySelector: (sel) => (sel === '.solring-cv' && children.length ? children[0] : null),
    append: (...nodes) => children.push(...nodes),
  };
}

test('injectInto is race-safe: two concurrent calls append toggles once', async () => {
  // el() from dom.js calls document.createElement; provide a bare stub.
  global.document = { createElement: () => ({ className: '', append() {}, addEventListener() {}, setAttribute() {} }) };
  const { injectInto } = await import('../src/customize-view.js');
  const group = fakeGroup();
  await Promise.all([injectInto(group), injectInto(group)]);
  // 4 toggles (power, saltValue, synergies, tags), not 8.
  assert.equal(group.children.length, 4);
});
