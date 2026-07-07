// Deck page: a collapsible CommanderSalt report-card panel injected below
// Moxfield's deck header (.deckheader). Default open when analyzed/cached,
// closed when not yet analyzed. Manual Analyze flow for un-indexed decks.
// Metrics: power, real bracket, commander tier, saltiness, archetype plus the four
// letter grades (threat/interaction/wincons/synergy). No deck value, no baseline.

import { parseDeckId } from './moxfield.js';
import { deckMd5, canonicalDeckUrl } from './md5.js';
import { csRatingGrade } from './ratings.js';
import { getDeck, importDeck, getEnrichment } from './messaging.js';
import { el, isDark, chevronSvg, registerDisposable } from './dom.js';
import { relTime, num, exact } from './format.js';
import { tile, gradeChip, bracketValue } from './components.js';
import { getCardPrefs, getOptions, onPrefChange, getCardSortView } from './prefs.js';
import { annotate, clearAnnotations } from './render-cards.js';
import { installCustomizeViewToggles } from './customize-view.js';
import { installCommanderSaltLink } from './links-menu.js';
import { installCardModal } from './render-card-modal.js';
import { installCardSidebar } from './render-card-sidebar.js';
import { buildCombosSection, renderSpellbookNearMiss } from './render-combos.js';
import { buildRuleZeroText } from './rule-zero.js';
import { buildSaltPanel, buildPowerPanel, buildArchetypePanel, buildSynergyPanel, buildBracketPanel, buildInteractionPanel, buildManabasePanel, buildThreatPanel, buildCommanderTierPanel, renderEdhrecEnrichment } from './render-panels.js';

// ---- per-card annotation orchestration (module-scoped, set up once) ----
let currentFields = null;
let currentOptions = {}; // prefs:options, loaded on mount, kept fresh on change
let deckObserver = null;
let dvRef = null;
let installedOnce = false;
let syncTimer = null; // ticks the "synced ...ago" label live. Manual refresh only, no auto-revalidate

// Override the injected-UI CSS vars from the options (single value, both themes).
// null = not customized, so removeProperty falls back to the auto-themed default.
function applyOptionColors(o) {
  const root = document.documentElement.style;
  const set = (name, val) => (val ? root.setProperty(name, val) : root.removeProperty(name));
  set('--solring-mark-power', o.powerColor);
  set('--solring-mark-salt', o.saltColor);
  set('--solring-mark-synergy', o.synergyColor);
  const rc = o.ratingColors || {};
  set('--solring-rating-a', rc.a);
  set('--solring-rating-b', rc.b);
  set('--solring-rating-c', rc.c);
  set('--solring-rating-d', rc.d);
}

// Moxfield's deck "last updated" as epoch ms. The word "updated" usually lives on a
// PARENT node, not the <time>/[title] element itself, so we read each candidate's
// absolute date but require an ancestor's text to mention "updated" (and not
// "created", to skip the sibling create-date). Returns null when not found, in which
// case edit-detection is skipped.
function moxfieldLastUpdatedMs() {
  for (const e of document.querySelectorAll('time[datetime], time[title], [title]')) {
    const raw = e.getAttribute('datetime') || e.getAttribute('title');
    const ms = raw ? Date.parse(raw) : NaN;
    if (!Number.isFinite(ms)) continue;
    // The "Last updated" label sits on the timestamp's parent (it and its sibling
    // create-date each have their own row), so element plus parent is enough scope,
    // and shallow enough not to reach a shared ancestor holding both rows.
    const ctx = `${e.textContent || ''} ${e.getAttribute('aria-label') || ''} `
      + `${e.parentElement ? e.parentElement.textContent : ''}`;
    if (/updated/i.test(ctx) && !/\bcreated\b/i.test(ctx)) return ms;
  }
  return null;
}

const cacheMaxAgeMs = (o) => (o.cacheLifetimeDays > 0 ? o.cacheLifetimeDays * 86400000 : 0);

function connectObserver() {
  if (deckObserver && dvRef) deckObserver.observe(dvRef, { childList: true, subtree: true });
}

async function reannotate() {
  if (!currentFields) return;
  const [prefs, cardSort] = await Promise.all([getCardPrefs(), getCardSortView()]);
  if (deckObserver) deckObserver.disconnect(); // ignore our own mutations (incl. row reorder)
  annotate(currentFields, prefs, currentOptions, cardSort);
  connectObserver();
}

// Is this node one the extension injected? (so the observer ignores our own churn)
function isOurNode(n) {
  if (!n || n.nodeType !== 1) return false;
  const cls = typeof n.className === 'string' ? n.className : '';
  if (cls.includes('solring')) return true;
  return !!(n.closest && n.closest('[data-solring-root], .solring-card-anno, .solring-tags, .solring-salt-cell, .solring-card-detail'));
}

// Only a genuine Moxfield re-render of the card rows should trigger re-annotate.
// Hover previews/tooltips and our own mutations must be ignored, or an expanded
// card collapses whenever you mouse over things.
function isCardRow(n) {
  return n.nodeType === 1 && !isOurNode(n)
    && (n.matches?.('a.table-deck-row-link, li') || !!n.querySelector?.('a.table-deck-row-link'));
}
function mutationsAreRelevant(mutations) {
  return mutations.some((m) => {
    if (m.type !== 'childList' || isOurNode(m.target)) return false;
    return [...m.addedNodes, ...m.removedNodes].some(isCardRow);
  });
}

function observeDecklist() {
  dvRef = document.querySelector('section.deckview');
  if (!dvRef) return;
  if (!deckObserver) {
    let raf = null;
    deckObserver = new MutationObserver((mutations) => {
      if (!mutationsAreRelevant(mutations) || raf) return;
      raf = requestAnimationFrame(() => { raf = null; reannotate(); });
    });
    // Router drains this on nav so the decklist observer doesn't outlive its deck (and
    // stale deck fields clear, so the card panels can't render the old deck's data).
    registerDisposable(() => { if (deckObserver) deckObserver.disconnect(); deckObserver = null; dvRef = null; currentFields = null; });
  } else {
    deckObserver.disconnect();
  }
  connectObserver();
}

function installOnce() {
  if (installedOnce) return;
  installedOnce = true;
  wireChartSync();                        // re-equalise manabase chart/tables height on resize
  installCustomizeViewToggles();          // inject Salt Value/Tags/Stats into Customize View
  installCardModal(() => currentFields, () => currentOptions);  // per-card Info panel (card-detail modal)
  installCardSidebar(() => currentFields, () => currentOptions); // mirrored on the deck-page sidebar
  const offPref = onPrefChange(async (which) => {
    if (which === 'card') { reannotate(); return; }
    if (which === 'options') { currentOptions = await getOptions(); applyOptionColors(currentOptions); reannotate(); }
  });
  // Router drains this on nav: drop the prefs listener and reset the once-guard so the
  // next deck re-runs installOnce (which re-installs the card panels it also disposed).
  registerDisposable(() => { offPref(); installedOnce = false; });
}

// Begin annotating card rows for this deck: store fields, watch the decklist for
// Moxfield re-renders, and do the first pass.
function startAnnotations(fields) {
  currentFields = fields;
  observeDecklist();
  reannotate();
}

// Expandable tiles in the current deck panel. In accordion mode (currentOptions
// .accordion, default on, read live at toggle time) opening one closes the rest.
// Reset by renderBody on each (re)render so stale entries don't accumulate.
let expandGroup = [];

// Pin the manabase chart cell's height to the bars column when they sit side by side
// (one flex line) so the diagram and the tables end level. CSS stretch alone can't both
// equalise the cells AND make the SVG fill. The `solring-fill` class switches the SVG
// from natural aspect height to height:100%. Cleared when wrapped (each full-width), so
// the chart keeps its natural height there. Runs after layout (rAF), on open and resize.
function syncChartHeights(scope) {
  for (const grid of (scope || document).querySelectorAll('.solring-mb-grid')) {
    const bars = grid.querySelector('.solring-mb-col-bars');
    const chart = grid.querySelector('.solring-mb-cell-chart');
    if (!bars || !chart) continue;
    chart.classList.remove('solring-fill'); // reset to natural before measuring
    chart.style.height = '';
    const rb = bars.getBoundingClientRect();
    const rc = chart.getBoundingClientRect();
    const sideBySide = Math.abs(rb.top - rc.top) < 2 && Math.round(rb.left) !== Math.round(rc.left);
    if (sideBySide) {
      chart.style.height = `${Math.round(bars.offsetHeight)}px`;
      chart.classList.add('solring-fill');
    }
  }
}
let chartSyncWired = false;
let chartResizeHandler = null;
function wireChartSync() {
  if (chartSyncWired) return;
  chartSyncWired = true;
  let raf = null;
  chartResizeHandler = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; syncChartHeights(document); });
  };
  window.addEventListener('resize', chartResizeHandler);
  // Router drains this on nav so the resize listener doesn't persist for the tab's life.
  registerDisposable(() => {
    if (chartResizeHandler) window.removeEventListener('resize', chartResizeHandler);
    chartResizeHandler = null; chartSyncWired = false;
  });
}

// Make a tile expand/collapse a detail section (appended to `body`, hidden by
// default). The chevron swaps glyph on toggle (down closed / up open), no rotation.
function makeExpandable(tile, section, body) {
  body.append(section);
  tile.classList.add('solring-clickable', 'solring-expandable');
  tile.setAttribute('role', 'button');
  tile.setAttribute('tabindex', '0');
  tile.setAttribute('aria-expanded', 'false');
  // Symmetric SVG chevron, CSS rotates it 180 degrees when closed (stays centered).
  const chev = el('span', { class: 'solring-tile-chev', attrs: { 'aria-hidden': 'true' } }, [chevronSvg()]);
  tile.append(chev);
  const setOpen = (open) => {
    if (open) section.removeAttribute('hidden'); else section.setAttribute('hidden', '');
    tile.classList.toggle('solring-open', open);
    tile.setAttribute('aria-expanded', String(open));
  };
  const entry = { close: () => setOpen(false) };
  expandGroup.push(entry);
  const toggle = () => {
    const willOpen = section.hasAttribute('hidden');
    // Accordion: opening a tile collapses every other open one in the panel.
    if (willOpen && currentOptions.accordion !== false) {
      for (const e of expandGroup) if (e !== entry) e.close();
    }
    setOpen(willOpen);
    // Equalise the manabase chart/tables heights once the section is laid out.
    if (willOpen && section.querySelector('.solring-mb-grid')) requestAnimationFrame(() => syncChartHeights(section));
  };
  tile.addEventListener('click', toggle);
  tile.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
}

function renderBody(body, f) {
  body.replaceChildren();
  expandGroup = []; // fresh accordion group for this render
  // grade-style tile: big colored letter grade plus raw score sub (like Saltiness)
  const gradeTile = (label, key, field) =>
    tile(label, gradeChip(csRatingGrade(f[key], field)), typeof f[key] === 'number' ? `${num(f[key])} total` : '—');

  // Row 1: the headline tiles. Power subline shows the precise 0-10 rating and the
  // deck's raw total power score (scoring.total), what per-card contributions sum to.
  // Precise 0-10 rating at 2 decimals (the tile value shows 1). Never the raw
  // 12-digit float that powerLevelRating carries.
  const powerSub = typeof f.power === 'number'
    ? `${exact(f.power)}${f.powerScoreTotal ? ` · ${num(f.powerScoreTotal)} total` : ''}`
    : null;
  const tierTile = tile('Commander tier', el('span', { class: 'solring-num', text: f.commanderTier != null ? `T${f.commanderTier}` : '—' }));
  // Tagged so loadEdhrecEnrichment (resolves later, async) can find this tile and set its
  // subline to the EDHREC rank once enrichment arrives — the tile itself renders before
  // that fetch settles, with no subline yet.
  tierTile.dataset.solringTile = 'tier';
  // cEDH classification chip next to the power total: 'fringe cEDH' when borderline,
  // else 'cEDH' for a solid spike deck (casual decks get none).
  const cedhChip = f.fringeCEDH ? 'fringe cEDH' : (f.inferredType === 'spike' ? 'cEDH' : null);
  const powerVal = [el('span', { class: 'solring-num', text: `${num(f.power)} / 10` })];
  if (cedhChip) powerVal.push(el('span', { class: 'solring-pw-fringe solring-cedh-chip', text: cedhChip }));
  const powerTile = tile('Power', powerVal, powerSub);
  const bracketTile = tile('Bracket', [`${f.bracketBaseline} / `, bracketValue(f)], 'baseline / realistic');
  // Manabase: percentages.overall is a PERCENT of the benchmark (the curve axis vs its
  // 100 par, CommanderSalt's Nutrition Facts total "% daily value"), so 111% = 11% over
  // par. NOT shown as "/300": that widget framing divides a percent by the sum of the
  // axis benchmarks and makes a solid manabase (100%) read as a failing 33%.
  const mb = f.manabase || {};
  const mbc = mb.composition || {};
  const mbOv = typeof mb.overall === 'number' ? Math.round(mb.overall) : null;
  const mbBench = mbOv == null ? null
    : (mbOv > 100 ? `${mbOv - 100}% over benchmark` : mbOv < 100 ? `${100 - mbOv}% under benchmark` : 'meets benchmark');
  const manabaseTile = tile('Manabase',
    el('span', { class: 'solring-num', text: mbOv != null ? `${mbOv}%` : '—' }),
    mbBench);
  const archTile = tile('Archetype', el('span', { class: 'solring-archetype', text: f.archetype || '—' }));
  const mainTiles = el('div', { class: 'solring-tiles' }, [powerTile, bracketTile, tierTile, manabaseTile, archTile]);

  // Row 2: the report-card grades. Wincons folds in the deck's combos (its panel holds
  // the combo list). Saltiness moves down here so Manabase can take its slot up top.
  const threatTile = gradeTile('Threat', 'threat', 'threatRating');
  const interactionTile = gradeTile('Interaction', 'interaction', 'interactionRating');
  const hasCombos = !!(f.combos && f.combos.length);
  const winconsSub = typeof f.wincons === 'number'
    ? `${num(f.wincons)} total${f.combosCount != null ? ` · ${f.combosCount} combo${f.combosCount === 1 ? '' : 's'}` : ''}`
    : '—';
  const winconsTile = tile('Wincons', gradeChip(csRatingGrade(f.wincons, 'comboRating')), winconsSub);
  winconsTile.classList.add('solring-wincons-tile'); // marker: the async spellbook loader appends the "one card away" count to its subline
  const synergyTile = gradeTile('Synergy', 'synergy', 'synergyRating');
  // Saltiness (Task 2.1): keep the grade + "N total", append the personality headline +
  // intensity, and hang the full hint sentence off the tile as a tooltip.
  const saltSub = typeof f.salt === 'number'
    ? `${num(f.salt)} total${f.saltPersonality ? ` · ${f.saltPersonality.headline}${f.saltPersonality.intensity ? ` · ${f.saltPersonality.intensity}` : ''}` : ''}`
    : '—';
  const saltTile = tile('Saltiness', gradeChip(csRatingGrade(f.salt, 'saltRating')), saltSub);
  if (f.saltPersonality && f.saltPersonality.hint) saltTile.title = f.saltPersonality.hint;
  const gradeTiles = el('div', { class: 'solring-tiles solring-grade-tiles' },
    [threatTile, interactionTile, winconsTile, synergyTile, saltTile]);

  body.append(mainTiles, gradeTiles);

  // Each tile expands its own detail panel (hidden until clicked).
  const wp = f.winconProfile;
  const hasWincon = hasCombos || !!(wp && ((wp.paths && wp.paths.length) || (wp.combos && wp.combos.count)));
  if (hasWincon) makeExpandable(winconsTile, buildCombosSection(f.combos, wp), body);
  if ((mb.curve && mb.curve.length) || mbc.lands || (mb.strengths && mb.strengths.length)) makeExpandable(manabaseTile, buildManabasePanel(mb), body);
  if (f.powerPillars && f.powerPillars.scores && Object.keys(f.powerPillars.scores).length) makeExpandable(powerTile, buildPowerPanel(f.powerPillars, f.powerProfile, { inferredType: f.inferredType, fringeCEDH: f.fringeCEDH, fingerprint: f.powerFingerprint, antiPatternPenalty: f.antiPatternPenalty, history: f.powerHistory }), body);
  // Threat expansion (2.8): top cards by power contribution + avg quality per card.
  if (f.threatTop && f.threatTop.length) {
    const avgQuality = typeof f.threat === 'number' && f.cards ? f.threat / Math.max(1, Object.keys(f.cards).length) : null;
    makeExpandable(threatTile, buildThreatPanel(f.threatTop, avgQuality), body);
  }
  // Commander-tier expansion (2.9): the tier ladder (Phase 4/5 enrichment mount point).
  if (f.commanderTier != null) {
    const tierPanel = buildCommanderTierPanel(f.commanderTier);
    if (tierPanel) makeExpandable(tierTile, tierPanel, body);
  }
  const bp = f.bracketProfile || {};
  const hasBracket = (f.bracketCategories && f.bracketCategories.length)
    || [bp.rationale, bp.soften, bp.harden, bp.ruleZero].some((l) => l && l.length);
  if (hasBracket) makeExpandable(bracketTile, buildBracketPanel(f.bracketBaseline, f.bracketRealistic, f.bracketCategories, f.bracketProfile), body);
  if (f.saltSources && f.saltSources.length) makeExpandable(saltTile, buildSaltPanel(f.saltSources), body);
  if (f.archetypeMajors && f.archetypeMajors.length) makeExpandable(archTile, buildArchetypePanel(f.archetypeMajors, f.archetype), body);
  if ((f.synergyAnchors && f.synergyAnchors.length) || (f.synergyHubs && f.synergyHubs.length) || f.synergyCentricity) makeExpandable(synergyTile, buildSynergyPanel(f.synergyAnchors, f.synergyHubs, f.synergyCentricity), body);
  if (f.interactionParts && f.interactionParts.length) makeExpandable(interactionTile, buildInteractionPanel(f.interactionParts), body);
}

function renderMessage(body, text, action) {
  // Don't pass a null child: replaceChildren stringifies it into a literal "null".
  const kids = [el('div', { class: 'solring-msg', text })];
  if (action) kids.push(action);
  body.replaceChildren(...kids);
}

function renderAnalyze(body, canonicalUrl, md5, onResult) {
  const btn = el('button', { class: 'solring-btn', text: 'Analyze' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Analyzing… (~5s)';
    const res = await guardAsync(() => importDeck(canonicalUrl, md5));
    if (res && res.fields) return onResult(res.fields);
    if (res && res.unanalyzable) return renderMessage(body, 'Couldn’t analyze - deck appears to be private, non-Commander, or illegal.');
    btn.disabled = false;
    btn.textContent = 'Analyze - retry';
  });
  renderMessage(body, 'Not analyzed yet.', btn);
}

async function guardAsync(fn) {
  try { return await fn(); } catch (e) { console.warn('[solring]', e); return { error: String(e) }; }
}

export async function mount({ waitFor }) {
  const publicId = parseDeckId(location.href);
  if (!publicId) return;

  // Anchor in the slot below the "Support us on Patreon" banner and above the
  // Primer/Playtest toolbar, i.e. just before the deck-body container. The
  // toolbar is the container's previous sibling (a div containing Primer/Playtest).
  const deckview = await waitFor('section.deckview');
  if (!deckview) return; // private/404 page with no decklist, stay silent
  // If the SPA navigated to a different deck while we awaited, abort. Otherwise this
  // stale mount injects a panel for the old URL next to the new deck's (two panels).
  if (parseDeckId(location.href) !== publicId) return;
  const container = deckview.closest('.container') || deckview;
  // Toolbar = the container's previous sibling whose text contains the deck
  // actions (Moxfield concatenates them without spaces, so no \b boundaries).
  const prev = container.previousElementSibling;
  const toolbar = prev && /Playtest|Primer/i.test(prev.textContent || '') ? prev : null;
  const anchor = toolbar || container;
  const parent = anchor.parentElement;
  if (!parent || parent.querySelector(':scope > .solring-container')) return; // already injected

  const canonicalUrl = canonicalDeckUrl(publicId);
  const md5 = deckMd5(canonicalUrl);

  currentOptions = await getOptions();
  applyOptionColors(currentOptions);
  // Deck panel initial state: 'open'/'collapsed' force it, 'auto' opens when analyzed.
  const panelOpenFor = (analyzed) => (currentOptions.deckPanelDefault === 'open' ? true
    : currentOptions.deckPanelDefault === 'collapsed' ? false : analyzed);

  const body = el('div', { class: 'solring-panel-body' });

  // EDHREC enrichment: resolves AFTER renderBody/startAnnotations, so guard against the
  // panel being torn down or the SPA having navigated to another deck before injecting.
  async function loadEdhrecEnrichment() {
    if (currentOptions.sources && currentOptions.sources.edhrec === false) return;
    const data = await guardAsync(() => getEnrichment('edhrec', md5));
    if (parseDeckId(location.href) !== publicId) return;     // navigated away
    if (!data || data.error || data.miss) return;
    // per-card badges (Task 4.5): stash the inclusion map on the live fields + repaint
    if (currentFields && data.inclusion) { currentFields.edhrecInclusion = data.inclusion; reannotate(); }
    if (!body.isConnected) return;
    const slot = body.querySelector('.solring-edhrec-slot');
    if (slot && slot.isConnected) renderEdhrecEnrichment(slot, data);
    // Commander-tier tile subline: "EDHREC #<rank> · ~<N> decks", only once the enrichment
    // resolves (the tile rendered before this fetch settled, so it started with no subline).
    const pop = data.popularity || {};
    const subParts = [];
    if (pop.rank) subParts.push(`EDHREC #${pop.rank}`);
    if (pop.deckCount) subParts.push(`~${Number(pop.deckCount).toLocaleString('en-US')} decks`);
    if (subParts.length) {
      const tierTile = body.querySelector('[data-solring-tile="tier"]');
      if (tierTile && tierTile.isConnected) {
        let sub = tierTile.querySelector('.solring-tile-sub');
        if (!sub) {
          sub = el('div', { class: 'solring-tile-sub' });
          tierTile.append(sub);
        }
        sub.textContent = subParts.join(' · ');
      }
    }
  }

  // Commander Spellbook "one card away": resolves after render, fills the near-miss slot in
  // the Wincons/Combos expansion. Same stale-async guard as the EDHREC loader.
  async function loadSpellbookEnrichment() {
    if (currentOptions.sources && currentOptions.sources.spellbook === false) return;
    const data = await guardAsync(() => getEnrichment('spellbook', md5));
    if (parseDeckId(location.href) !== publicId || !body.isConnected) return;
    if (!data || data.error || data.miss) return;
    const slot = body.querySelector('.solring-nearmiss-slot');
    if (slot && slot.isConnected) renderSpellbookNearMiss(slot, data);
    // Surface the "one card away" count next to the deck's combo count in the Wincons tile.
    const n = ((data.nearMiss || []).length);
    const sub = body.querySelector('.solring-wincons-tile .solring-tile-sub');
    if (n && sub && !sub.dataset.nearmiss) { sub.dataset.nearmiss = '1'; sub.textContent += ` · ${n} one away`; }
  }

  const chevron = el('span', { class: 'solring-chevron', attrs: { 'aria-hidden': 'true' } }, [chevronSvg()]);
  const synced = el('span', { class: 'solring-synced' });
  // The refresh glyph lives in its own span so spinning rotates only the icon, not the
  // whole button (border/focus ring stay put).
  const refreshIcon = el('span', { class: 'solring-spin-icon', text: '↻' });
  const refreshBtn = el('button', {
    class: 'solring-refresh',
    attrs: { type: 'button', 'aria-label': 'Analyze', title: 'Analyze (~5s)' },
  }, [refreshIcon]);
  // Rule-zero copy button: pastes a pre-game summary (commander, bracket, salt, combos,
  // anti-patterns). Hidden until a deck is analyzed; flips to a confirmation on click.
  const rzBtn = el('button', {
    class: 'solring-refresh solring-rz-copy',
    attrs: { type: 'button', hidden: '', 'aria-label': 'Copy rule-zero summary', title: 'Copy a rule-zero summary to the clipboard' },
  }, ['Rule 0']);
  rzBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!currentFields) return;
    const title = (document.querySelector('.deckheader h1, .deckheader-wrapper h1, h1') || {}).textContent;
    const text = buildRuleZeroText(currentFields, (title || '').trim());
    try { await navigator.clipboard.writeText(text); rzBtn.textContent = 'Copied ✓'; }
    catch { rzBtn.textContent = 'Copy failed'; }
    setTimeout(() => { rzBtn.textContent = 'Rule 0'; }, 1500);
  });
  // Spin the refresh icon (and disable the button) whenever a fetch is in flight:
  // the initial load, an edit analysis, or a manual refresh.
  const setRefreshSpinning = (on) => { refreshIcon.classList.toggle('solring-spin', on); refreshBtn.disabled = on; };
  // Bar is a role=button div (so the refresh <button> can nest without invalid HTML).
  const titleBar = el('div', { class: 'solring-panel-bar', attrs: { role: 'button', tabindex: '0', 'aria-expanded': 'false' } }, [
    el('span', { class: 'solring-wordmark', text: 'Solring' }),
    el('span', { class: 'solring-bar-right' }, [synced, rzBtn, refreshBtn, chevron]),
  ]);

  const panel = el('div', { class: `solring-panel${isDark() ? ' solring-dark' : ''}` }, [titleBar, body]);
  // Wrap in a Bootstrap .container so the panel aligns with the deck body width.
  const wrap = el('div', { class: 'container mt-3 mb-5 solring-container', attrs: { 'data-solring-root': '' } }, [panel]);

  function setOpen(open) {
    panel.classList.toggle('solring-open', open);
    titleBar.setAttribute('aria-expanded', String(open));
  }
  const toggle = () => setOpen(!panel.classList.contains('solring-open'));
  titleBar.addEventListener('click', toggle);
  titleBar.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  refreshBtn.addEventListener('click', (e) => { e.stopPropagation(); doRefresh(); });

  let lastSync = null;
  function setSynced(ts) {
    lastSync = ts || null;
    synced.textContent = lastSync ? `analyzed ${relTime(lastSync)}` : '';
    synced.title = lastSync ? new Date(lastSync).toLocaleString() : '';
  }
  // Keep the relative "synced ...ago" label current without re-fetching. Clear any
  // ticker left by a prior mount so intervals never stack across SPA navigations.
  clearInterval(syncTimer);
  syncTimer = setInterval(() => { if (lastSync) synced.textContent = `analyzed ${relTime(lastSync)}`; }, 30000);
  registerDisposable(() => clearInterval(syncTimer)); // stop ticking when we leave the deck page
  // The sync button always forces a fresh analysis (POST /decks?url=...&oldDeckId=md5),
  // not just a re-fetch, so decklist edits are reflected. Spins the icon while the
  // ~5s upstream compute runs. (Initial page load still uses the cheap GET/cache.)
  async function doRefresh() {
    setRefreshSpinning(true);
    const fresh = await guardAsync(() => importDeck(canonicalUrl, md5, md5));
    setRefreshSpinning(false);
    if (fresh && fresh.fields) { showFields(fresh.fields, fresh.history); setSynced(fresh.fetchedAt || Date.now()); }
  }

  // insert just above the Primer/Playtest toolbar (the orange slot)
  parent.insertBefore(wrap, anchor);

  // always-on integrations (independent of whether the deck is analyzed)
  installOnce();
  installCommanderSaltLink(md5);

  renderMessage(body, 'Loading statistics…');
  setOpen(false);

  setRefreshSpinning(true); // spin the icon while the initial fetch runs
  const res = await guardAsync(() => getDeck(md5, {
    allowFetch: currentOptions.autoFetch !== false, // off = never hit the network for uncached decks
    maxAgeMs: cacheMaxAgeMs(currentOptions),         // 0 = never expire
  }));
  setRefreshSpinning(false);
  if (!res || res.error) {
    const retry = el('button', { class: 'solring-btn', text: 'Retry' });
    retry.addEventListener('click', () => {
      wrap.remove();
      mount({ waitFor });
    });
    renderMessage(body, 'Couldn’t reach API.', retry);
    setOpen(true);
    return;
  }
  function showFields(f, history) {
    // We only reach here with real (non-stub) analysis. CommanderSalt still returns
    // full metrics for decks it flags isIllegal (banned card / not strictly legal),
    // so render them. Don't mistake the flag for "can't analyze". Genuinely
    // unanalyzable decks (private / un-indexed) come back as stubs and are handled
    // by the Analyze flow below.
    if (history) f.powerHistory = history; // forward-only local power history (Phase 6)
    renderBody(body, f);
    rzBtn.hidden = false; // a real analysis is loaded → enable the rule-zero copy
    setOpen(panelOpenFor(true)); // analyzed: honor the configured default ('auto' opens)
    startAnnotations(f);
    loadEdhrecEnrichment(); // async, fail-silent, guarded
    loadSpellbookEnrichment(); // "one card away" combos, async + guarded
  }

  // When auto-fetch is on, analyze (POST) a deck that Moxfield says was edited
  // after CommanderSalt last analyzed it, else the cached numbers describe a stale
  // decklist. Skipped when Moxfield's "updated" time is unreadable or not newer than
  // analyzedAt. Mirrors the manual refresh (POST /decks?url=...&oldDeckId=md5).
  async function maybeReanalyzeIfEdited(f) {
    if (currentOptions.autoFetch === false || !f || !f.analyzedAt) return;
    const mox = moxfieldLastUpdatedMs();
    if (!mox || mox <= f.analyzedAt) return;
    setRefreshSpinning(true);
    const fresh = await guardAsync(() => importDeck(canonicalUrl, md5, md5));
    setRefreshSpinning(false);
    if (fresh && fresh.fields) { showFields(fresh.fields, fresh.history); setSynced(fresh.fetchedAt || Date.now()); }
  }

  // Stats never auto-revalidate on a timer: an analysis can change anytime, but a
  // silent background refresh would shift the numbers under the user. We paint the
  // cached values and leave updating to the manual refresh button. The "synced ...ago"
  // label (ticked live above) keeps the staleness visible. The one exception is an
  // edited decklist (above), which auto-fetch analyzes so the data stays truthful.
  if (res.fields) {
    showFields(res.fields, res.history);
    setSynced(res.fetchedAt);
    maybeReanalyzeIfEdited(res.fields);
    return;
  }
  // stub / un-indexed / cold miss with auto-fetch off: honor default, expand to Analyze
  currentFields = null;
  clearAnnotations();
  renderAnalyze(body, canonicalDeckUrl(publicId), md5, showFields);
  setOpen(panelOpenFor(false));
}
