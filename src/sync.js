// Bulk analysis for the deck-list pages. Injects a "Stats" dropdown (Fetch all, Fetch
// uncached, Analyze all) plus a status/last-analyzed label into the deck-list toolbar
// next to Moxfield's Sort. Operates on the decks currently rendered in the list
// (decklist.getEntries), minus private ones, which CommanderSalt can't read.
// Sequential and throttled, one request per deck, never retried, cancelable. Updates
// each row and the averages as it goes. Verb mirrors the single-deck panel ("Analyze",
// "Analyze", "analyzed X ago").

import { el, guard, installOutsideClose, registerDisposable } from './dom.js';
import { relTime } from './format.js';
import { canonicalDeckUrl } from './md5.js';
import { getDeck, importDeck } from './messaging.js';
import { getEntries, isCached, hasDeckListTable, onDeckListChange, setFull, setRowSpinning } from './decklist.js';
import { getSync, setSync } from './cache.js';

const THROTTLE_MS = 400; // breathing room so we don't hammer the API

let username = null;
let active = false; // on a deck-list page
let running = false;
let cancelFlag = false; // per-run: user hit Cancel
let runId = 0; // monotonic run token; SPA nav bumps it to invalidate an in-flight run
let wired = false;
let raf = null;
let controls = null; // { wrap, analyzeBtn, cancelBtn, status }

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Unique rendered decks, excluding private ones whose analyses aren't readable.
function syncableEntries() {
  return getEntries().filter((e) => !(e.hit && e.hit.isPrivate));
}

function setBusy(on) {
  if (!controls) return;
  controls.analyzeBtn.disabled = on;
  controls.cancelBtn.toggleAttribute('hidden', !on);
  if (on) closeAnalyzeMenu(controls.wrap); // can't re-trigger or re-scope mid-run
}

async function refreshStatus() {
  if (!controls || running || !username) return;
  const s = await getSync(username);
  if (!controls || running) return; // controls may have been torn down (SPA nav), or a run started during the await
  controls.status.textContent = s && s.at ? `analyzed ${relTime(s.at)}` : '';
}

// Analyze all = warm the cache via GET (un-indexed decks get a first POST import).
// Analyze uncached = same, but only decks with no analysis loaded yet (skip cached).
// Analyze all = force a fresh POST analysis of every deck (confirm-gated).
async function run({ force = false, uncachedOnly = false }) {
  if (running) return;
  running = true;
  cancelFlag = false;
  const me = ++runId; // this run's token; a later installSync/teardownSync bumps runId to invalidate us
  const user = username; // capture now so late results attribute to the right user, even if username is reassigned
  setBusy(true);
  let entries = syncableEntries();
  if (uncachedOnly) entries = entries.filter((e) => !isCached(e.md5));
  if (!entries.length) {
    running = false;
    setBusy(false);
    if (controls && me === runId) controls.status.textContent = uncachedOnly ? 'All listed decks already analyzed' : 'No analyzable decks';
    return;
  }
  let done = 0;
  let failed = 0;
  for (const e of entries) {
    if (cancelFlag || me !== runId) break;
    if (controls && me === runId) controls.status.textContent = `${force ? 'Recalculating' : 'Fetching'} ${done + 1}/${entries.length}…`;
    setRowSpinning(e.md5, true); // spin this deck's per-row glyph while it's processing
    try {
      let res;
      if (force) {
        res = await importDeck(canonicalDeckUrl(e.publicId), e.md5, e.md5); // POST analysis
        if (me !== runId) return; // navigated away mid-flight: abandon silently
      } else {
        res = await getDeck(e.md5, { allowFetch: true }); // GET, warm cache
        if (me !== runId) return; // navigated away mid-flight: abandon silently
        if (res && res.stub) {
          res = await importDeck(canonicalDeckUrl(e.publicId), e.md5); // un-indexed, first import
          if (me !== runId) return; // navigated away mid-flight: abandon silently
        }
      }
      if (res && res.fields) setFull(e.md5, res.fields); // update the row and averages
      else failed += 1; // stub, unanalyzable, error, or miss
    } catch (err) {
      if (me !== runId) return; // navigated away during the await that threw: abandon silently
      failed += 1;
      console.warn('[solring] sync failed for', e.publicId, err);
    }
    setRowSpinning(e.md5, false); // stop (a successful scan already rerendered it un-spun)
    done += 1;
    if (cancelFlag || me !== runId) break;
    await delay(THROTTLE_MS);
  }
  if (me !== runId) return; // superseded run: don't write status/sync for a page that's gone
  running = false;
  setBusy(false);
  await setSync(user, { at: Date.now() });
  if (controls) {
    const ok = done - failed;
    controls.status.textContent = `${cancelFlag ? 'Cancelled' : 'Done'} · ${ok}/${entries.length} ok${failed ? ` · ${failed} failed` : ''}`;
  }
}

// A bar-chart "stats" glyph, sized like the Stats button's leading icon. Mirrors the
// Columns button's columnsIcon (outline style, currentColor, 1em, trailing margin).
function statIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'svg-inline--fa me-1');
  svg.setAttribute('width', '1em');
  svg.setAttribute('height', '1em');
  // three rising bars
  for (const [x, y, h] of [['4', '13', '7'], ['10', '9', '11'], ['16', '5', '15']]) {
    const r = document.createElementNS(NS, 'rect');
    for (const [k, v] of [['x', x], ['y', y], ['width', '3'], ['height', h], ['rx', '0.5']]) r.setAttribute(k, v);
    r.setAttribute('stroke', 'currentColor');
    r.setAttribute('stroke-width', '2');
    svg.appendChild(r);
  }
  return svg;
}

// The three bulk scopes the "Stats" dropdown offers. Fetch retrieves CommanderSalt's
// existing analysis (cheap GET). Analyze forces a fresh upstream recompute (POST,
// confirm-gated). Each runs the same engine with different flags.
const ANALYZE_ACTIONS = [
  { label: 'Fetch all', title: 'Fetch stats for every listed (non-private) deck', go: () => run({ force: false }) },
  { label: 'Fetch uncached', title: 'Fetch stats only for listed decks not already loaded', go: () => run({ force: false, uncachedOnly: true }) },
  {
    label: 'Analyze all',
    title: 'Force CommanderSalt to recompute every listed (non-private) deck from scratch',
    go: () => {
      const n = syncableEntries().length;
      // eslint-disable-next-line no-alert
      if (window.confirm(`Analyze all ${n} listed deck${n === 1 ? '' : 's'}? This sends one analysis request per deck and can take a while.`)) run({ force: true });
    },
  },
];

function closeAnalyzeMenu(scope) {
  const menu = scope && scope.querySelector('.dropdown-menu');
  const btn = scope && scope.querySelector('.solring-analyze-btn');
  if (menu) menu.classList.remove('show');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}
function toggleAnalyzeMenu(dropdown) {
  const menu = dropdown.querySelector('.dropdown-menu');
  const btn = dropdown.querySelector('.solring-analyze-btn');
  const show = !menu.classList.contains('show');
  document.querySelectorAll('.solring-analyze .dropdown-menu.show').forEach((m) => { if (m !== menu) m.classList.remove('show'); });
  menu.classList.toggle('show', show);
  if (btn) btn.setAttribute('aria-expanded', String(show));
}

function buildControls(btnClass) {
  const status = el('span', { class: 'solring-sync-status' });

  const menu = el('div', { class: 'dropdown-menu' });
  for (const a of ANALYZE_ACTIONS) {
    const item = el('button', { class: 'dropdown-item solring-sync-item', attrs: { type: 'button', title: a.title } }, [a.label]);
    item.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeAnalyzeMenu(dropdown); a.go(); });
    menu.append(item);
  }
  const analyzeBtn = el('button', {
    class: `${btnClass} solring-sync-btn solring-analyze-btn`,
    attrs: { type: 'button', title: 'Fetch CommanderSalt stats for the listed decks', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
  }, [el('span', {}, [statIcon(), 'Stats'])]);
  // No stopPropagation: let the click reach Moxfield's React outside-click handler so
  // opening Stats closes the Sort menu. Our own menu stays open because the capture-phase
  // closer skips clicks inside .solring-analyze.
  analyzeBtn.addEventListener('click', (e) => { e.preventDefault(); toggleAnalyzeMenu(dropdown); });
  const dropdown = el('div', { class: 'solring-analyze' }, [analyzeBtn, menu]);

  const cancelBtn = el('button', {
    class: `${btnClass} solring-sync-btn solring-sync-cancel`,
    attrs: { type: 'button', hidden: '' },
  }, ['Cancel']);
  cancelBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); cancelFlag = true; });

  const wrap = el('div', { class: 'solring-sync', attrs: { 'data-solring-root': '' } }, [status, dropdown, cancelBtn]);
  controls = { wrap, analyzeBtn, cancelBtn, status };
  installOutsideClose('.solring-analyze', closeAnalyzeMenu);
  refreshStatus();
  return wrap;
}

function ensureControls() {
  raf = null;
  if (!active) return;
  // Only where a deck-list table is actually shown, never on image/grid browse pages
  // (/decks/public, /liked, /private, ...), which carry a Sort button but no deck table.
  if (!hasDeckListTable()) { document.querySelectorAll('.solring-sync').forEach((n) => n.remove()); controls = null; return; }
  const sortBtn = [...document.querySelectorAll('button')].find((b) => /^\s*Sort\s*$/i.test((b.textContent || '').trim()) && !b.closest('.solring-colmenu'));
  const toolbar = sortBtn && sortBtn.parentElement;
  if (!toolbar || toolbar.querySelector(':scope > .solring-sync')) return;
  // Land before the Stats-columns menu when it's already in place, so the toolbar order
  // is deterministically [Analyze all, Analyze all] [Stats] [Sort] on every page,
  // not dependent on which of us won the insert race (else Stats can slip ahead on
  // /users/{name}). If the menu hasn't injected yet, inserting before Sort works: the
  // menu then inserts before Sort too, landing after us.
  const anchor = toolbar.querySelector(':scope > .solring-colmenu') || sortBtn;
  toolbar.insertBefore(buildControls(sortBtn.className), anchor);
}
function schedule() {
  if (raf) return;
  raf = requestAnimationFrame(() => guard('sync controls', ensureControls));
}

/** Install the bulk-sync controls for `username` on a deck-list page. */
export function installSync(user) {
  username = user;
  active = true;
  if (!wired) {
    wired = true;
    const off = onDeckListChange(() => { schedule(); refreshStatus(); }); // re-inject and tick the timestamp
    const obs = new MutationObserver(() => schedule());
    obs.observe(document.body, { childList: true, subtree: true });
    // Router drains this on nav: disconnect the body observer, drop the deck-list
    // subscription, and reset the once-guard so a later list page re-wires cleanly.
    registerDisposable(() => { obs.disconnect(); off(); wired = false; });
  }
  schedule();
}

/** Remove the controls (SPA nav away). A run in progress is cancelled. */
export function teardownSync() {
  active = false;
  runId += 1; // invalidate any in-flight run so it abandons silently
  running = false; // free the lock so a fresh scan on the next page isn't blocked by a stuck await
  controls = null;
  document.querySelectorAll('.solring-sync').forEach((n) => n.remove());
}
