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

// Horizontal stacked bar of mana sources by type (land / rock / dork / ritual /
// treasure), proportional to count. Segment colours come from solring-mb-seg-* classes.
function sourceMixChart(c) {
  const segs = [['land', c.lands], ['rock', c.rocks], ['dork', c.dorks], ['ritual', c.rituals], ['treasure', c.treasures]]
    .filter(([, v]) => v > 0);
  if (!segs.length) return '';
  const total = segs.reduce((s, [, v]) => s + v, 0);
  const W = 150; const H = 12; let x = 0;
  const rects = segs.map(([key, v]) => {
    const w = (v / total) * W;
    const r = `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" class="solring-mb-seg solring-mb-seg-${key}"><title>${v} ${key}${v === 1 ? '' : 's'}</title></rect>`;
    x += w; return r;
  }).join('');
  const legend = segs.map(([key, v]) => `<span class="solring-mb-key solring-mb-key-${key}">${v} ${key}${v === 1 ? '' : 's'}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="solring-mb-bar" preserveAspectRatio="none">${rects}</svg><div class="solring-mb-leg">${legend}</div>`;
}

// Land sub-types worth calling out beneath the source mix.
function sourceMixCaption(c) {
  const parts = [];
  if (c.basics) parts.push(`${c.basics} basic`);
  if (c.utility) parts.push(`${c.utility} utility`);
  if (c.mdfc) parts.push(`${c.mdfc} MDFC`);
  if (c.fetch) parts.push(`${c.fetch} fetch`);
  if (c.tapped) parts.push(`${c.tapped} tapped`);
  return parts.join(' · ') || null;
}

// Vertical bars: P(k mana sources in the opening 7), labelled 0..n along the x-axis.
function openingHandChart(oh) {
  const pts = (oh || []).filter((d) => Number.isFinite(d.k));
  if (!pts.length) return '';
  const maxP = Math.max(...pts.map((d) => d.p || 0), 0.01);
  const W = 150; const H = 56; const padB = 11; const padT = 3; const gap = 1.5;
  const bw = (W - (pts.length - 1) * gap) / pts.length;
  return `<svg viewBox="0 0 ${W} ${H}" class="solring-mb-oh" role="img" aria-label="Mana sources in the opening hand">`
    + pts.map((d, i) => {
      const h = ((d.p || 0) / maxP) * (H - padT - padB);
      const x = i * (bw + gap); const y = H - padB - Math.max(0, h);
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" class="solring-mb-ohbar"><title>${d.k} sources: ${Math.round((d.p || 0) * 100)}%</title></rect>`
        + `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 3}" class="solring-mc-axis" text-anchor="middle">${d.k}</text>`;
    }).join('') + '</svg>';
}

// One titled diagram cell in the 3-up manabase row.
function diagramCell(title, svgHtml, caption) {
  if (!svgHtml) return null;
  return el('div', { class: 'solring-mb-cell' }, [
    el('div', { class: 'solring-pl-h', text: title }),
    el('div', { class: 'solring-mb-fig', html: svgHtml }),
    caption ? el('div', { class: 'solring-pl-desc', text: caption }) : null,
  ]);
}

// Manabase: a score-out-of-300 header (fixing / quality / curve, each /100) over a row of
// three diagrams — on-curve castability, mana-source mix, and opening-hand source odds.
export function buildManabasePanel(m) {
  const children = [];
  const rows = [['Fixing', m.fixing], ['Quality', m.quality], ['Curve', m.curveScore]]
    .filter(([, v]) => typeof v === 'number')
    .map(([label, v]) => barRow(label, String(Math.round(v)), v));
  if (rows.length) {
    const max = m.overallMax || 300;
    const desc = typeof m.overall === 'number'
      ? `Score ${Math.round(m.overall)} / ${max} · ${Math.round((m.overall / max) * 100)}%`
      : 'Fixing / quality / curve, each out of 100';
    children.push(group('Mana quality', desc, rows));
  }
  const curveHtml = m.curve && m.curve.length
    ? `${manaCurveChart(m.curve)}<div class="solring-mc-legend"><span class="solring-mc-k-actual">This deck</span><span class="solring-mc-k-base">Baseline</span></div>`
    : '';
  const cells = [
    diagramCell('On-curve castability', curveHtml, null),
    diagramCell('Mana sources', sourceMixChart(m.composition || {}), sourceMixCaption(m.composition || {})),
    m.openingHand && m.openingHand.length ? diagramCell('Opening-hand sources', openingHandChart(m.openingHand), 'P(sources in opening 7)') : null,
  ].filter(Boolean);
  if (cells.length) children.push(el('div', { class: 'solring-mb-diagrams' }, cells));
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
