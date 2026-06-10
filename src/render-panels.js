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

// A labelled group inside a panel: header + one-line description + bar rows.
function group(title, desc, rows) {
  return el('div', { class: 'solring-pl-group' }, [
    el('div', { class: 'solring-pl-h', text: title }),
    el('div', { class: 'solring-pl-desc', text: desc }),
    ...rows,
  ]);
}

// Synergy: two complementary lenses on the synergy web — Anchors carry the most score,
// Hubs are referenced by the most other entries (connective tissue). Either may be empty.
export function buildSynergyPanel(anchors, hubs) {
  const groups = [];
  if (anchors && anchors.length) {
    groups.push(group('Anchors', 'Cards carrying the biggest share of synergy score',
      anchors.map((a) => barRow(a.name, `${Math.round((a.share || 0) * 100)}%`, (a.share || 0) * 100))));
  }
  if (hubs && hubs.length) {
    const max = Math.max(...hubs.map((h) => h.connections || 0), 1);
    groups.push(group('Hubs', 'Cards referenced most by other entries',
      hubs.map((h) => barRow(h.name, String(h.connections), ((h.connections || 0) / max) * 100))));
  }
  return el('div', { class: 'solring-panel-section solring-syn-grid', attrs: { hidden: '' } }, groups);
}

// An inline SVG line chart of on-curve castability per turn: this deck's `actual`
// (solid, filled) against a typical `baseline` (dashed). Values are fractions 0–1.
// Returned as a string and injected via el({ html }); strokes use non-scaling-stroke
// so they stay crisp as the SVG scales to the panel width.
function manaCurveChart(curve) {
  const pts = (curve || []).filter((p) => Number.isFinite(p.turn));
  if (!pts.length) return '';
  const W = 280; const H = 96; const padL = 20; const padR = 8; const padT = 8; const padB = 16;
  const turns = pts.map((p) => p.turn);
  const tMin = Math.min(...turns); const tMax = Math.max(...turns);
  const span = Math.max(1, tMax - tMin);
  const clamp = (v) => Math.max(0, Math.min(1, typeof v === 'number' ? v : 0));
  const X = (t) => padL + ((t - tMin) / span) * (W - padL - padR);
  const Y = (v) => padT + (1 - clamp(v)) * (H - padT - padB);
  const path = (key) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.turn).toFixed(1)} ${Y(p[key]).toFixed(1)}`).join(' ');
  const area = `${path('actual')} L${X(tMax).toFixed(1)} ${Y(0).toFixed(1)} L${X(tMin).toFixed(1)} ${Y(0).toFixed(1)} Z`;
  const grid = [0, 0.5, 1].map((v) => `<line x1="${padL}" y1="${Y(v).toFixed(1)}" x2="${W - padR}" y2="${Y(v).toFixed(1)}" class="solring-mc-grid"/>`
    + `<text x="${padL - 3}" y="${(Y(v) + 3).toFixed(1)}" class="solring-mc-axis" text-anchor="end">${v * 100}</text>`).join('');
  const xl = pts.map((p) => `<text x="${X(p.turn).toFixed(1)}" y="${H - 4}" class="solring-mc-axis" text-anchor="middle">${p.turn}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="solring-mc" role="img" aria-label="On-curve castability by turn: this deck vs a typical baseline">`
    + grid
    + `<path d="${area}" class="solring-mc-fill"/>`
    + `<path d="${path('baseline')}" class="solring-mc-base"/>`
    + `<path d="${path('actual')}" class="solring-mc-line"/>`
    + xl + '</svg>';
}

// Manabase: fixing / quality / curve scores (each ~/100) + the castability diagram.
export function buildManabasePanel(m) {
  const children = [];
  const rows = [['Fixing', m.fixing], ['Quality', m.quality], ['Curve', m.curveScore]]
    .filter(([, v]) => typeof v === 'number')
    .map(([label, v]) => barRow(label, String(Math.round(v)), v));
  if (rows.length) {
    const desc = typeof m.overall === 'number' ? `Overall ${Math.round(m.overall)}% of an ideal manabase` : 'Scores out of ~100 (100 = solid)';
    children.push(group('Mana quality', desc, rows));
  }
  if (m.curve && m.curve.length) {
    children.push(el('div', { class: 'solring-mana-curve' }, [
      el('div', { class: 'solring-pl-h', text: 'On-curve castability' }),
      el('div', { class: 'solring-pl-desc', text: 'Chance your hand is castable by each turn — solid is this deck, dashed is a typical curve.' }),
      el('div', { class: 'solring-mc-wrap', html: manaCurveChart(m.curve) }),
      el('div', { class: 'solring-mc-legend' }, [
        el('span', { class: 'solring-mc-k-actual', text: 'This deck' }),
        el('span', { class: 'solring-mc-k-base', text: 'Baseline' }),
      ]),
    ]));
  }
  return el('div', { class: 'solring-panel-section', attrs: { hidden: '' } }, children);
}

const PART_LABELS = { counters: 'counterspells', boardWipes: 'board wipes', otherControl: 'control', spotRemoval: 'removal', graveyard: 'graveyard' };
export function buildInteractionPanel(parts) {
  const max = Math.max(...parts.map((p) => p.score), 1);
  return section('Interaction breakdown', parts.map((p) => barRow(PART_LABELS[p.cat] || prettifyStat(p.cat), p.score.toFixed(1), (p.score / max) * 100)));
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
