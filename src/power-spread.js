// "Power spread": a distribution view over a user's decks (0–10 power histogram,
// quartiles, bracket mix, outliers) to answer "which of these decks fit the same table?".
// `spreadStats` is PURE and unit-tested (no DOM/chrome); the render/toggle below is the
// deck-list surface. Input items are { md5, title, row, view }; only view.power and
// view.bracketRealistic matter to the stats.

import { el, registerDisposable } from './dom.js';
import { num } from './format.js';
import { getViewItems, onDeckListChange } from './decklist.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Nearest-rank percentile over an ascending-sorted array. p in [0,1].
function percentile(sorted, p) {
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

export function spreadStats(items) {
  const list = Array.isArray(items) ? items : [];

  const withPower = list.filter((it) => it && it.view && isNum(it.view.power));
  if (withPower.length < 3) return null;

  const unanalyzed = list.filter((it) => !(it && it.view && isNum(it.view.power))).length;

  const powers = withPower.map((it) => it.view.power);
  const sorted = powers.slice().sort((a, b) => a - b);

  const median = percentile(sorted, 0.5);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  // 10 bins over power 0–10. Power exactly 10 lands in the last bin (index 9),
  // not an 11th bin, via the Math.min(9, ...) clamp.
  const bins = [];
  for (let i = 0; i < 10; i += 1) {
    bins.push({ lo: i, hi: i + 1, count: 0, titles: [], md5s: [] });
  }
  for (const it of withPower) {
    const idx = Math.min(9, Math.floor(it.view.power));
    const bin = bins[idx];
    bin.count += 1;
    bin.titles.push(it.title);
    bin.md5s.push(it.md5);
  }

  const brackets = {};
  for (const it of list) {
    if (it && it.view && isNum(it.view.bracketRealistic)) {
      const b = it.view.bracketRealistic;
      brackets[b] = (brackets[b] || 0) + 1;
    }
  }

  // ponytail: fixed ±1.5 offset; switch to 1.5×IQR if users complain about tight pools
  const OUTLIER_OFFSET = 1.5;
  const outliers = withPower
    .filter((it) => Math.abs(it.view.power - median) >= OUTLIER_OFFSET)
    .map((it) => ({ md5: it.md5, title: it.title, power: it.view.power, delta: it.view.power - median }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    count: withPower.length,
    unanalyzed,
    median,
    q1,
    q3,
    min,
    max,
    bins,
    brackets,
    outliers,
  };
}

// ---- deck-list surface (toggled from the Stats menu) -------------------------

let cardEl = null; // the injected .solring-spread card, or null when closed
let offChange = null; // onDeckListChange unsubscribe while the card is open
let activeBin = null; // [lo, hi) currently focused (dims other rows), or null

// The element to insert the card before: the MAIN deck table's decorated wrapper
// (.solring-has-cols, set by decklist.reconcileColumns). A profile has a collapsed
// "Favorite Decks" table too, so pick the LAST VISIBLE decorated wrapper (the "All Decks"
// list). Fall back to the first in-column table only if nothing is decorated yet.
function anchorForCard() {
  const wraps = [...document.querySelectorAll('.solring-has-cols')]
    .filter((w) => w.parentElement && w.offsetParent !== null);
  if (wraps.length) return wraps[wraps.length - 1];
  const tbl = [...document.querySelectorAll('table.table')].find((t) => t.closest('.flex-grow-1'));
  const wrap = tbl && tbl.parentElement;
  return wrap && wrap.parentElement ? wrap : null;
}

function clearDim() {
  document.querySelectorAll('.solring-dim').forEach((n) => n.classList.remove('solring-dim'));
  activeBin = null;
}

// Focus a power band: dim every deck row whose power is outside [lo, hi) (the last bin
// includes 10). Clicking the active bin again clears it.
function focusBin(items, lo, hi) {
  if (activeBin && activeBin[0] === lo) { clearDim(); return; }
  clearDim();
  activeBin = [lo, hi];
  for (const it of items) {
    const p = it.view && it.view.power;
    const inBand = isNum(p) && p >= lo && (hi >= 10 ? p <= 10 : p < hi);
    if (it.row && !inBand) it.row.classList.add('solring-dim');
  }
}

function histogram(stats, items) {
  const maxCount = Math.max(...stats.bins.map((b) => b.count), 1);
  const cols = stats.bins.map((b) => {
    const fill = el('span', { class: 'solring-spread-fill', style: `height:${Math.round((b.count / maxCount) * 100)}%` });
    const col = el('div', {
      class: `solring-spread-col${b.count ? ' solring-spread-col-live' : ''}`,
      attrs: { role: 'button', tabindex: '0', title: `Power ${b.lo}–${b.hi}: ${b.count} deck${b.count === 1 ? '' : 's'}${b.titles.length ? ` — ${b.titles.join(', ')}` : ''}` },
    }, [
      el('span', { class: 'solring-spread-count', text: String(b.count) }),
      el('span', { class: 'solring-spread-bar' }, [fill]),
      el('span', { class: 'solring-spread-tick', text: String(b.lo) }),
    ]);
    const act = () => focusBin(items, b.lo, b.hi);
    col.addEventListener('click', act);
    col.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    return col;
  });
  return el('div', { class: 'solring-spread-hist' }, cols);
}

function bracketChips(brackets) {
  const keys = Object.keys(brackets).map(Number).sort((a, b) => a - b);
  if (!keys.length) return null;
  return el('div', { class: 'solring-spread-brackets' },
    keys.map((k) => el('span', { class: 'solring-tag', text: `B${k} ×${brackets[k]}` })));
}

function outlierList(stats) {
  if (!stats.outliers.length) return null;
  const rows = stats.outliers.slice(0, 6).map((o) => {
    const sign = o.delta > 0 ? '+' : '';
    const item = el('button', {
      class: 'solring-spread-outlier', attrs: { type: 'button', title: 'Scroll to this deck' },
      text: `${o.title || 'Untitled'} — ${num(o.power)} (${sign}${num(o.delta)})`,
    });
    item.addEventListener('click', () => {
      const hit = getViewItems().find((it) => it.md5 === o.md5);
      if (hit && hit.row) {
        hit.row.scrollIntoView({ block: 'center' });
        hit.row.classList.add('solring-spread-flash');
        setTimeout(() => hit.row.classList.remove('solring-spread-flash'), 1200);
      }
    });
    return item;
  });
  return el('div', { class: 'solring-spread-outliers' }, [
    el('div', { class: 'solring-pl-h', text: 'Outliers' }), ...rows,
  ]);
}

function buildCard(stats, items) {
  const bar = el('div', { class: 'solring-panel-bar solring-spread-bar' }, [
    el('span', { class: 'solring-wordmark', text: stats ? `Power spread · ${stats.count} deck${stats.count === 1 ? '' : 's'}${stats.unanalyzed ? ` (${stats.unanalyzed} not analyzed)` : ''}` : 'Power spread' }),
    el('button', { class: 'solring-refresh', attrs: { type: 'button', 'aria-label': 'Close power spread', title: 'Close' }, on: { click: teardownPowerSpread } }, ['✕']),
  ]);
  const body = el('div', { class: 'solring-spread-body' });
  if (!stats) {
    body.append(el('div', { class: 'solring-msg', text: 'Analyze at least 3 decks to see the spread.' }));
  } else {
    body.append(histogram(stats, items));
    body.append(el('div', { class: 'solring-spread-stats', text: `median ${num(stats.median)} · middle half ${num(stats.q1)}–${num(stats.q3)} · range ${num(stats.min)}–${num(stats.max)}` }));
    const chips = bracketChips(stats.brackets);
    if (chips) body.append(chips);
    const outliers = outlierList(stats);
    if (outliers) body.append(outliers);
  }
  return el('div', { class: 'solring-panel solring-open solring-spread', attrs: { 'data-solring-root': '' } }, [bar, body]);
}

let lastSig = null; // skip re-rendering when the stats haven't actually changed (kills flicker)
function render() {
  const items = getViewItems();
  const stats = spreadStats(items);
  const sig = stats ? `${stats.count}/${stats.unanalyzed}|${stats.bins.map((b) => b.count).join(',')}|${stats.median}` : 'empty';
  if (cardEl && cardEl.isConnected && sig === lastSig) return; // unchanged: leave the card (and any active dim) alone
  lastSig = sig;
  const card = buildCard(stats, items);
  if (cardEl && cardEl.isConnected) { cardEl.replaceWith(card); cardEl = card; return; }
  const anchor = anchorForCard();
  if (!anchor) { cardEl = null; return; }
  anchor.parentElement.insertBefore(card, anchor);
  cardEl = card;
}

/** Toggle the power-spread card above the deck-list table (Stats menu item). */
export function togglePowerSpread() {
  if (cardEl && cardEl.isConnected) { teardownPowerSpread(); return; }
  render();
  if (!cardEl) return; // no table to anchor to
  offChange = onDeckListChange(() => { if (cardEl) render(); }); // live-update as decks stream in
  registerDisposable(teardownPowerSpread); // drop on SPA nav
}

/** Remove the card, its dim state, and the live subscription. */
export function teardownPowerSpread() {
  if (offChange) { offChange(); offChange = null; }
  clearDim();
  lastSig = null;
  if (cardEl) { cardEl.remove(); cardEl = null; }
}
