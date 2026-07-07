// Deck combos section (Commander Spellbook, from details.combos). Hidden by
// default, toggled by the Combos tile in the deck panel. All text via
// textContent (data is third-party). Mirrors CommanderSalt's combo card.

import { el, chevronSvg } from './dom.js';
import { cardRefs } from './render-card-modal.js';

const SECTION_LABELS = {
  easyPrerequisites: 'Easy prereqs',
  notablePrerequisites: 'Notable prereqs',
  preconditions: 'Preconditions',
  steps: 'Steps',
  results: 'Results',
};

const pct = (n) => `${Math.round((n || 0) * 100)}%`;

// labelled stat for the combo header (e.g. "score 25", "complexity 46%")
function stat(label, value) {
  return el('span', { class: 'solring-combo-stat' }, [
    el('span', { class: 'solring-combo-stat-label', text: label }),
    el('span', { class: 'solring-combo-stat-val', text: value }),
  ]);
}

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
  // Collapsible detail (prereqs / steps / produces / difficulty), hidden by default.
  const blocks = [
    listBlock('Prerequisites', combo.prerequisites),
    listBlock('Step-by-step', combo.steps, true),
    listBlock('Produces', combo.produces),
    breakdownBlock(combo.breakdown),
  ].filter(Boolean);
  const body = blocks.length ? el('div', { class: 'solring-combo-body', attrs: { hidden: '' } }, blocks) : null;

  // The whole header row toggles the body. A chevron (rotated 180 deg when closed,
  // like the metric tiles) replaces the old "Details" button.
  const chev = body ? el('span', { class: 'solring-combo-chev', attrs: { 'aria-hidden': 'true' } }, [chevronSvg()]) : null;

  const meta = el('div', { class: 'solring-combo-meta' }, [
    combo.score != null ? stat('score', String(combo.score)) : null,
    combo.complexity != null ? stat('complexity', pct(combo.complexity)) : null,
    combo.extraMana ? stat('extra mana', `+${combo.extraMana}`) : null,
    combo.spellbookUri ? el('a', {
      class: 'solring-combo-link', text: 'Spellbook ↗',
      attrs: { href: combo.spellbookUri, target: '_blank', rel: 'noopener' },
    }) : null,
    chev,
  ]);

  const pieces = el('div', { class: 'solring-combo-pieces' });
  cardRefs(combo.pieces, { chip: false }).forEach((ref, i) => { if (i) pieces.append('  +  '); pieces.append(ref); });
  const head = el('div', { class: 'solring-combo-head' }, [pieces, meta]);
  const card = el('div', { class: 'solring-combo' }, [head, tagChips(combo), body]);

  if (body) {
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-expanded', 'false');
    const toggle = () => {
      const open = body.hasAttribute('hidden');
      if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
      card.classList.toggle('solring-open', open);
      card.setAttribute('aria-expanded', String(open));
    };
    // Clicking the Spellbook link should follow the link, not toggle.
    card.addEventListener('click', (e) => { if (e.target.closest('a')) return; toggle(); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  }

  return card;
}

// Win-condition profile summary (powerLevel.profile.wincons + .combos): the deck's win
// paths and combo-consistency read, shown above the combo list.
function winconSummary(p, combos) {
  if (!p) return null;
  const rows = [];
  if (Array.isArray(p.paths) && p.paths.length) {
    const n = p.count || p.paths.length;
    const parts = [`${n} path${n === 1 ? '' : 's'}`, p.paths.join(' + ')];
    if (p.goal) parts.push(p.goal);
    if (p.mixedTypes) parts.push('mixed types');
    rows.push(['Win plan', parts.join(' · ')]);
  }
  const c = p.combos || {};
  if (c.count) {
    const parts = [`${c.count} combo${c.count === 1 ? '' : 's'}`];
    if (c.effectiveLines != null) parts.push(`${c.effectiveLines} effective line${c.effectiveLines === 1 ? '' : 's'}`);
    if (typeof c.redundancy === 'number') parts.push(`${Math.round(c.redundancy * 100)}% redundancy`);
    // Size breakdown from the combo list (cards per combo), shown next to redundancy.
    const bySize = {};
    for (const cb of combos || []) { const n = (cb.pieces || []).length; if (n) bySize[n] = (bySize[n] || 0) + 1; }
    const sizeStr = Object.keys(bySize).map(Number).sort((a, b) => a - b).map((n) => `${n}-card ×${bySize[n]}`).join(', ');
    if (sizeStr) parts.push(sizeStr);
    rows.push(['Combos', parts.join(' · ')]);
  }
  if (!rows.length) return null;
  return el('div', { class: 'solring-wincon-profile' }, [
    el('div', { class: 'solring-pl-h', text: 'Win-condition profile' }),
    ...rows.map(([k, v]) => el('div', { class: 'solring-wp-row' }, [
      el('span', { class: 'solring-wp-k', text: k }),
      el('span', { class: 'solring-wp-v', text: v }),
    ])),
  ]);
}

/** Build the hidden Wincons section: the win-condition profile (optional) over the
    deck's combo cards. */
export function buildCombosSection(combos, profile) {
  const children = [];
  const summary = winconSummary(profile, combos);
  if (summary) children.push(summary);
  // Most-relevant first: fewest pieces (a 2-card infinite is the most consistent,
  // threatening win), then highest score as a tiebreak. CommanderSalt's combo `score`
  // is a narrow popularity-ish band that doesn't track combo power on its own, so card
  // count leads and score only breaks ties within a size tier. (Copy, don't mutate.)
  const ordered = [...(combos || [])].sort((a, b) =>
    (a.pieces || []).length - (b.pieces || []).length || (b.score || 0) - (a.score || 0));
  for (const c of ordered) children.push(comboCard(c));
  // Filled asynchronously by renderSpellbookNearMiss when find-my-combos resolves (Phase 5).
  children.push(el('div', { class: 'solring-nearmiss-slot' }));
  return el('div', { class: 'solring-combos', attrs: { hidden: '' } }, children);
}

// "One card away": Commander Spellbook combos the deck is a single card short of, grouped by
// the card to add (one card can complete several). Idempotent — clears the slot first;
// renders nothing when empty. `data.nearMiss` = [{ id, add, produces, popularity, bracketTag }].
// Commander Spellbook combo bracket tags → the official-Bracket number they suit + a blurb.
// (From commanderspellbook.com syntax guide.) The chip shows the bracket (1 / 2+ / 2 / 3+ /
// 3 / 4+); the tier name + blurb are the tooltip.
const BRACKET_TAG = {
  E: { name: 'Exhibition', bracket: '1', desc: 'casual / janky combo, fine in any deck' },
  C: { name: 'Core', bracket: '2+', desc: 'fast two-card combo or extra-turn card' },
  O: { name: 'Oddball', bracket: '2', desc: 'could be powerful but needs more cards / unclear' },
  P: { name: 'Powerful', bracket: '3+', desc: 'game changers or strong two-card combos' },
  S: { name: 'Spicy', bracket: '3', desc: 'could be ruthless but needs a third card / unclear' },
  R: { name: 'Ruthless', bracket: '4+', desc: 'competitive: infinite turns, mass denial, control' },
  B: { name: 'Banned', bracket: 'banned', desc: 'contains a card banned in Commander' },
};
function bracketStat(tag) {
  if (!tag) return null;
  const b = BRACKET_TAG[tag];
  const s = stat('bracket', b ? b.bracket : tag);
  if (b) s.title = `${b.name} · ${b.desc}`;
  return s;
}

// A near-miss combo, rendered with the SAME shape as an existing combo card (comboCard): the
// full piece list (the missing card marked red), produces chips, meta stats + Spellbook link,
// and an expandable body (prerequisites / steps / produces).
function nearMissCard(combo) {
  const blocks = [
    listBlock('Prerequisites', combo.prerequisites),
    listBlock('Steps', combo.steps),
    listBlock('Produces', combo.produces),
  ].filter(Boolean);
  const body = blocks.length ? el('div', { class: 'solring-combo-body', attrs: { hidden: '' } }, blocks) : null;
  const chev = body ? el('span', { class: 'solring-combo-chev', attrs: { 'aria-hidden': 'true' } }, [chevronSvg()]) : null;

  const meta = el('div', { class: 'solring-combo-meta' }, [
    combo.popularity != null ? stat('decks', Number(combo.popularity).toLocaleString('en-US')) : null,
    bracketStat(combo.bracketTag),
    combo.id ? el('a', {
      class: 'solring-combo-link', text: 'Spellbook ↗',
      attrs: { href: `https://commanderspellbook.com/combo/${combo.id}/`, target: '_blank', rel: 'noopener' },
    }) : null,
    chev,
  ]);

  const pieces = el('div', { class: 'solring-combo-pieces' });
  combo.pieces.forEach((p, i) => {
    if (i) pieces.append('  +  ');
    // Pass the Scryfall image so the hover preview works even for the missing card. Since it
    // has no deck-row link, resolve it to Moxfield's card view on click (Scryfall fallback).
    const scry = p.missing ? `https://scryfall.com/search?q=${encodeURIComponent(`!"${p.name}"`)}` : undefined;
    const ref = cardRefs([{ name: p.name, image: p.image, href: scry, resolve: p.missing }], { chip: false })[0];
    if (p.missing) { ref.classList.add('solring-piece-missing'); ref.title = 'Not in deck · add to complete the combo — click to open the card'; }
    pieces.append(ref);
  });
  const head = el('div', { class: 'solring-combo-head' }, [pieces, meta]);
  const chips = (combo.produces || []).length
    ? el('div', { class: 'solring-combo-tags' }, combo.produces.map((t) => el('span', { class: 'solring-combo-tag', text: t })))
    : null;
  const card = el('div', { class: 'solring-combo' }, [head, chips, body]);

  if (body) {
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-expanded', 'false');
    const toggle = () => {
      const open = body.hasAttribute('hidden');
      if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
      card.classList.toggle('solring-open', open);
      card.setAttribute('aria-expanded', String(open));
    };
    card.addEventListener('click', (e) => { if (e.target.closest('a')) return; toggle(); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  }
  return card;
}

export function renderSpellbookNearMiss(slot, data) {
  slot.replaceChildren();
  const combos = (data && data.nearMiss) || [];
  if (!combos.length) return;
  // Divider + header separating the deck's existing combos (above) from the near-misses.
  slot.append(
    el('div', { class: 'solring-combo-divider', attrs: { 'aria-hidden': 'true' } }),
    el('div', { class: 'solring-combo-h', text: `One card away · ${combos.length} combo${combos.length === 1 ? '' : 's'}` }),
    ...combos.map(nearMissCard),
  );
}
