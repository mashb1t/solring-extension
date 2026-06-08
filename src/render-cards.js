// Per-card annotations on the deck page (Text view): salt value + tags, with an
// optional per-card Stats expander. Matched to CommanderSalt cards by normalized
// name. Gated to text-row layouts (Text / Condensed) — Visual views have no rows.
// Controlled by global prefs; re-applied on Moxfield re-render via the caller's observer.

import { el, isDark } from './dom.js';
import { prettifyStat } from './labels.js';

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

// The Stats detail shows what the Tags toggle does NOT: bracket flags, the card's
// power contribution by dimension, and the breakdown of its salt score.
function statsDetail(card) {
  const rows = [];
  if (card.flags && card.flags.length) {
    rows.push(detailLine('Bracket:', el('span', { class: 'solring-flags' },
      card.flags.map((f) => el('span', { class: 'solring-flag', text: f })))));
  }
  if (card.power && card.power.length) {
    rows.push(detailLine('Power:', document.createTextNode(scoreText(card.power))));
  }
  if (card.saltBreakdown && card.saltBreakdown.length) {
    rows.push(detailLine('Salt:', document.createTextNode(`${card.salt.toFixed(1)}  (${scoreText(card.saltBreakdown)})`)));
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

  document.querySelectorAll(ROW_SEL).forEach((link) => {
    const li = link.closest('li');
    if (!li) return;
    const card = fields.cards[rowName(link)];
    if (!card) return;
    const nameCell = li.querySelector('.w-100') || li;

    if (prefs.stats) {
      const detail = statsDetail(card);
      // Arrow is drawn via CSS (::before) keyed off .solring-stats-open, so the
      // click only flips a class (an attribute change) — never a childList
      // mutation that would wake the decklist observer and rebuild the row.
      const toggle = el('button', {
        class: 'solring-stats-toggle', attrs: { type: 'button', 'aria-label': 'Toggle card stats' },
      });
      toggle.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        li.classList.toggle('solring-stats-open');
      });
      nameCell.append(el('span', { class: `solring-card-anno${dark ? ' solring-dark' : ''}` }, [toggle]));
      nameCell.append(detail);
    }

    if (prefs.tags && card.tags && card.tags.length) {
      nameCell.append(el('span', { class: 'solring-tags' },
        card.tags.map((t) => el('span', { class: 'solring-tag', text: t }))));
    }

    if (prefs.saltValue && typeof card.salt === 'number') {
      const high = card.salt >= 5;
      li.append(el('span', {
        class: `solring-salt-cell text-end solring-card-anno${high ? ' solring-salt-high' : ''}`,
        text: card.salt.toFixed(1),
        title: 'CommanderSalt saltiness',
      }));
    }
  });
}

export function clearAnnotations(root = document) {
  root.querySelectorAll('.solring-card-anno, .solring-card-detail, .solring-tags, .solring-salt-cell')
    .forEach((n) => n.remove());
  root.querySelectorAll('.solring-stats-open').forEach((n) => n.classList.remove('solring-stats-open'));
}

/** Expand/collapse every per-card stats panel at once. */
export function toggleAllStats(open) {
  document.querySelectorAll(ROW_SEL).forEach((link) => {
    const li = link.closest('li');
    if (!li || !li.querySelector('.solring-card-detail')) return;
    li.classList.toggle('solring-stats-open', open);
  });
}
