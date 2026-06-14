// Content-script bootstrap. Loaded as a classic script that dynamically imports
// the web-accessible ES-module logic. Detects page type, survives Moxfield's SPA
// navigation, and dispatches to the right renderer. Every pass is idempotent and
// guarded so exceptions never reach Moxfield's page.

(() => {
  const u = (p) => chrome.runtime.getURL(`src/${p}`);

  let mods = null;
  let lastUrl = location.href;

  async function load() {
    if (mods) return mods;
    const [moxfield, dom, renderDeck, decklist, wideLayout, renderUser, sync] = await Promise.all([
      import(u('moxfield.js')),
      import(u('dom.js')),
      import(u('render-deck.js')),
      import(u('decklist.js')),
      import(u('wide-layout.js')),
      import(u('render-user.js')),
      import(u('sync.js')),
    ]);
    mods = { moxfield, dom, renderDeck, decklist, wideLayout, renderUser, sync };
    return mods;
  }

  // The username whose decks a list page shows. On /users/{name} it comes from the
  // URL. On /decks/personal it is the logged-in user, read best-effort from a profile
  // link in the page chrome. LIVE-VERIFY: confirm the navbar profile-link selector when
  // logged in (the personal route stays inert until a username resolves).
  function listUsername(moxfield) {
    if (moxfield.pageType(location.href) === 'user') return moxfield.parseUsername(location.href);
    const link = document.querySelector('header a[href^="/users/"], nav a[href^="/users/"]');
    return link ? moxfield.parseUsername(link.href) : null;
  }

  // Wait briefly for an anchor Moxfield renders asynchronously.
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
    const { moxfield, dom, renderDeck, decklist, wideLayout, renderUser, sync } = m;
    wideLayout.installWideToggle(); // idempotent global header toggle, applies on every page
    dom.guard('teardown', () => dom.teardown());
    decklist.teardownDeckList(); // drop any prior list observer/state on every nav
    renderUser.teardownUserAverages(); // and the profile-averages card
    sync.teardownSync(); // and the bulk-sync controls
    const type = moxfield.pageType(location.href);
    if (type === 'deck') {
      await renderDeck.mount({ ...m, waitFor });
    } else if (type === 'user' || type === 'personal') {
      let username = listUsername(moxfield);
      // On a fresh /decks/personal load the header (and its profile link) may not be
      // rendered yet when route() runs, so wait for it rather than giving up silently.
      if (!username && type === 'personal') {
        const link = await waitFor('header a[href^="/users/"], nav a[href^="/users/"]');
        if (link) username = moxfield.parseUsername(link.href);
      }
      if (username) {
        await decklist.installDeckList(username, { waitFor });
        sync.installSync(username); // Analyze all / Re-analyze all controls
      }
      if (type === 'user') renderUser.installUserAverages(); // profile-sidebar averages
    }
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

  // Detect SPA navigation via patched history methods, popstate, and a coarse href poll.
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
