// Per-card annotations on the deck page (Text view): power, saltiness, synergy
// columns plus a tags line (with bracket flags). Matched to CommanderSalt cards by
// normalized name. Only text-row layouts (Text / Condensed); Visual views have no
// rows. The power/salt breakdown detail lives only in the card sidebar/modal panel.
// Controlled by global prefs, re-applied on Moxfield re-render via the observer.

import { el, isDark } from './dom.js';
import { flagChips, tagChips } from './components.js';
import { powerMark, saltMark, deckAvgPower, synergyCutoff, synergyMark } from './ratings.js';

const ROW_SEL = 'a.table-deck-row-link[href^="/cards/"]';

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
export function annotate(fields, prefs, options = {}) {
  clearAnnotations();
  if (!fields || !fields.cards || !isTextView()) return;
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
    if (prefs.synergies) {
      const rawSyn = card.combos && typeof card.combos.score === 'number' ? card.combos.score : 0;
      place(el('span', {
        class: `solring-syn-cell text-end solring-card-anno${mark(synergyMark(rawSyn, synCut), 'solring-mark-synergy')}`,
        text: String(Math.round(rawSyn)),
        title: 'synergy score',
      }));
    }

    // 2) Tags + bracket flags: one full-width sub-line (flags first, then tags),
    // spanning name-column to row end.
    if (prefs.tags && hasTagLine) {
      const chipNodes = [...flagChips(card.flags), ...tagChips(card.tags)];
      li.append(span(el('div', { class: `solring-tags${dark ? ' solring-dark' : ''}` }, chipNodes)));
    }
  });
}

export function clearAnnotations(root = document) {
  root.querySelectorAll('.solring-card-anno, .solring-card-detail, .solring-tags, .solring-salt-cell, .solring-power-cell, .solring-syn-cell')
    .forEach((n) => n.remove());
  root.querySelectorAll('.solring-row').forEach((n) => n.classList.remove('solring-row'));
}
