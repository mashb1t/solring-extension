// Bulk analysis (Analyze all / Re-analyze all) for the deck-list pages. Injects two
// buttons + a status/last-analyzed label into the deck-list toolbar (next to Moxfield's
// Sort). Operates on the decks currently rendered in the list (decklist.getEntries),
// minus private ones (CommanderSalt can't read those). Sequential + throttled; one
// request per deck, never retried; cancelable; updates each row + the averages as it
// goes. Verb mirrors the single-deck panel ("Analyze" / "Re-analyze" / "analyzed X ago").

import { el, guard } from './dom.js';
import { canonicalDeckUrl } from './md5.js';
import { getDeck, importDeck } from './messaging.js';
import { getEntries, onDeckListChange, setFull } from './decklist.js';
import { getSync, setSync } from './cache.js';

const THROTTLE_MS = 400; // breathing room between requests, so we don't hammer the API

let username = null;
let active = false; // on a deck-list page
let running = false;
let cancelFlag = false;
let wired = false;
let raf = null;
let controls = null; // { wrap, scanBtn, rescanBtn, cancelBtn, status }

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
  controls.scanBtn.disabled = on;
  controls.rescanBtn.disabled = on;
  controls.cancelBtn.toggleAttribute('hidden', !on);
}

async function refreshStatus() {
  if (!controls || running || !username) return;
  const s = await getSync(username);
  controls.status.textContent = s && s.at ? `analyzed ${relTime(s.at)}` : '';
}

// Analyze all = warm the cache (GET; un-indexed decks get a first POST import).
// Re-analyze all = force a fresh POST re-analysis of every deck (confirm-gated).
async function run({ force }) {
  if (running) return;
  running = true;
  cancelFlag = false;
  setBusy(true);
  const entries = syncableEntries();
  let done = 0;
  let failed = 0;
  for (const e of entries) {
    if (cancelFlag) break;
    if (controls) controls.status.textContent = `${force ? 'Re-analyzing' : 'Analyzing'} ${done + 1}/${entries.length}…`;
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

function buildControls(btnClass) {
  const status = el('span', { class: 'solring-sync-status' });
  const scanBtn = el('button', {
    class: `${btnClass} solring-sync-btn`,
    attrs: { type: 'button', title: 'Load stats for every listed (non-private) deck not yet cached' },
  }, ['Analyze all']);
  const rescanBtn = el('button', {
    class: `${btnClass} solring-sync-btn`,
    attrs: { type: 'button', title: 'Force a fresh re-analysis of every listed (non-private) deck' },
  }, ['Re-analyze all']);
  const cancelBtn = el('button', {
    class: `${btnClass} solring-sync-btn solring-sync-cancel`,
    attrs: { type: 'button', hidden: '' },
  }, ['Cancel']);
  scanBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); run({ force: false }); });
  rescanBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const n = syncableEntries().length;
    // eslint-disable-next-line no-alert
    if (window.confirm(`Re-analyze all ${n} listed deck${n === 1 ? '' : 's'} on CommanderSalt? This sends one analysis request per deck and can take a while.`)) run({ force: true });
  });
  cancelBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); cancelFlag = true; });
  const wrap = el('div', { class: 'solring-sync', attrs: { 'data-solring-root': '' } }, [status, scanBtn, rescanBtn, cancelBtn]);
  controls = { wrap, scanBtn, rescanBtn, cancelBtn, status };
  refreshStatus();
  return wrap;
}

function ensureControls() {
  raf = null;
  if (!active) return;
  const sortBtn = [...document.querySelectorAll('button')].find((b) => /^\s*Sort\s*$/i.test((b.textContent || '').trim()) && !b.closest('.solring-colmenu'));
  const toolbar = sortBtn && sortBtn.parentElement;
  if (!toolbar || toolbar.querySelector(':scope > .solring-sync')) return;
  toolbar.insertBefore(buildControls(sortBtn.className), sortBtn);
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
