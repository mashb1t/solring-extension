// Shared presentational components for the injected report-card UIs. Extracted so
// the deck panel (render-deck.js), the deck-list strip (decklist.js), and the
// profile averages (render-user.js) render identical tiles / grade chips / bracket
// values instead of each re-implementing them. Pure DOM builders, no state.

import { el, tierFromGrade } from './dom.js';

/** A metric tile: label, value node(s), optional sub-line. */
export function tile(label, valueNode, sub) {
  return el('div', { class: 'solring-tile' }, [
    el('div', { class: 'solring-tile-label', text: label }),
    el('div', { class: 'solring-tile-value' }, valueNode),
    sub ? el('div', { class: 'solring-tile-sub', text: sub }) : null,
  ]);
}

/** A–D letter-grade chip, colored by tier via [data-tier] (a=red worst … d=green best).
    Split into letter + modifier (+/–) spans so a fixed-width modifier slot (in list
    columns) lines the letters up regardless of suffix — "A" sits at the same x as the
    "B" in "B–". */
export function gradeChip(grade) {
  const g = String(grade);
  return el('span', { class: 'solring-grade', attrs: { 'data-tier': tierFromGrade(g) } }, [
    el('span', { class: 'solring-grade-letter', text: g.slice(0, 1) }),
    el('span', { class: 'solring-grade-mod', text: g.slice(1) }), // '+', '–', or ''
  ]);
}

// Bracket value = realistic bracket number, plus an arrow if it differs from the
// baseline (WOTC) bracket: red ↑ when it plays above (high = bad), grey ↓ below.
// Reads bracketRealistic/bracketBaseline; a search hit (no baseline) gets no arrow,
// so callers normalize hit.bracketRating into bracketRealistic before calling.
export function bracketValue(f) {
  const real = f.bracketRealistic;
  const base = f.bracketBaseline;
  const node = el('span', { class: 'solring-num', text: real != null ? String(real) : '—' });
  // Always emit the arrow slot (empty when no delta) so a fixed-width slot in list
  // columns keeps the bracket numbers aligned whether or not an arrow is present.
  const arrow = el('span', { class: 'solring-bracket-arrow' });
  if (real != null && base != null && real !== base) {
    const up = real > base;
    arrow.classList.add(up ? 'solring-bracket-up' : 'solring-bracket-down');
    arrow.textContent = up ? '↑' : '↓';
    arrow.title = `${up ? 'Plays above' : 'Plays below'} its baseline bracket (${base} → ${real})`;
  }
  node.append(arrow);
  return node;
}

/** Bracket-flag chips as a bare span array (`.solring-flag`). The caller supplies the
    container — both call sites render flags first, then tags (see `tagChips`). */
export function flagChips(flags) {
  return (flags || []).map((f) => el('span', { class: 'solring-flag', text: f }));
}

/** CommanderSalt tag chips as a bare span array (`.solring-tag`). Caller-owned container.
    (The combo panel has its own `.solring-combo-tag` variant — kept local there.) */
export function tagChips(tags) {
  return (tags || []).map((t) => el('span', { class: 'solring-tag', text: t }));
}
