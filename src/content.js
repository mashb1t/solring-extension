// Content-script bootstrap. Loaded as a classic script; dynamically imports the
// ES-module logic (web-accessible). Detects page type, survives Moxfield's SPA
// navigation, and dispatches to the right renderer. Every pass is idempotent and
// guarded so exceptions never reach Moxfield's page.

(() => {
  const u = (p) => chrome.runtime.getURL(`src/${p}`);

  let mods = null;
  let lastUrl = location.href;

  async function load() {
    if (mods) return mods;
    const [moxfield, dom, renderDeck] = await Promise.all([
      import(u('moxfield.js')),
      import(u('dom.js')),
      import(u('render-deck.js')),
    ]);
    mods = { moxfield, dom, renderDeck };
    return mods;
  }

  // Wait (briefly) for an anchor Moxfield renders asynchronously.
  function waitFor(selector, timeout = 8000) {
    return new Promise((resolve) => {
      const found = document.querySelector(selector);
      if (found) return resolve(found);
      const obs = new MutationObserver(() => {
        const n = document.querySelector(selector);
        if (n) { obs.disconnect(); clearTimeout(t); resolve(n); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      const t = setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
    });
  }

  async function route() {
    const m = await load();
    const { moxfield, dom, renderDeck } = m;
    dom.guard('teardown', () => dom.teardown());
    const type = moxfield.pageType(location.href);
    if (type === 'deck') {
      await renderDeck.mount({ ...m, waitFor });
    }
    // 'user' / 'personal' renderers wired in later tasks.
  }

  function onNavigate() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    schedule();
  }

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => route().catch((e) => console.warn('[solring] route failed', e)), 150);
  }

  // SPA navigation detection: patch history + popstate + a coarse href poll.
  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function patched(...args) {
      const r = orig.apply(this, args);
      window.dispatchEvent(new Event('solring:navigate'));
      return r;
    };
  }
  window.addEventListener('popstate', onNavigate);
  window.addEventListener('solring:navigate', onNavigate);
  setInterval(onNavigate, 1000);

  schedule();
})();
