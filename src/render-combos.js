// Deck combos section (Commander Spellbook, from details.combos). Hidden by
// default; toggled by the Combos tile in the deck panel. All text via
// textContent (data is third-party). Mirrors CommanderSalt's combo card.

import { el } from './dom.js';

const SECTION_LABELS = {
  easyPrerequisites: 'Easy prereqs',
  notablePrerequisites: 'Notable prereqs',
  preconditions: 'Preconditions',
  steps: 'Steps',
  results: 'Results',
};

const pct = (n) => `${Math.round((n || 0) * 100)}%`;

function tagChips(combo) {
  const tags = [];
  if (combo.type) tags.push(combo.type);
  for (const c of combo.categories) tags.push(c.replace(/-/g, ' '));
  if (combo.needsBoard) tags.push('needs board state');
  if (!tags.length) return null;
  return el('div', { class: 'solring-combo-tags' },
    tags.map((t) => el('span', { class: 'solring-combo-tag', text: t })));
}

function listBlock(title, items, ordered) {
  if (!items || !items.length) return null;
  const list = el(ordered ? 'ol' : 'ul', { class: 'solring-combo-list' }, items.map((it) => {
    if (typeof it === 'string') return el('li', { text: it });
    const li = el('li', { text: it.text });
    if (it.payMana) li.append(el('span', { class: 'solring-combo-pay', text: ' · pay mana' }));
    return li;
  }));
  return el('div', { class: 'solring-combo-block' }, [el('div', { class: 'solring-combo-h', text: title }), list]);
}

function breakdownBlock(breakdown) {
  const rows = Object.entries(SECTION_LABELS)
    .filter(([k]) => typeof breakdown[k] === 'number')
    .map(([k, label]) => el('div', { class: 'solring-combo-bd-row' }, [
      el('span', { class: 'solring-combo-bd-label', text: label }),
      el('span', { class: 'solring-combo-bd-bar' }, [el('span', { style: `width:${pct(breakdown[k])}` })]),
      el('span', { class: 'solring-combo-bd-val', text: pct(breakdown[k]) }),
    ]));
  if (!rows.length) return null;
  return el('div', { class: 'solring-combo-block' }, [
    el('div', { class: 'solring-combo-h', text: 'Difficulty · higher = easier' }),
    el('div', { class: 'solring-combo-bd' }, rows),
  ]);
}

function comboCard(combo) {
  const meta = el('div', { class: 'solring-combo-meta' }, [
    combo.score != null ? el('span', { title: 'Score', text: `★ ${combo.score}` }) : null,
    combo.complexity != null ? el('span', { title: 'Complexity', text: pct(combo.complexity) }) : null,
    combo.extraMana ? el('span', { title: 'Extra mana', text: `+${combo.extraMana} mana` }) : null,
    combo.spellbookUri ? el('a', {
      class: 'solring-combo-link', text: 'Spellbook ↗',
      attrs: { href: combo.spellbookUri, target: '_blank', rel: 'noopener' },
    }) : null,
  ]);
  return el('div', { class: 'solring-combo' }, [
    el('div', { class: 'solring-combo-head' }, [
      el('div', { class: 'solring-combo-pieces', text: combo.pieces.join('  +  ') }),
      meta,
    ]),
    tagChips(combo),
    listBlock('Prerequisites', combo.prerequisites),
    listBlock('Step-by-step', combo.steps, true),
    listBlock('Produces', combo.produces),
    breakdownBlock(combo.breakdown),
  ]);
}

/** Build the hidden combos section for a deck's combos array. */
export function buildCombosSection(combos) {
  return el('div', { class: 'solring-combos', attrs: { hidden: '' } }, combos.map(comboCard));
}
