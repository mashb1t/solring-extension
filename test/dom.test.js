import { test } from 'node:test';
import assert from 'node:assert/strict';

// dom.js is pure (no chrome), but el()/isDark touch document/window at call time only.
// registerDisposable/disposeAll touch neither, so no stubs are needed for this suite.
const { registerDisposable, disposeAll } = await import('../src/dom.js');

test('disposeAll runs every registered disposer once, tolerates throwers, then clears', () => {
  let a = 0; let b = 0;
  registerDisposable(() => { a += 1; });
  registerDisposable(() => { throw new Error('boom'); });
  registerDisposable(() => { b += 1; });
  disposeAll();
  disposeAll(); // second drain is a no-op (registry already emptied)
  assert.equal(a, 1);
  assert.equal(b, 1);
});
