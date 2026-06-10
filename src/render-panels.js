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

// Multi-line chart: P(k producers of each colour — plus fast mana — in the opening 7).
// One line per series; stroke colours via the solring-mb-oh-* classes.
function openingHandMultiChart(series) {
  const ss = (series || []).filter((s) => s.dist && s.dist.length);
  if (!ss.length) return '';
  const kMax = Math.max(...ss.flatMap((s) => s.dist.map((d) => d.k)), 1);
  const pMax = Math.max(...ss.flatMap((s) => s.dist.map((d) => d.p || 0)), 0.01);
  const W = 200; const H = 92; const padL = 22; const padR = 6; const padT = 6; const padB = 15;
  const X = (k) => padL + (k / kMax) * (W - padL - padR);
  const Y = (p) => padT + (1 - (p || 0) / pMax) * (H - padT - padB);
  const grid = [0, 0.5, 1].map((f) => {
    const y = (padT + (1 - f) * (H - padT - padB));
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" class="solring-mc-grid"/>`
      + `<text x="${padL - 3}" y="${(y + 3).toFixed(1)}" class="solring-mc-axis" text-anchor="end">${Math.round(f * pMax * 100)}</text>`;
  }).join('');
  const lines = ss.map((s) => {
    const d = s.dist.map((pt, i) => `${i ? 'L' : 'M'}${X(pt.k).toFixed(1)} ${Y(pt.p).toFixed(1)}`).join(' ');
    return `<path d="${d}" class="solring-mb-oh-line solring-mb-oh-${s.key === '*' ? 'any' : s.key}"/>`;
  }).join('');
  const xl = Array.from({ length: kMax + 1 }, (_, k) => `<text x="${X(k).toFixed(1)}" y="${H - 3}" class="solring-mc-axis" text-anchor="middle">${k}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="solring-mc" role="img" aria-label="Opening-hand producer probabilities">${grid}${lines}${xl}</svg>`;
}

const OH_KEY_LABEL = { w: 'W', u: 'U', b: 'B', r: 'R', g: 'G', '*': 'Any', c: 'C', fastmana: 'Fast' };
function openingHandLegend(series) {
  return `<div class="solring-mb-leg">${(series || []).map((s) => `<span class="solring-mb-key solring-mb-oh-key-${s.key === '*' ? 'any' : s.key}">${OH_KEY_LABEL[s.key] || s.key}</span>`).join('')}</div>`;
}

// Per-colour coverage: how much of each colour's requirement the deck produces
// (coverageRatio). A midline marks parity (100%); fill past it = surplus, short + red =
// under-produced. The colour letter carries the mana colour, while the fill stays neutral
// so a red-mana SURPLUS isn't mistaken for a deficit warning.
function colorReqProdChart(perColor) {
  const pc = (perColor || []).filter((c) => c.ratio != null);
  if (!pc.length) return '';
  return pc.map((c) => {
    const deficit = c.ratio < 1;
    const fill = Math.max(0, Math.min(1, c.ratio / 2)) * 100; // parity (ratio 1.0) sits at 50%
    return `<div class="solring-mb-cp-row">`
      + `<span class="solring-mb-cp-c solring-mb-cp-${c.color}">${(c.color || '').toUpperCase()}</span>`
      + `<span class="solring-mb-cp-track"><span class="solring-mb-cp-parity"></span>`
      + `<span class="solring-mb-cp-fill${deficit ? ' solring-mb-cp-deficit' : ''}" style="width:${fill.toFixed(0)}%"></span></span>`
      + `<span class="solring-mb-cp-v${deficit ? ' solring-mb-cp-deficit-t' : ''}">${Math.round(c.ratio * 100)}%</span>`
      + `</div>`;
  }).join('');
}

// One titled diagram cell in the manabase diagram row.
function diagramCell(title, svgHtml, caption) {
  if (!svgHtml) return null;
  return el('div', { class: 'solring-mb-cell' }, [
    el('div', { class: 'solring-pl-h', text: title }),
    el('div', { class: 'solring-mb-fig', html: svgHtml }),
    caption ? el('div', { class: 'solring-pl-desc', text: caption }) : null,
  ]);
}

// Compact key/value strip of the headline manabase counts.
function statsStrip(s) {
  if (!s) return null;
  const items = [
    ['Lands', s.lands != null ? String(s.lands) : null],
    ['Sources', s.sources != null ? String(Math.round(s.sources)) : null],
    ['Avg CMC', s.avgCmc != null ? s.avgCmc.toFixed(2) : null],
    ['Fast mana', s.fastMana != null ? String(s.fastMana) : null],
    ['MDFC', s.mdfc != null ? String(s.mdfc) : null],
  ].filter(([, v]) => v != null);
  if (!items.length) return null;
  return el('div', { class: 'solring-mb-stats' }, items.map(([k, v]) => el('div', { class: 'solring-mb-stat' }, [
    el('div', { class: 'solring-mb-stat-v', text: v }),
    el('div', { class: 'solring-mb-stat-k', text: k }),
  ])));
}

// CommanderSalt's own actionable nudges (profile.improve), mapped to short labels.
const IMPROVE_LABELS = {
  addFastManaLands: 'Add fast-mana lands', addFastMana: 'Add fast mana', increaseRamp: 'Increase ramp',
  addRamp: 'Add ramp', addTutors: 'Add tutors', addCounterspells: 'Add counterspells',
  addFetches: 'Add fetch lands', addMdfcLands: 'Add MDFC lands', reduceTapLands: 'Cut tapped lands',
  addUtilityLands: 'Add utility lands', improveFixing: 'Improve fixing',
};
function improveHints(improve) {
  const hints = (improve || []).map((it) => IMPROVE_LABELS[it.id]).filter(Boolean);
  if (!hints.length) return null;
  return el('div', { class: 'solring-mb-improve' }, [
    el('span', { class: 'solring-mb-improve-h', text: 'To improve' }),
    ...hints.map((h) => el('span', { class: 'solring-mb-improve-chip', text: h })),
  ]);
}

// Manabase: stats strip + a score header (axes vs their /100 benchmark) + a row of
// diagrams (on-curve castability · opening-hand producers · colour produced-vs-required,
// falling back to the source mix on colourless decks) + CommanderSalt's improve hints.
export function buildManabasePanel(m) {
  const children = [];
  const strip = statsStrip(m.stats);
  if (strip) children.push(strip);
  // Axis bars are /100 — each axis is scored against its own 100 benchmark (100 = met;
  // bonuses exceed and cap the bar full). Only the headline score is on the /300 scale.
  const rows = [['Fixing', m.fixing], ['Quality', m.quality], ['Curve', m.curveScore]]
    .filter(([, v]) => typeof v === 'number')
    .map(([label, v]) => barRow(label, String(Math.round(v)), v));
  if (rows.length) {
    const max = m.overallMax || 300;
    const desc = typeof m.overall === 'number'
      ? `Score ${Math.round(m.overall)} / ${max} · ${Math.round((m.overall / max) * 100)}% · axes vs their 100 benchmark`
      : 'Each axis vs its 100 benchmark';
    children.push(group('Mana quality', desc, rows));
  }
  const curveHtml = m.curve && m.curve.length
    ? `${manaCurveChart(m.curve)}<div class="solring-mc-legend"><span class="solring-mc-k-actual">This deck</span><span class="solring-mc-k-base">Expected</span></div>`
    : '';
  const ohHtml = m.openingHand && m.openingHand.length
    ? `${openingHandMultiChart(m.openingHand)}${openingHandLegend(m.openingHand)}` : '';
  const cpr = colorReqProdChart(m.perColor);
  const thirdCell = cpr
    ? diagramCell('Colour produced vs required', cpr, 'Past the midline = covered · red = under-produced')
    : diagramCell('Mana sources', sourceMixChart(m.composition || {}), sourceMixCaption(m.composition || {}));
  const cells = [
    diagramCell('On-curve castability', curveHtml, null),
    ohHtml ? diagramCell('Opening-hand producers', ohHtml, '% chance of N in opening 7') : null,
    thirdCell,
  ].filter(Boolean);
  if (cells.length) children.push(el('div', { class: 'solring-mb-diagrams' }, cells));
  const imp = improveHints(m.improve);
  if (imp) children.push(imp);
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
