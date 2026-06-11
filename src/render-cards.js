// Per-card annotations on the deck page (Text view): salt value + tags, with an
// optional per-card Stats expander. Matched to CommanderSalt cards by normalized
// name. Gated to text-row layouts (Text / Condensed) — Visual views have no rows.
// Controlled by global prefs; re-applied on Moxfield re-render via the caller's observer.

import { el, isDark } from './dom.js';
import { prettifyStat } from './labels.js';
import { powerMark, saltMark, deckAvgPower } from './ratings.js';

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

function detailLine(label, body) {
  return el('div', { class: 'solring-detail-line' }, [el('b', { text: `${label} ` }), body]);
}
const scoreText = (arr) => arr.map((x) => `${prettifyStat(x.cat)} ${x.score.toFixed(1)}`).join('  ·  ');

// The Stats detail shows the power-contribution and salt breakdowns. Bracket flags now
// ride along in the Tags line, and synergies are their own numeric column.
function statsDetail(card) {
  const rows = [];
  if (card.power && card.power.length) {
    const total = typeof card.powerTotal === 'number' ? card.powerTotal.toFixed(1) : '';
    rows.push(detailLine('Power:', document.createTextNode(`${total}  (${scoreText(card.power)})`)));
  }
  if (card.saltBreakdown && card.saltBreakdown.length) {
    rows.push(detailLine('Salt:', document.createTextNode(`${card.salt.toFixed(1)}  (${scoreText(card.saltBreakdown)})`)));
  }
  if (!rows.length) {
    rows.push(detailLine('Stats:', document.createTextNode('no extra data for this card')));
  }
  return el('div', { class: 'solring-card-detail' }, rows);
}

/** Annotate every matched text row. Removes prior annotations first (idempotent).
    `options` (prefs:options) supplies the mark thresholds; defaults apply if absent. */
export function annotate(fields, prefs, options = {}) {
  clearAnnotations();
  if (!fields || !fields.cards || !isTextView()) return;
  const dark = isDark();

  // Marks (ratings.js): salt at/above the salt threshold, power above N× the deck
  // average. The average is computed once for all rows.
  const avgPower = deckAvgPower(fields.cards, fields.powerScoreTotal);

  document.querySelectorAll(ROW_SEL).forEach((link) => {
    const li = link.closest('li');
    if (!li) return;
    const card = fields.cards[rowName(link)];
    if (!card) return;

    // Only relax the row (wrap + let the name shrink) when we add full-width
    // sub-lines below the columns (tags / detail). For power/salt-only rows we leave
    // the native layout untouched so it stays as compact as Moxfield's own — our
    // cells are just two extra columns. (The wrap override changes the name to
    // flex-basis:0, which creates free space a margin-auto column would otherwise
    // turn into a gap before the price.)
    const hasTagLine = (card.flags && card.flags.length) || (card.tags && card.tags.length);
    const wantSub = (prefs.tags && hasTagLine) || prefs.stats;
    if (wantSub) li.classList.add('solring-row');
    const indent = li.firstElementChild ? Math.round(li.firstElementChild.getBoundingClientRect().width) : 0;
    const span = (node) => { node.style.paddingLeft = `${indent}px`; return node; };

    // 1) Power + Salt value — columns on the first line (power left of salt). Placed
    // right after the price column (the cell carrying the currency text) so they sit
    // after the price and before the set symbol. Fallbacks when there's no price cell
    // (prices hidden / logged out): before the collection toggle, then the control
    // icon, else append. Standouts (salt ≥ threshold / power > N× avg) get the mark color.
    const mark = (on, cls) => (on ? ` ${cls}` : '');
    const columnOf = (node) => { let n = node; while (n && n.parentElement !== li) n = n.parentElement; return n; };
    const priceCol = [...li.children].find((c) => /[€$£¥]/.test(c.textContent || ''));
    const anchorCol = priceCol
      ? priceCol.nextElementSibling // after price → before the set symbol
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
    // Synergies = how many cards this one synergizes with (CommanderSalt "outgoing
    // impact"). 3rd numeric column after power + salt; omitted when the card feeds none.
    if (prefs.synergies && card.combos && card.combos.count) {
      place(el('span', {
        class: 'solring-syn-cell text-end solring-card-anno',
        text: String(card.combos.count),
        title: 'synergies (cards this one feeds)',
      }));
    }

    // 2) Tags + bracket flags — one full-width sub-line (flags first, then tags),
    // spanning name-column → row end.
    if (prefs.tags && hasTagLine) {
      const chipNodes = [];
      for (const f of card.flags || []) chipNodes.push(el('span', { class: 'solring-flag', text: f }));
      for (const t of card.tags || []) chipNodes.push(el('span', { class: 'solring-tag', text: t }));
      li.append(span(el('div', { class: `solring-tags${dark ? ' solring-dark' : ''}` }, chipNodes)));
    }

    // 3) Stats detail (power + salt breakdowns) — full-width sub-line.
    if (prefs.stats) {
      li.append(span(statsDetail(card)));
    }
  });
}

export function clearAnnotations(root = document) {
  root.querySelectorAll('.solring-card-anno, .solring-card-detail, .solring-tags, .solring-salt-cell, .solring-power-cell, .solring-syn-cell')
    .forEach((n) => n.remove());
  root.querySelectorAll('.solring-row').forEach((n) => n.classList.remove('solring-row'));
}
