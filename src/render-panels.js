// Deck-level detail panels, each toggled by its metric tile (Saltiness, Power,
// Bracket, Archetype, Synergy). Compact bar/chip layouts. Colors come from CSS
// vars so they follow Moxfield light/dark. Hidden by default.

import { el } from './dom.js';
import { num } from './format.js';
import { prettifyStat, BRACKET_FLAG_LABELS, humanizeId, humanizeValueMaybe } from './labels.js';
import { cardRefs } from './render-card-modal.js';

function section(title, children) {
  return el('div', { class: 'solring-panel-section', attrs: { hidden: '' } }, [
    el('div', { class: 'solring-pl-h', text: title }),
    ...children,
  ]);
}

function barRow(label, valueText, pct) {
  const fill = el('span', { style: `width:${Math.max(0, Math.min(100, pct))}%` });
  const labelEl = el('span', { class: 'solring-pl-label' });
  if (label && typeof label === 'object' && label.nodeType) labelEl.append(label); // a node, e.g. a linked card name
  else labelEl.textContent = label == null ? '' : String(label);
  return el('div', { class: 'solring-pl-row' }, [
    labelEl,
    el('span', { class: 'solring-pl-bar' }, [fill]),
    el('span', { class: 'solring-pl-val', text: valueText }),
  ]);
}

// Deck-fingerprint stat row (Power panel), same tile style as the manabase header line.
// Power-relevant shape metrics. Null values are dropped.
function fingerprintRow(fp) {
  if (!fp) return null;
  const ca = fp.cardAdvantage;
  const rd = fp.resourceDenial;
  const gy = fp.graveyard;
  const tiles = [
    ['Tutors', fp.tutors, [fp.tutorDensity, fp.tutorQuality != null ? `${fp.tutorQuality.toFixed(1)} avg quality` : null].filter(Boolean).join(' · ') || null],
    ['Ramp', fp.ramp, fp.rampDensity || 'rocks + dorks + …'],
    ['Curve', fp.avgMv != null ? fp.avgMv.toFixed(2) : null, fp.curveShape || 'avg MV'],
    ['Instant-speed', fp.instantRatio != null ? `${Math.round(fp.instantRatio * 100)}%` : null, fp.reactiveDensity ? `${fp.reactiveDensity} reactive` : 'at instant speed'],
    ['Creatures', fp.creatures, fp.permanentRatio != null ? `${Math.round(fp.permanentRatio * 100)}% permanents` : null],
    // Extra profile reads (Tasks 2.2/2.3/2.4). Values are short enum words; keep them
    // as-is (already readable) and drop the whole tile when the field is absent.
    ['Card advantage', ca && ca.draw ? `draw ${ca.draw}` : null, ca && ca.recursion ? `recursion ${ca.recursion}` : null],
    ['Denial', rd && rd.stax ? `stax ${rd.stax}` : null, rd ? [rd.taxes ? `taxes ${rd.taxes}` : null, rd.discard ? `discard ${rd.discard}` : null].filter(Boolean).join(' · ') || null : null],
    ['Graveyard', gy && gy.engagement ? gy.engagement : null, gy ? gy.counts : null],
  ].filter(([, v]) => v != null);
  if (!tiles.length) return null;
  return el('div', { class: 'solring-mb-stats' }, tiles.map(([k, v, s]) => el('div', { class: 'solring-mb-stat' }, [
    el('div', { class: 'solring-mb-stat-k', text: k }),
    el('div', { class: 'solring-mb-stat-v', text: String(v) }),
    s ? el('div', { class: 'solring-mb-stat-s', text: s }) : null,
  ])));
}

const titleWord = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

// humanizeId now lives in labels.js (shared with the deck-list archetype column).

// A labeled list of raw { id, data, direction? } scorer signals: humanized id (+ ↑/↓)
// over its data pairs (keys humanized, camelCase/enum values humanized too so a raw
// "winconInconsistency" reads as "wincon inconsistency"). Null when empty.
function signalGroup(title, entries) {
  if (!(entries || []).length) return null;
  const items = entries.map(({ id, data, direction }) => {
    const pairs = Object.entries(data || {}).map(([k, v]) => `${humanizeId(k).toLowerCase()}: ${humanizeValueMaybe(v)}`).join(' · ');
    const arrow = direction === 'up' ? ' ↑' : direction === 'down' ? ' ↓' : '';
    return el('div', { class: 'solring-sig-item' }, [
      el('span', { class: 'solring-sig-id', text: humanizeId(id) + arrow }),
      pairs ? el('span', { class: 'solring-sig-data', text: pairs }) : null,
    ]);
  });
  return el('div', { class: 'solring-sig-group' }, [el('div', { class: 'solring-pl-h', text: title }), ...items]);
}

// CommanderSalt's boost/penalty (and anti-pattern) severity scale, most to least severe.
// Verified across 23 decks: the non-"none" values are major, notable, minor.
const SEVERITY_RANK = { major: 3, notable: 2, minor: 1 };
// Copy and order entries by severity, most severe first (stable within a level).
const sortBySeverity = (list) => [...list].sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));

// A labeled list of id->severity entries ("Narrow synergy focus, major"), ordered by
// severity (major first, then notable, then minor, stable within a level).
function severityGroup(title, entries) {
  if (!(entries || []).length) return null;
  const sorted = sortBySeverity(entries);
  const items = sorted.map(({ id, severity }) => el('div', { class: 'solring-sig-item' }, [
    el('span', { class: 'solring-sig-id', text: humanizeId(id) }),
    el('span', { class: 'solring-sig-sev', text: String(severity) }),
  ]));
  return el('div', { class: 'solring-sig-group' }, [el('div', { class: 'solring-pl-h', text: title }), ...items]);
}

// Anti-pattern flags: CommanderSalt's own label + "why" string, shown verbatim. Ordered
// by severity (major to minor), same SEVERITY_RANK scale as the boost/penalty lists.
function flagGroup(title, patterns) {
  if (!(patterns || []).length) return null;
  const sorted = sortBySeverity(patterns);
  const items = sorted.map((p) => el('div', { class: 'solring-sig-item' }, [
    el('span', { class: 'solring-sig-id', text: p.label }),
    p.severity ? el('span', { class: 'solring-sig-sev', text: String(p.severity) }) : null,
    p.why ? el('span', { class: 'solring-sig-data', text: p.why }) : null,
  ]));
  return el('div', { class: 'solring-sig-group' }, [el('div', { class: 'solring-pl-h', text: title }), ...items]);
}

export function buildSaltPanel(sources) {
  const max = Math.max(...sources.map((s) => s.score), 1);
  return section('Salt sources', sources.map((s) => barRow(prettifyStat(s.cat), s.score.toFixed(1), (s.score / max) * 100)));
}

const POWER_ORDER = [
  ['consistency', 'Consistency'], ['efficiency', 'Efficiency'], ['interaction', 'Interaction'],
  ['winConditions', 'Win conditions'],
]; // Manabase is excluded: its pillar score is capped at the baseline, so it's always 100%.
// Power pillars vs a baseline, like CommanderSalt's "compare pillar scores against baseline":
// each pillar's raw score over the baseline, as a %. Bars share one scale (highest fills) with
// a 100% baseline line. A Casual/cEDH toggle re-renders in place. Pass { scores, casual, cedh }
// from extract.powerPillars.
export function buildPowerPanel(p, profile, meta) {
  const scores = (p && p.scores) || {};
  const baselines = { casual: (p && p.casual) || {}, cedh: (p && p.cedh) || {} };
  const inferred = meta && meta.inferredType; // 'casual' | 'spike'
  const head = el('div', { class: 'solring-pw-head' }, [
    el('span', { class: 'solring-pl-h', text: 'Power pillars vs baseline' }),
    el('div', { class: 'solring-pw-toggle' }, [
      el('button', { class: 'solring-pw-btn', attrs: { type: 'button', 'data-mode': 'casual' }, text: 'Casual' }),
      el('button', { class: 'solring-pw-btn', attrs: { type: 'button', 'data-mode': 'cedh' }, text: 'cEDH' }),
    ]),
  ]);
  // CS's inferred lens (picks which baseline) plus a fringe-cEDH flag, shown by the toggle,
  // which we default to that lens.
  const note = (inferred || (meta && meta.fringeCEDH)) ? el('div', { class: 'solring-pw-inferred' }, [
    inferred ? el('span', { text: `Classification: ${inferred === 'spike' ? 'spike (cEDH)' : 'casual'}` }) : null,
    meta && meta.fringeCEDH ? el('span', { class: 'solring-pw-fringe', text: 'fringe cEDH' }) : null,
  ]) : null;
  const rows = el('div', { class: 'solring-pw-rows' });
  const render = (mode) => {
    rows.replaceChildren();
    head.querySelectorAll('.solring-pw-btn').forEach((b) => b.classList.toggle('solring-pw-on', b.getAttribute('data-mode') === mode));
    const base = baselines[mode] || {};
    const items = POWER_ORDER
      .filter(([k]) => typeof scores[k] === 'number' && typeof base[k] === 'number')
      .map(([k, label]) => ({ label, pct: (scores[k] / base[k]) * 100 }));
    if (!items.length) return;
    const max = Math.max(...items.map((i) => i.pct), 100);
    for (const it of items) rows.append(barRow(it.label, `${Math.round(it.pct)}%`, (it.pct / max) * 100));
    // 100% baseline line over the bar column (base grid 9rem 1fr 3rem, gap 0.5rem →
    // column starts at 9.5rem, width = track − 13rem).
    rows.append(el('div', {
      class: 'solring-pl-markline',
      attrs: { title: 'baseline (100%)', 'aria-hidden': 'true' },
      style: `left: calc(9.5rem + ${(100 / max).toFixed(3)} * (100% - 13rem))`,
    }));
  };
  head.querySelectorAll('.solring-pw-btn').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation(); render(b.getAttribute('data-mode'));
  }));
  render(inferred === 'spike' ? 'cedh' : 'casual'); // open on the lens CS inferred
  // Deck fingerprint: a stat-tile line (tutors / ramp / curve) like the manabase
  // header, shown top-most, above the pillar bars.
  const fpRow = fingerprintRow(meta && meta.fingerprint);
  const fp = fpRow ? el('div', { class: 'solring-pw-fp' }, [el('div', { class: 'solring-pl-h', text: 'Deck fingerprint' }), fpRow]) : null;
  const sec = el('div', { class: 'solring-panel-section', attrs: { hidden: '' } }, [fp, head, note, rows]);
  // Score cap (Task 2.6): when anti-patterns capped the power score, say so and by how
  // much — answers "why is my power lower than the pillars suggest?". Sits above the flags.
  const cap = meta && meta.antiPatternPenalty;
  if (cap && cap.cap != null) {
    sec.append(el('div', { class: 'solring-sig-group' }, [
      el('div', { class: 'solring-pl-h', text: 'Score cap' }),
      el('div', { class: 'solring-sig-item' }, [
        el('span', { class: 'solring-sig-id', text: `Anti-pattern penalty caps the score at ${num(cap.cap)}` }),
        cap.severity != null ? el('span', { class: 'solring-sig-sev', text: `severity ${cap.severity}` }) : null,
      ]),
    ]));
  }
  // Score drivers: what nudged the final number off the pillar baselines. Laid out as
  // side-by-side columns (wrapping when narrow): boosts up, penalties down, the named
  // anti-patterns, and improvement suggestions.
  if (profile) {
    const cols = [
      severityGroup('Boosts the score', profile.boosts),
      severityGroup('Pulls it down', profile.penalties),
      flagGroup('Anti-pattern flags', profile.antiPatterns),
      signalGroup('Suggestions', profile.improve),
    ].filter(Boolean);
    if (cols.length) sec.append(el('div', { class: 'solring-sig-cols' }, cols));
  }
  return sec;
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

// Synergy: two complementary lenses on the synergy web. Anchors carry the most score,
// Hubs are referenced by the most other entries (connective tissue). Either may be empty.
// `centricity` (commanderCentricity, Task 2.5) rides as a chip on its own row above the
// groups, left-aligned with the bar-row labels (it sits at the section's content edge,
// same as the grid, not floating in the header).
export function buildSynergyPanel(anchors, hubs, centricity) {
  const groups = [];
  if (anchors && anchors.length) {
    groups.push(group('Anchors', 'Cards carrying the biggest share of synergy score',
      anchors.map((a) => barRow(cardRefs([a], { chip: false })[0], `${Math.round((a.share || 0) * 100)}%`, (a.share || 0) * 100))));
  }
  if (hubs && hubs.length) {
    const max = Math.max(...hubs.map((h) => h.connections || 0), 1);
    groups.push(group('Hubs', 'Cards referenced most by other entries',
      hubs.map((h) => barRow(cardRefs([h], { chip: false })[0], String(h.connections), ((h.connections || 0) / max) * 100))));
  }
  const grid = el('div', { class: 'solring-syn-grid' }, groups);
  const children = [];
  if (centricity) {
    children.push(el('div', { class: 'solring-syn-centricity' }, [
      el('span', {
        class: 'solring-flag',
        title: 'How much the deck leans on its commander (detached = keeps working if it is answered; central = folds without it).',
        text: `commander: ${humanizeId(centricity).toLowerCase()}`,
      }),
    ]));
  }
  children.push(grid);
  return el('div', { class: 'solring-panel-section', attrs: { hidden: '' } }, children);
}

// Threat expansion (Task 2.8): the deck's biggest cards by power contribution, plus a
// derived average-quality caption. Deliberately does NOT repeat the tile's "N total".
export function buildThreatPanel(top, avgQuality) {
  const rows = (top || []);
  const max = Math.max(...rows.map((t) => t.score), 1);
  const children = rows.map((t) => barRow(t.name, num(t.score), (t.score / max) * 100));
  if (avgQuality != null) children.push(el('div', { class: 'solring-pl-desc', text: `ø ${num(avgQuality)} quality per card` }));
  return section('Top threats', children);
}

// Commander-tier expansion (Task 2.9): a T1–T5 ladder with the current tier marked. No
// power/score-cap or casual-spike data here (those live in the Power expansion). This is
// the mount point for the Phase 4/5 commander enrichment (EDHREC rank, tournament record).
export function buildCommanderTierPanel(tier) {
  if (tier == null) return null;
  const steps = [1, 2, 3, 4, 5].map((n) => el('span', {
    class: `solring-tier-step${n === tier ? ' solring-tier-step-on' : ''}`,
    text: `T${n}`,
  }));
  return section('Commander tier', [
    el('div', { class: 'solring-tier-ladder' }, steps),
    el('div', { class: 'solring-pl-desc', text: 'CommanderSalt commander tier' }),
  ]);
}

// On-curve castability per turn: this deck's `actual` (solid, filled) against a typical
// `baseline` (dashed). Values are fractions 0 to 1. The SVG holds ONLY geometry. Axis
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
  // preserveAspectRatio=none so the SVG fills its (flex-stretched) box. Strokes hold
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

// Mana source breakdown: card count per source category as label/bar/value rows
// (normalised to the largest category, since lands dominate by design).
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
// "produced" bar. req/prod are CS's own percentages (fractions of one shared scale), so
// the bars compare directly. The ratio label compacts huge surpluses (x6.8, not 684%).
// Deficits (<1x) turn the produced bar + label red.
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

// Mana quality block: the three axes (Fixing / Quality / Curve) on ONE shared scale (the
// highest of the three fills its bar) with a single 100-benchmark line running top to
// bottom across all three, so you read which axes clear par and by how much. Scale floored
// at 100 so the line stays on the track even if all three are below benchmark.
function qualityBlock(m) {
  const axes = [['Fixing', m.fixing], ['Quality', m.quality], ['Curve', m.curveScore]]
    .filter(([, v]) => typeof v === 'number');
  if (!axes.length) return null;
  const max = Math.max(...axes.map(([, v]) => v), 100);
  const rows = axes.map(([label, v]) => barRow(label, String(Math.round(v)), (v / max) * 100));
  // Show the 100 line only when something clears it (max > 100); at ≤ 100 it would just sit
  // at the end of the longest bar and say nothing. One continuous line over the bar column:
  // left = column start (label 3.6rem + gap 0.5rem) + frac of the column width (track −
  // labels 3.6rem − value 2.4rem − two 0.5rem gaps = track − 7rem). Matches the row grid.
  const children = [...rows];
  if (max > 100) {
    children.push(el('div', {
      class: 'solring-pl-markline',
      attrs: { title: '100 benchmark', 'aria-hidden': 'true' },
      style: `left: calc(4.1rem + ${(100 / max).toFixed(3)} * (100% - 7rem))`,
    }));
  }
  return el('div', { class: 'solring-mb-block' }, [
    el('div', { class: 'solring-pl-h', text: 'Mana quality' }),
    el('div', { class: 'solring-mb-quality' }, children),
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

// One column of the profile table: header + count badge over the RAW { id, data }
// entries. The id is humanized as the title, the data key/value pairs sit beneath verbatim.
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
// (quality + colour-coverage bars stacked in one column, the source breakdown in a
// second, the castability chart in the third), and the raw Strengths / Risks /
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

  // Column 1: the three bar widgets stacked, Mana quality, Colour coverage, and the
  // mana-source breakdown (all share the label/bar/value language). Mana quality bars
  // share one scale (highest fills) with a 100-benchmark line, see qualityBlock.
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

// Pre-game disclosure chips (rule-zero): humanized id + its salient data value.
function ruleZeroChips(entries) {
  if (!(entries || []).length) return null;
  const chips = entries.map(({ id, data }) => {
    const vals = Object.values(data || {}).filter((v) => v != null && v !== '');
    return el('span', { class: 'solring-rz-chip', text: vals.length ? `${humanizeId(id)} · ${vals.join(' ')}` : humanizeId(id) });
  });
  return el('div', { class: 'solring-rz' }, [
    el('div', { class: 'solring-pl-h', text: 'Rule-zero notes' }),
    el('div', { class: 'solring-rz-chips' }, chips),
  ]);
}

export function buildBracketPanel(baseline, realistic, categories, profile) {
  const cats = categories || [];
  const prof = profile || {};
  const children = [];
  // 1) Bracket-defining cards: an aligned label / card-names grid (label column sizes to
  // the widest chip so every card list starts at the same left edge).
  if (cats.length) {
    children.push(el('div', { class: 'solring-pl-h', text: 'Bracket-defining cards' }));
    const rows = [];
    for (const c of cats) {
      rows.push(el('span', { class: 'solring-combo-tag', text: `${BRACKET_FLAG_LABELS[c.key] || c.key} ${c.count}` }));
      const cell = el('span', { class: 'solring-bp-cards' });
      cardRefs(c.cards, { chip: false }).forEach((ref, i) => { if (i) cell.append(', '); cell.append(ref); });
      rows.push(cell);
    }
    children.push(el('div', { class: 'solring-bp-grid' }, rows));
  } else {
    children.push(el('div', { class: 'solring-msg', text: 'No bracket-defining cards.' }));
  }
  // 2) Rule-zero notes: pre-game disclosure chips, above the coaching columns.
  const rz = ruleZeroChips(prof.ruleZero);
  if (rz) children.push(rz);
  // 3) Coaching, three columns side by side: why this bracket / how to drop / how to push.
  const cols = [
    signalGroup('Why this bracket', prof.rationale),
    signalGroup('Drop a bracket', prof.soften),
    signalGroup('Push a bracket', prof.harden),
  ].filter(Boolean);
  if (cols.length) children.push(el('div', { class: 'solring-sig-cols' }, cols));
  const title = `Bracket · baseline ${baseline != null ? baseline : '?'} → realistic ${realistic != null ? realistic : '?'}`;
  return section(title, children);
}
