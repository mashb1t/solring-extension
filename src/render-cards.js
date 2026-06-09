// Per-card annotations on the deck page (Text view): salt value + tags, with an
// optional per-card Stats expander. Matched to CommanderSalt cards by normalized
// name. Gated to text-row layouts (Text / Condensed) — Visual views have no rows.
// Controlled by global prefs; re-applied on Moxfield re-render via the caller's observer.

import { el, isDark } from './dom.js';
import { prettifyStat } from './labels.js';
import { saltTier, powerTier, deckAvgPower } from './ratings.js';

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

// The detail shows what the Tags toggle does NOT: (Stats) bracket flags, power
// contribution, salt breakdown; and (Combos) the synergy "Outgoing Impact".
function statsDetail(card, prefs) {
  const rows = [];
  if (prefs.stats) {
    if (card.flags && card.flags.length) {
      rows.push(detailLine('Bracket:', el('span', { class: 'solring-flags' },
        card.flags.map((f) => el('span', { class: 'solring-flag', text: f })))));
    }
    if (card.power && card.power.length) {
      const total = typeof card.powerTotal === 'number' ? card.powerTotal.toFixed(1) : '';
      rows.push(detailLine('Power:', document.createTextNode(`${total}  (${scoreText(card.power)})`)));
    }
    if (card.saltBreakdown && card.saltBreakdown.length) {
      rows.push(detailLine('Salt:', document.createTextNode(`${card.salt.toFixed(1)}  (${scoreText(card.saltBreakdown)})`)));
    }
  }
  if (prefs.combos) {
    const parts = [];
    if (card.deckCombos) parts.push(`${card.deckCombos} in deck`);
    if (card.combos && card.combos.anchors && card.combos.anchors.length) {
      parts.push(`feeds ${card.combos.anchors.slice(0, 6).join(', ')}`);
    }
    if (parts.length) rows.push(detailLine('Combos:', document.createTextNode(parts.join('  ·  '))));
  }
  if (!rows.length) {
    rows.push(detailLine('Stats:', document.createTextNode('no extra CommanderSalt data for this card')));
  }
  return el('div', { class: 'solring-card-detail' }, rows);
}

/** Annotate every matched text row. Removes prior annotations first (idempotent). */
export function annotate(fields, prefs) {
  clearAnnotations();
  if (!fields || !fields.cards || !isTextView()) return;
  const dark = isDark();

  // Red flags (ratings.js): salt in the salty cluster (>=5) and power above 2× the
  // deck average. The average is computed once for all rows.
  const avgPower = deckAvgPower(fields.cards, fields.powerScoreTotal);

  document.querySelectorAll(ROW_SEL).forEach((link) => {
    const li = link.closest('li');
    if (!li) return;
    const card = fields.cards[rowName(link)];
    if (!card) return;

    // The row is flex(row nowrap). Let it wrap so our full-width sub-lines (tags,
    // detail) sit below the columns, indented to start under the name (2nd col)
    // and spanning to the row's end (last col).
    li.classList.add('solring-row');
    const indent = li.firstElementChild ? Math.round(li.firstElementChild.getBoundingClientRect().width) : 0;
    const span = (node) => { node.style.paddingLeft = `${indent}px`; return node; };

    // 1) Power + Salt value — trailing columns that stay on the first line (before
    // the wrapping rows). Power sits to the left of salt (it is appended first).
    // Standouts (salt >=5 / power >2× avg) are flagged in the accent color.
    const flag = (on) => (on ? ' solring-card-flag' : '');
    if (prefs.power && typeof card.powerTotal === 'number') {
      li.append(el('span', {
        class: `solring-power-cell text-end solring-card-anno${flag(powerTier(card.powerTotal, avgPower) === 'a')}`,
        text: card.powerTotal.toFixed(1),
        title: 'CommanderSalt power contribution',
      }));
    }
    if (prefs.saltValue && typeof card.salt === 'number') {
      li.append(el('span', {
        class: `solring-salt-cell text-end solring-card-anno${flag(saltTier(card.salt) === 'a')}`,
        text: card.salt.toFixed(1),
        title: 'CommanderSalt saltiness',
      }));
    }

    // 2) Tags — full-width sub-line below, spanning name-column → row end.
    if (prefs.tags && card.tags && card.tags.length) {
      li.append(span(el('div', { class: `solring-tags${dark ? ' solring-dark' : ''}` },
        card.tags.map((t) => el('span', { class: 'solring-tag', text: t })))));
    }

    // 3) Detail (stats + combos) — full-width sub-line, shown directly (no toggle).
    if (prefs.stats || prefs.combos) {
      li.append(span(statsDetail(card, prefs)));
    }
  });
}

export function clearAnnotations(root = document) {
  root.querySelectorAll('.solring-card-anno, .solring-card-detail, .solring-tags, .solring-salt-cell, .solring-power-cell')
    .forEach((n) => n.remove());
  root.querySelectorAll('.solring-row').forEach((n) => n.classList.remove('solring-row'));
}
