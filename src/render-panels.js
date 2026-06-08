// Deck-level detail panels, each toggled by its metric tile (Saltiness, Power,
// Bracket, Archetype, Synergy). Compact bar/chip layouts; all colors via CSS
// vars so they follow Moxfield light/dark. Hidden by default.

import { el } from './dom.js';
import { prettifyStat, BRACKET_FLAG_LABELS } from './labels.js';

function section(title, children) {
  return el('div', { class: 'solring-panel-section', attrs: { hidden: '' } }, [
    el('div', { class: 'solring-pl-h', text: title }),
    ...children,
  ]);
}

function barRow(label, valueText, pct) {
  const fill = el('span', { style: `width:${Math.max(0, Math.min(100, pct))}%` });
  return el('div', { class: 'solring-pl-row' }, [
    el('span', { class: 'solring-pl-label', text: label }),
    el('span', { class: 'solring-pl-bar' }, [fill]),
    el('span', { class: 'solring-pl-val', text: valueText }),
  ]);
}

const titleWord = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

export function buildSaltPanel(sources) {
  const max = Math.max(...sources.map((s) => s.score), 1);
  return section('Salt sources', sources.map((s) => barRow(prettifyStat(s.cat), s.score.toFixed(1), (s.score / max) * 100)));
}

export function buildPowerPanel(pillars) {
  const order = [['consistency', 'Consistency'], ['efficiency', 'Efficiency'], ['interaction', 'Interaction'], ['winConditions', 'Win conditions'], ['manabase', 'Manabase']];
  return section('Power pillars', order
    .filter(([k]) => typeof pillars[k] === 'number')
    .map(([k, label]) => barRow(label, `${Math.round(pillars[k] * 100)}%`, pillars[k] * 100)));
}

export function buildArchetypePanel(majors, label) {
  return section(label || 'Archetype mix', majors.map((m) => barRow(titleWord(m.name), `${Math.round(m.pct)}%`, m.pct)));
}

export function buildSynergyPanel(anchors) {
  return section('Synergy anchors', anchors.map((a) => barRow(a.name, `${Math.round((a.share || 0) * 100)}%`, (a.share || 0) * 100)));
}

export function buildBracketPanel(baseline, realistic, categories) {
  const chips = categories.map((c) => el('span', { class: 'solring-combo-tag', text: `${BRACKET_FLAG_LABELS[c.key] || c.key} ${c.count}` }));
  const title = `Bracket · baseline ${baseline != null ? baseline : '?'} → realistic ${realistic != null ? realistic : '?'}`;
  return section(title, [
    chips.length
      ? el('div', { class: 'solring-combo-tags' }, chips)
      : el('div', { class: 'solring-msg', text: 'No bracket-defining cards.' }),
  ]);
}
