// Bulk analysis for the deck-list pages. Injects a "Stats" dropdown (Fetch all / Fetch
// uncached / Re-analyze all) + a status/last-analyzed label into the deck-list toolbar
// (next to Moxfield's Sort). Operates on the decks currently rendered in the
// list (decklist.getEntries), minus private ones (CommanderSalt can't read those).
// Sequential + throttled; one request per deck, never retried; cancelable; updates each
// row + the averages as it goes. Verb mirrors the single-deck panel ("Analyze" /
// "Re-analyze" / "analyzed X ago").

import { el, guard } from './dom.js';
import { canonicalDeckUrl } from './md5.js';
import { getDeck, importDeck } from './messaging.js';
import { getEntries, isCached, onDeckListChange, setFull, setRowSpinning } from './decklist.js';
import { getSync, setSync } from './cache.js';

const THROTTLE_MS = 400; // breathing room between requests, so we don't hammer the API

let username = null;
let active = false; // on a deck-list page
let running = false;
let cancelFlag = false;
let wired = false;
let raf = null;
let controls = null; // { wrap, analyzeBtn, cancelBtn, status }

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function relTime(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

// Unique rendered decks, excluding private (their analyses aren't readable).
function syncableEntries() {
  return getEntries().filter((e) => !(e.hit && e.hit.isPrivate));
}

function setBusy(on) {
  if (!controls) return;
  controls.analyzeBtn.disabled = on;
  controls.cancelBtn.toggleAttribute('hidden', !on);
  if (on) closeAnalyzeMenu(controls.wrap); // can't re-trigger / re-scope mid-run
}

async function refreshStatus() {
  if (!controls || running || !username) return;
  const s = await getSync(username);
  if (!controls || running) return; // controls may have been torn down (SPA nav) or a run started during the await
  controls.status.textContent = s && s.at ? `analyzed ${relTime(s.at)}` : '';
}

// Analyze all = warm the cache (GET; un-indexed decks get a first POST import).
// Analyze uncached = same, but only decks with no analysis loaded yet (skip cached).
// Re-analyze all = force a fresh POST re-analysis of every deck (confirm-gated).
async function run({ force = false, uncachedOnly = false }) {
  if (running) return;
  running = true;
  cancelFlag = false;
  setBusy(true);
  let entries = syncableEntries();
  if (uncachedOnly) entries = entries.filter((e) => !isCached(e.md5));
  if (!entries.length) {
    running = false;
    setBusy(false);
    if (controls) controls.status.textContent = uncachedOnly ? 'All listed decks already analyzed' : 'No analyzable decks';
    return;
  }
  let done = 0;
  let failed = 0;
  for (const e of entries) {
    if (cancelFlag) break;
    if (controls) controls.status.textContent = `${force ? 'Re-analyzing' : 'Fetching'} ${done + 1}/${entries.length}…`;
    setRowSpinning(e.md5, true); // spin this deck's per-row ↻ while it's processing
    try {
      let res;
      if (force) {
        res = await importDeck(canonicalDeckUrl(e.publicId), e.md5, e.md5); // POST re-analysis
      } else {
        res = await getDeck(e.md5, { allowFetch: true }); // GET / warm cache
        if (res && res.stub) res = await importDeck(canonicalDeckUrl(e.publicId), e.md5); // un-indexed → first import
      }
      if (res && res.fields) setFull(e.md5, res.fields); // update the row + averages
      else failed += 1; // stub / unanalyzable / error / miss
    } catch (err) {
      failed += 1;
      console.warn('[solring] sync failed for', e.publicId, err);
    }
    setRowSpinning(e.md5, false); // stop (a successful scan already rerendered it un-spun)
    done += 1;
    if (!cancelFlag) await delay(THROTTLE_MS);
  }
  running = false;
  setBusy(false);
  await setSync(username, { at: Date.now() });
  if (controls) {
    const ok = done - failed;
    controls.status.textContent = `${cancelFlag ? 'Cancelled' : 'Done'} · ${ok}/${entries.length} ok${failed ? ` · ${failed} failed` : ''}`;
  }
}

// A trailing down-caret, sized to sit after the button label (marks it a dropdown).
function caretIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'svg-inline--fa ms-1');
  svg.setAttribute('width', '0.8em');
  svg.setAttribute('height', '0.8em');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M6 9l6 6 6-6');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(p);
  return svg;
}

// The three bulk scopes the "Stats" dropdown offers. Fetch = retrieve CommanderSalt's
// existing analysis (cheap GET); Re-analyze = force a fresh upstream recompute (POST,
// confirm-gated). Each runs the same engine with different flags.
const ANALYZE_ACTIONS = [
  { label: 'Fetch all', title: 'Fetch stats for every listed (non-private) deck', go: () => run({ force: false }) },
  { label: 'Fetch uncached', title: 'Fetch stats only for listed decks not already loaded', go: () => run({ force: false, uncachedOnly: true }) },
  {
    label: 'Re-analyze all',
    title: 'Force a fresh re-analysis (recompute) of every listed (non-private) deck',
    go: () => {
      const n = syncableEntries().length;
      // eslint-disable-next-line no-alert
      if (window.confirm(`Re-analyze all ${n} listed deck${n === 1 ? '' : 's'}? This sends one analysis request per deck and can take a while.`)) run({ force: true });
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
let analyzeCloseInstalled = false;
function installAnalyzeOutsideClose() {
  if (analyzeCloseInstalled) return;
  analyzeCloseInstalled = true;
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.solring-analyze').forEach((dd) => { if (!dd.contains(e.target)) closeAnalyzeMenu(dd); });
  });
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
  }, [el('span', {}, ['Stats']), caretIcon()]);
  analyzeBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleAnalyzeMenu(dropdown); });
  const dropdown = el('div', { class: 'solring-analyze' }, [analyzeBtn, menu]);

  const cancelBtn = el('button', {
    class: `${btnClass} solring-sync-btn solring-sync-cancel`,
    attrs: { type: 'button', hidden: '' },
  }, ['Cancel']);
  cancelBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); cancelFlag = true; });

  const wrap = el('div', { class: 'solring-sync', attrs: { 'data-solring-root': '' } }, [status, dropdown, cancelBtn]);
  controls = { wrap, analyzeBtn, cancelBtn, status };
  installAnalyzeOutsideClose();
  refreshStatus();
  return wrap;
}

function ensureControls() {
  raf = null;
  if (!active) return;
  const sortBtn = [...document.querySelectorAll('button')].find((b) => /^\s*Sort\s*$/i.test((b.textContent || '').trim()) && !b.closest('.solring-colmenu'));
  const toolbar = sortBtn && sortBtn.parentElement;
  if (!toolbar || toolbar.querySelector(':scope > .solring-sync')) return;
  // Land before the Stats-columns menu when it's already in place, so the toolbar order
  // is deterministically [Analyze all · Re-analyze all] [Stats] [Sort] on every page —
  // not dependent on which of us won the insert race (else Stats can slip ahead on
  // /users/{name}). If the menu hasn't injected yet, before Sort works: the menu then
  // inserts before Sort too, landing after us.
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
    onDeckListChange(() => { schedule(); refreshStatus(); }); // re-inject + tick the timestamp
    const obs = new MutationObserver(() => schedule());
    obs.observe(document.body, { childList: true, subtree: true });
  }
  schedule();
}

/** Remove the controls (SPA nav away). A run in progress is cancelled. */
export function teardownSync() {
  active = false;
  cancelFlag = true;
  controls = null;
  document.querySelectorAll('.solring-sync').forEach((n) => n.remove());
}
