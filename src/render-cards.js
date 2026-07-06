// Per-card annotations on the deck page (Text view): power, saltiness, synergy
// columns plus a tags line (with bracket flags). Matched to CommanderSalt cards by
// normalized name. Only text-row layouts (Text / Condensed); Visual views have no
// rows. The power/salt breakdown detail lives only in the card sidebar/modal panel.
// Controlled by global prefs, re-applied on Moxfield re-render via the observer.

import { el, isDark } from './dom.js';
import { flagChips, tagChips } from './components.js';
import { powerMark, saltMark, deckAvgPower, synergyCutoff, synergyMark } from './ratings.js';
import { setCardSortView } from './prefs.js';

const ROW_SEL = 'a.table-deck-row-link[href^="/cards/"]';

// Per-card sort metrics for the deck-view card sort (clickable column labels). Each maps a
// card's extracted fields to a sortable number (null → sorts last). Keyed by sort key.
const SORT_METRIC = {
  power: (c) => (typeof c.powerTotal === 'number' ? c.powerTotal : null),
  salt: (c) => (typeof c.salt === 'number' ? c.salt : null),
  synergy: (c) => (c && c.combos && typeof c.combos.score === 'number' ? c.combos.score : null),
};

/** Normalize a card name for matching (lowercase, collapse spaces, drop DFC back). */
export function normName(s) {
  return (s || '').toLowerCase().replace(/\s*\/\/.*$/, '').replace(/\s+/g, ' ').trim();
}

function rowName(link) {
  const parts = [...link.querySelectorAll('.underline')].map((s) => s.textContent).join('');
  return normName(parts || link.textContent || '');
}

/** True if the decklist is currently a text-row layout (Text / Condensed). */
export function isTextView() {
  return !!document.querySelector(ROW_SEL);
}

/** Annotate every matched text row. Removes prior annotations first (idempotent).
    `options` (prefs:options) supplies the mark thresholds, defaults apply if absent. */
export function annotate(fields, prefs, options = {}, cardSort = null) {
  clearAnnotations();
  if (!fields || !fields.cards || !isTextView()) return;
  cardSortState = cardSort || { key: null, dir: 'desc' }; // keep the click-cycle state in sync with the persisted pref
  const dark = isDark();

  // Marks (ratings.js): salt at/above the salt threshold, power above N× the deck
  // average, synergy at/above the deck's percentile cutoff. Both deck-wide figures are
  // computed once for all rows.
  const avgPower = deckAvgPower(fields.cards, fields.powerScoreTotal);
  const synCut = synergyCutoff(fields.cards, options.synergyPercentile);

  document.querySelectorAll(ROW_SEL).forEach((link) => {
    const li = link.closest('li');
    if (!li) return;
    const card = fields.cards[rowName(link)];
    if (!card) return;

    // Only relax the row (wrap + let the name shrink) when we add full-width
    // sub-lines below the columns (tags / detail). For power/salt-only rows we leave
    // the native layout untouched so it stays as compact as Moxfield's own: our
    // cells are just two extra columns. (The wrap override changes the name to
    // flex-basis:0, which creates free space a margin-auto column would otherwise
    // turn into a gap before the price.)
    const hasTagLine = (card.flags && card.flags.length) || (card.tags && card.tags.length);
    const wantSub = prefs.tags && hasTagLine;
    if (wantSub) li.classList.add('solring-row');
    const indent = li.firstElementChild ? Math.round(li.firstElementChild.getBoundingClientRect().width) : 0;
    const span = (node) => { node.style.paddingLeft = `${indent}px`; return node; };

    // 1) Power + Salt value columns on the first line (power left of salt). Placed
    // right after the price column (the cell carrying the currency text) so they sit
    // after the price and before the set symbol. Fallbacks when there's no price cell
    // (prices hidden / logged out): before the collection toggle, then the control
    // icon, else append. Standouts (salt at/above threshold, power above N x avg) get the mark color.
    const mark = (on, cls) => (on ? ` ${cls}` : '');
    const columnOf = (node) => { let n = node; while (n && n.parentElement !== li) n = n.parentElement; return n; };
    const priceCol = [...li.children].find((c) => /[€$£¥]/.test(c.textContent || ''));
    const anchorCol = priceCol
      ? priceCol.nextElementSibling // after price, before the set symbol
      : columnOf(li.querySelector('a[id^="collection_"]') || li.querySelector('a.fa-stack'));
    const place = (node) => (anchorCol ? li.insertBefore(node, anchorCol) : li.append(node));
    if (prefs.power && typeof card.powerTotal === 'number') {
      place(el('span', {
        class: `solring-power-cell text-end solring-card-anno${mark(powerMark(card.powerTotal, avgPower, options.powerThreshold), 'solring-mark-power')}`,
        text: card.powerTotal.toFixed(1),
        title: 'power contribution',
      }));
    }
    if (prefs.saltValue && typeof card.salt === 'number') {
      place(el('span', {
        class: `solring-salt-cell text-end solring-card-anno${mark(saltMark(card.salt, options.saltThreshold), 'solring-mark-salt')}`,
        text: card.salt.toFixed(1),
        title: 'saltiness',
      }));
    }
    // Synergy score (CommanderSalt outgoing-impact score, the same number it sums to
    // rank a deck's synergy anchors). 3rd numeric column beside Power/Salt contribution,
    // 0 when the card has no synergy.
    if (prefs.synergy) {
      const rawSyn = card.combos && typeof card.combos.score === 'number' ? card.combos.score : 0;
      place(el('span', {
        class: `solring-syn-cell text-end solring-card-anno${mark(synergyMark(rawSyn, synCut), 'solring-mark-synergy')}`,
        text: String(Math.round(rawSyn)),
        title: 'synergy',
      }));
    }

    // EDHREC inclusion %: how commonly this card is run in the commander's decks. Only when
    // the toggle is on AND enrichment has loaded (fields.edhrecInclusion, set async). Muted;
    // absent-from-EDHREC cards simply get no badge.
    if (prefs.edhrec && fields.edhrecInclusion) {
      const pct = fields.edhrecInclusion[rowName(link)];
      if (typeof pct === 'number') {
        place(el('span', {
          class: 'solring-edhrec-cell text-end solring-card-anno',
          text: `${pct}%`,
          title: `In ${pct}% of this commander's EDHREC decks`,
        }));
      }
    }

    // 2) Tags + bracket flags: one full-width sub-line (flags first, then tags),
    // spanning name-column to row end.
    if (prefs.tags && hasTagLine) {
      const chipNodes = [...flagChips(card.flags), ...tagChips(card.tags)];
      li.append(span(el('div', { class: `solring-tags${dark ? ' solring-dark' : ''}` }, chipNodes)));
    }
  });

  injectColumnLegend(prefs, cardSort);
  applyCardSort(cardSort, fields);
}

// Sort card rows within each type group by the chosen per-card metric, using CSS `order`
// on the flex-column list — we set only the visual order, never move DOM nodes. That's why
// this is safe: reordering Moxfield's React-managed nodes corrupts its virtual DOM (breaks
// its own sort and flickers), but a style change doesn't. Neutral (no key) clears `order`,
// so the untouched DOM shows Moxfield's native order — no snapshot needed. Cards without a
// value sort last. The header row keeps order 0 (unset), so it stays above the cards.
function applyCardSort(cardSort, fields) {
  const key = cardSort && cardSort.key;
  const getVal = key && SORT_METRIC[key];
  const sign = cardSort && cardSort.dir === 'asc' ? 1 : -1;
  const has = (x) => typeof x === 'number' && Number.isFinite(x);
  const lists = new Set();
  document.querySelectorAll(ROW_SEL).forEach((link) => { const ul = link.closest('li') && link.closest('li').parentElement; if (ul) lists.add(ul); });
  for (const ul of lists) {
    const rows = [...ul.children].filter((c) => c.querySelector(ROW_SEL));
    if (!rows.length) continue;
    if (!getVal) { rows.forEach((r) => { r.style.order = ''; }); continue; } // neutral → native order
    const ranked = rows
      .map((r) => { const link = r.querySelector(ROW_SEL); const card = link && fields.cards[rowName(link)]; return { r, v: card ? getVal(card) : null }; })
      .sort((a, b) => {
        if (has(a.v) && has(b.v)) return (a.v - b.v) * sign;
        if (has(a.v)) return -1;
        if (has(b.v)) return 1;
        return 0;
      });
    ranked.forEach(({ r }, i) => { r.style.order = String(i + 1); }); // +1 so the header (order 0) stays first
  }
}

// Text view has no table header, so the power/salt/synergy columns are unlabeled numbers.
// Label them on each type group's HEADER row (the "Creatures (28) – €337" line, which spans
// the full content width): a right-anchored key overlaid where its number columns sit. The
// labels reuse the value-cell width classes and a trailing offset measured from a real row
// (Moxfield's collection/menu columns sit to the right of ours), so each label lands over
// its column. Absolutely positioned → adds nothing to the row's flow and no column widens.
function injectColumnLegend(prefs, cardSort) {
  const abbr = [];
  if (prefs.power) abbr.push(['solring-power-cell', 'Pwr', 'Power contribution', 'power']);
  if (prefs.saltValue) abbr.push(['solring-salt-cell', 'Slt', 'Saltiness', 'salt']);
  if (prefs.synergy) abbr.push(['solring-syn-cell', 'Syn', 'Synergy score', 'synergy']);
  if (!abbr.length) return;
  const sampleCell = document.querySelector('.solring-power-cell, .solring-salt-cell, .solring-syn-cell');
  const sampleRow = sampleCell && sampleCell.closest('li');
  if (!sampleRow) return; // no annotated rows (no matches) → nothing to label
  // Measure each column's right-offset from the row's right edge, and its width, from a real
  // row. Each label is then absolutely positioned at that exact offset — so it sits over its
  // column regardless of the inter-cell gaps a flex layout can't replicate.
  const rowRight = sampleRow.getBoundingClientRect().right;
  const colInfo = (cls) => {
    const c = sampleRow.querySelector(`.${cls}`);
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { right: Math.max(0, Math.round(rowRight - r.right)), width: Math.round(r.width) };
  };
  const lists = new Set();
  document.querySelectorAll(ROW_SEL).forEach((link) => { const ul = link.closest('li') && link.closest('li').parentElement; if (ul) lists.add(ul); });
  for (const ul of lists) {
    // The group header row = the ul child that carries the title/price. Detect card rows by
    // ROW_SEL (a /cards/ link); the header's own title link is a table-deck-row-link too but
    // without a /cards/ href, so the bare class can't distinguish it.
    const header = [...ul.children].find((c) => !c.querySelector(ROW_SEL));
    if (!header || header.querySelector(':scope > .solring-collegend')) continue;
    // Only label a column that actually has values in THIS group. Groups whose cards
    // aren't in the analyzed deck (e.g. "Considering") get no value cells, so they get no
    // header — nothing to label.
    const cells = abbr
      .filter(([cls]) => ul.querySelector(`.${cls}`))
      .map(([cls, t, title, sortKey]) => {
        const info = colInfo(cls);
        const active = cardSort && cardSort.key === sortKey;
        const arrow = active ? (cardSort.dir === 'asc' ? ' ▴' : ' ▾') : '';
        const label = el('span', {
          class: `solring-collabel solring-collabel-btn${active ? ' solring-collabel-on' : ''}`,
          text: t + arrow,
          title: `${title} — click to sort`,
          attrs: { role: 'button', tabindex: '0' },
          style: info ? `right:${info.right}px; width:${info.width}px` : 'display:none',
        });
        const toggle = (e) => { e.preventDefault(); e.stopPropagation(); cycleCardSort(sortKey); };
        label.addEventListener('click', toggle);
        label.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') toggle(ev); });
        return label;
      });
    if (!cells.length) continue; // no annotated values in this group
    header.classList.add('solring-collegend-host');
    // No aria-hidden: the labels are focusable sort buttons, so they must stay exposed to
    // assistive tech (hiding a focusable descendant is an a11y violation).
    header.append(el('span', { class: 'solring-collegend' }, cells));
  }
}

// The active card sort, mirrored from the persisted pref on each annotate. cycleCardSort
// reads/updates it synchronously so rapid clicks cycle correctly instead of racing on a
// stale value captured when the legend was last rendered.
let cardSortState = { key: null, dir: 'desc' };

// Click a column label to cycle its sort: none → descending → ascending → none. Persists
// to prefs, which fires onPrefChange('card') → the deck re-annotates and re-sorts.
function cycleCardSort(key) {
  const cur = cardSortState;
  let next;
  if (cur.key !== key) next = { key, dir: 'desc' };
  else if (cur.dir === 'desc') next = { key, dir: 'asc' };
  else next = { key: null, dir: 'desc' };
  cardSortState = next; // optimistic sync-update so the next click sees the new state immediately
  setCardSortView(next);
}

export function clearAnnotations(root = document) {
  root.querySelectorAll('.solring-collegend, .solring-card-anno, .solring-card-detail, .solring-tags, .solring-salt-cell, .solring-power-cell, .solring-syn-cell, .solring-edhrec-cell')
    .forEach((n) => n.remove());
  root.querySelectorAll('.solring-row').forEach((n) => n.classList.remove('solring-row'));
  root.querySelectorAll('.solring-collegend-host').forEach((n) => n.classList.remove('solring-collegend-host'));
  // Drop any card-sort CSS order so a bailed-out pass (e.g. non-text view) can't leave rows
  // visually reordered; applyCardSort re-sets it when a sort is active.
  root.querySelectorAll(`li:has(${ROW_SEL})`).forEach((n) => { n.style.order = ''; });
}
