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

/** A compact inline label · bar · value row for the deck-list strip and averages.
    `pct` (0–100) sets the fill width; `tier` (a–d) optionally colors the fill. */
export function miniBar(label, valueText, pct, tier) {
  const fill = el('span', { class: 'solring-mini-fill', style: `width:${Math.max(0, Math.min(100, pct || 0))}%` });
  return el('span', { class: `solring-mini${tier ? ` solring-tier-${tier}` : ''}` }, [
    el('span', { class: 'solring-mini-label', text: label }),
    el('span', { class: 'solring-mini-bar' }, [fill]),
    el('span', { class: 'solring-mini-val', text: valueText }),
  ]);
}
