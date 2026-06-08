// Per-card annotations on the deck page (Text view): salt value + tags, with an
// optional per-card Stats expander. Matched to CommanderSalt cards by normalized
// name. Gated to text-row layouts (Text / Condensed) — Visual views have no rows.
// Controlled by global prefs; re-applied on Moxfield re-render via the caller's observer.

import { el, isDark } from './dom.js';

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

function statsDetail(card) {
  const rows = [];
  if (card.tags && card.tags.length) {
    rows.push(el('span', { class: 'solring-detail-item' }, [
      el('b', { text: 'Stats: ' }), document.createTextNode(card.tags.join(', ')),
    ]));
  }
  rows.push(el('span', { class: 'solring-detail-item' }, [
    el('b', { text: 'Salt: ' }), document.createTextNode(card.salt.toFixed(1)),
    el('b', { text: '  ·  Categories: ' }), document.createTextNode(String(card.total)),
  ]));
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
      const toggle = el('button', {
        class: 'solring-stats-toggle', text: '▸', attrs: { type: 'button', 'aria-label': 'Toggle card stats' },
      });
      toggle.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const open = li.classList.toggle('solring-stats-open');
        toggle.textContent = open ? '▾' : '▸';
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
  document.querySelectorAll(`${ROW_SEL}`).forEach((link) => {
    const li = link.closest('li');
    if (!li || !li.querySelector('.solring-card-detail')) return;
    li.classList.toggle('solring-stats-open', open);
    const t = li.querySelector('.solring-stats-toggle');
    if (t) t.textContent = open ? '▾' : '▸';
  });
}
