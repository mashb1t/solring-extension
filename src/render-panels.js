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

// On-curve castability per turn: this deck's `actual` (solid, filled) against a typical
// `baseline` (dashed). Values are fractions 0–1. The SVG holds ONLY geometry — axis
// labels live in HTML around it, because SVG <text> scales with the viewBox (there is no
// non-scaling-size vector-effect in browsers) while HTML text keeps its font size at any
// panel width. Strokes stay crisp via non-scaling-stroke.
function manaCurveChart(curve) {
  const pts = (curve || []).filter((p) => Number.isFinite(p.turn));
  if (!pts.length) return '';
  const W = 220; const H = 110; const pad = 2; // pad keeps strokes from clipping at the edges
  const turns = pts.map((p) => p.turn);
  const tMin = Math.min(...turns); const tMax = Math.max(...turns);
  const span = Math.max(1, tMax - tMin);
  const clamp = (v) => Math.max(0, Math.min(1, typeof v === 'number' ? v : 0));
  const X = (t) => pad + ((t - tMin) / span) * (W - 2 * pad);
  const Y = (v) => pad + (1 - clamp(v)) * (H - 2 * pad);
  const path = (key) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.turn).toFixed(1)} ${Y(p[key]).toFixed(1)}`).join(' ');
  const area = `${path('actual')} L${X(tMax).toFixed(1)} ${Y(0).toFixed(1)} L${X(tMin).toFixed(1)} ${Y(0).toFixed(1)} Z`;
  const grid = [0, 0.5, 1].map((v) => `<line x1="${pad}" y1="${Y(v).toFixed(1)}" x2="${W - pad}" y2="${Y(v).toFixed(1)}" class="solring-mc-grid"/>`).join('');
  // preserveAspectRatio=none so the SVG fills its (flex-stretched) box; strokes hold
  // their width via non-scaling-stroke and the data still maps to the gridlines.
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="solring-mc" preserveAspectRatio="none" role="img" aria-label="On-curve castability by turn: this deck vs a typical baseline">`
    + grid
    + `<path d="${area}" class="solring-mc-fill"/>`
    + `<path d="${path('baseline')}" class="solring-mc-base"/>`
    + `<path d="${path('actual')}" class="solring-mc-line"/>`
    + '</svg>';
  const xl = [];
  for (let t = Math.ceil(tMin); t <= tMax; t += 1) xl.push(`<span>${t}</span>`);
  return `<div class="solring-mc-wrap">`
    + `<div class="solring-mc-y"><span>100</span><span>50</span><span>0</span></div>`
    + `<div class="solring-mc-plot">${svg}</div>`
    + `<div class="solring-mc-x">${xl.join('')}</div>`
    + `</div>`;
}

// Mana source breakdown: card count per source category as label·bar·value rows
// (normalised to the largest category — lands dominate by design).
function sourceBreakdownRows(c) {
  const cats = [
    ['Lands', c.lands], ['Land ramp', c.landRamp], ['Rocks', c.rocks],
    ['Dorks', c.dorks], ['Treasures', c.treasures], ['Rituals', c.rituals],
  ].filter(([, v]) => v > 0);
  if (!cats.length) return null;
  const max = Math.max(...cats.map(([, v]) => v), 1);
  return cats.map(([label, v]) => barRow(label, String(v), (v / max) * 100));
}

// Land sub-types worth calling out beneath the source breakdown.
function sourceBreakdownCaption(c) {
  const parts = [];
  if (c.basics) parts.push(`${c.basics} basic`);
  if (c.utility) parts.push(`${c.utility} utility`);
  if (c.mdfc) parts.push(`${c.mdfc} MDFC`);
  if (c.fetch) parts.push(`${c.fetch} fetch`);
  if (c.tapped) parts.push(`${c.tapped} tapped`);
  return parts.join(' · ') || null;
}

// Per-colour production vs requirement, CommanderSalt-style: a grey "required" bar over a
// "produced" bar — req/prod are CS's own percentages (fractions of one shared scale), so
// the bars compare directly. The ×ratio label compacts huge surpluses (×6.8, not 684%);
// deficits (<×1) turn the produced bar + label red.
function colorReqProdChart(perColor) {
  const pc = (perColor || []).filter((c) => c.req != null || c.prod != null);
  if (!pc.length) return '';
  const w = (v) => Math.round(Math.min(1, v || 0) * 100);
  const ratioText = (r) => (r == null ? '' : `×${r >= 10 ? Math.round(r) : r.toFixed(1)}`);
  return pc.map((c) => {
    const deficit = c.ratio != null && c.ratio < 1;
    return `<div class="solring-mb-cp-row">`
      + `<span class="solring-mb-cp-c solring-mb-cp-${c.color}">${(c.color || '').toUpperCase()}</span>`
      + `<span class="solring-mb-cp-bars">`
      + `<span class="solring-mb-cp-track"><span class="solring-mb-cp-req" style="width:${w(c.req)}%"></span></span>`
      + `<span class="solring-mb-cp-track"><span class="solring-mb-cp-prod${deficit ? ' solring-mb-cp-deficit' : ''}" style="width:${w(c.prod)}%"></span></span>`
      + `</span>`
      + `<span class="solring-mb-cp-v${deficit ? ' solring-mb-cp-deficit-t' : ''}">${ratioText(c.ratio)}</span>`
      + `</div>`;
  }).join('');
}

// One titled chart cell in the manabase content row.
function diagramCell(title, svgHtml, caption) {
  if (!svgHtml) return null;
  return el('div', { class: 'solring-mb-cell solring-mb-cell-chart' }, [
    el('div', { class: 'solring-pl-h', text: title }),
    el('div', { class: 'solring-mb-fig', html: svgHtml }),
    caption ? el('div', { class: 'solring-pl-desc', text: caption }) : null,
  ]);
}

// Mana quality block: the three axes (Fixing / Quality / Curve) on ONE shared scale — the
// highest of the three fills its bar — with a single 100-benchmark line running top-to-
// bottom across all three, so you read which axes clear par and by how much. Scale floored
// at 100 so the line stays on the track even if all three are below benchmark.
function qualityBlock(m) {
  const axes = [['Fixing', m.fixing], ['Quality', m.quality], ['Curve', m.curveScore]]
    .filter(([, v]) => typeof v === 'number');
  if (!axes.length) return null;
  const max = Math.max(...axes.map(([, v]) => v), 100);
  const frac = Math.min(1, 100 / max); // marker x as a fraction of the bar column
  const rows = axes.map(([label, v]) => barRow(label, String(Math.round(v)), (v / max) * 100));
  // One continuous line over the bar column: its left = the column's start (label 3.6rem +
  // gap 0.5rem) plus frac of the column width (track − labels 3.6rem − value 2.4rem − two
  // 0.5rem gaps = track − 7rem). Matches the .solring-mb-col-bars .solring-pl-row grid.
  const line = el('div', {
    class: 'solring-pl-markline',
    attrs: { title: '100 benchmark', 'aria-hidden': 'true' },
    style: `left: calc(4.1rem + ${frac.toFixed(3)} * (100% - 7rem))`,
  });
  return el('div', { class: 'solring-mb-block' }, [
    el('div', { class: 'solring-pl-h', text: 'Mana quality' }),
    el('div', { class: 'solring-mb-quality' }, [...rows, line]),
  ]);
}

// A titled block of bar rows for the bars column (Mana quality / Colour coverage).
// `content` is either an array of row elements or an HTML string.
function barBlock(title, content, caption) {
  return el('div', { class: 'solring-mb-block' }, [
    el('div', { class: 'solring-pl-h', text: title }),
    typeof content === 'string' ? el('div', { html: content }) : el('div', {}, content),
    caption ? el('div', { class: 'solring-pl-desc', text: caption }) : null,
  ]);
}

// Header stat tiles: label / value / sub-note, CommanderSalt-style.
function statTiles(s) {
  if (!s) return null;
  const tiles = [
    ['Lands', s.lands, s.expected != null ? `vs ${Math.round(s.expected)} expected` : null],
    ['Total sources', s.sources != null ? Math.round(s.sources) : null, 'lands + rocks + dorks'],
    ['Fast mana', s.fastMana, 'fast-mana lands'],
    ['Avg CMC', s.avgCmc != null ? s.avgCmc.toFixed(2) : null, 'nonland average'],
    ['Base CMC', s.baseCmc, 'sum across nonland'],
    ['Cost reducers', s.costReducers, 'generic mana'],
    ['Reduced cards', s.reducedCards, 'with cost reduction'],
  ].filter(([, v]) => v != null);
  if (!tiles.length) return null;
  return el('div', { class: 'solring-mb-stats' }, tiles.map(([label, value, sub]) => el('div', { class: 'solring-mb-stat' }, [
    el('div', { class: 'solring-mb-stat-k', text: label }),
    el('div', { class: 'solring-mb-stat-v', text: String(value) }),
    sub ? el('div', { class: 'solring-mb-stat-s', text: sub }) : null,
  ])));
}

// camelCase scorer id → readable words ("pipCoverageHigh" → "Pip coverage high").
const humanizeId = (id) => {
  const s = String(id).replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// One column of the profile table: header + count badge over the RAW { id, data }
// entries — the id humanized as the title, the data key/value pairs beneath verbatim.
function profileColumn(title, entries, emptyText) {
  const items = (entries || []).map(({ id, data }) => {
    const pairs = Object.entries(data || {}).map(([k, v]) => `${k}: ${v}`).join(' · ');
    return el('div', { class: 'solring-mb-prof-item' }, [
      el('div', { class: 'solring-mb-prof-id', text: humanizeId(id) }),
      pairs ? el('div', { class: 'solring-mb-prof-data', text: pairs }) : null,
    ]);
  });
  return el('div', { class: 'solring-mb-prof-col' }, [
    el('div', { class: 'solring-mb-prof-head' }, [
      el('span', { class: 'solring-pl-h', text: title }),
      el('span', { class: 'solring-mb-prof-count', text: String((entries || []).length) }),
    ]),
    ...(items.length ? items : [el('div', { class: 'solring-mb-prof-empty', text: emptyText })]),
  ]);
}

// Strengths / Risks / Suggestions, three columns of raw scorer signals.
function profileTable(strengths, risks, improve) {
  if (!(strengths || []).length && !(risks || []).length && !(improve || []).length) return null;
  return el('div', { class: 'solring-mb-prof' }, [
    profileColumn('Strengths', strengths, 'None flagged.'),
    profileColumn('Risks', risks, 'No risks flagged.'),
    profileColumn('Suggestions', improve, 'None.'),
  ]);
}

// Manabase: a header band (title + headline score, then the stat tiles), one content row
// — quality + colour-coverage bars stacked in one column, the source breakdown in a
// second, the castability chart in the third — and the raw Strengths / Risks /
// Suggestions profile table as the footer.
export function buildManabasePanel(m) {
  const children = [];
  // overall is a percent of the benchmark (curve axis vs its 100 par), not a /300 score.
  const ov = typeof m.overall === 'number' ? Math.round(m.overall) : null;
  const bench = ov == null ? null
    : (ov > 100 ? `${ov - 100}% over benchmark` : ov < 100 ? `${100 - ov}% under benchmark` : 'meets benchmark');
  children.push(el('div', { class: 'solring-mb-head' }, [
    el('div', { class: 'solring-mb-head-title' }, [
      'Manabase',
      ov != null ? el('span', { class: 'solring-mb-head-score', text: ` · ${ov}% · ${bench}` }) : null,
    ]),
    statTiles(m.stats),
  ]));

  // Column 1: the three bar widgets stacked — Mana quality, Colour coverage, and the
  // mana-source breakdown (all share the label·bar·value language). Mana quality bars
  // share one scale (highest fills) with a 100-benchmark line — see qualityBlock.
  const barsCol = [];
  const quality = qualityBlock(m);
  if (quality) barsCol.push(quality);
  const cpr = colorReqProdChart(m.perColor);
  if (cpr) barsCol.push(barBlock('Colour produced vs required', cpr, 'Grey = required · red = under-produced'));
  const breakdownRows = sourceBreakdownRows(m.composition || {});
  if (breakdownRows) barsCol.push(barBlock('Mana source breakdown', breakdownRows, sourceBreakdownCaption(m.composition || {})));

  // Column 2: the on-curve castability chart.
  const cells = [];
  if (barsCol.length) cells.push(el('div', { class: 'solring-mb-col-bars' }, barsCol));
  const curveHtml = m.curve && m.curve.length
    ? `${manaCurveChart(m.curve)}<div class="solring-mc-legend"><span class="solring-mc-k-actual">This deck</span><span class="solring-mc-k-base">Expected</span></div>`
    : '';
  if (curveHtml) cells.push(diagramCell('On-curve castability', curveHtml, null));
  if (cells.length) children.push(el('div', { class: 'solring-mb-grid' }, cells));

  const table = profileTable(m.strengths, m.risks, m.improve);
  if (table) children.push(table);
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
