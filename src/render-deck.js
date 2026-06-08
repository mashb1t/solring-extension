// Deck page: a collapsible CommanderSalt report-card panel injected below
// Moxfield's deck header (.deckheader). Default open when analyzed/cached,
// closed when not yet analyzed. Manual Analyze flow for un-indexed decks.
// Metrics: power, real bracket, commander tier, saltiness, archetype + the four
// letter grades (threat/interaction/wincons/synergy). No deck value, no baseline.

import { parseDeckId } from './moxfield.js';
import { deckMd5, canonicalDeckUrl } from './md5.js';
import { csRatingGrade } from './ratings.js';
import { getDeck, importDeck } from './messaging.js';
import { el, tierFromGrade, isDark } from './dom.js';
import { getCardPrefs, onPrefChange } from './prefs.js';
import { annotate, clearAnnotations } from './render-cards.js';
import { installCustomizeViewToggles } from './customize-view.js';
import { installCommanderSaltLink } from './links-menu.js';

// ---- per-card annotation orchestration (module-scoped, set up once) ----
let currentFields = null;
let deckObserver = null;
let dvRef = null;
let installedOnce = false;

function connectObserver() {
  if (deckObserver && dvRef) deckObserver.observe(dvRef, { childList: true, subtree: true });
}

async function reannotate() {
  if (!currentFields) return;
  const prefs = await getCardPrefs();
  if (deckObserver) deckObserver.disconnect(); // ignore our own mutations
  annotate(currentFields, prefs);
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
  } else {
    deckObserver.disconnect();
  }
  connectObserver();
}

function installOnce() {
  if (installedOnce) return;
  installedOnce = true;
  installCustomizeViewToggles();          // inject Salt Value/Tags/Stats into Customize View
  onPrefChange((which) => { if (which === 'card') reannotate(); });
}

// Begin annotating card rows for this deck: store fields, watch the decklist for
// Moxfield re-renders, and do the first pass.
function startAnnotations(fields) {
  currentFields = fields;
  observeDecklist();
  reannotate();
}

const GRADES = [
  ['Threat', 'threat', 'threatRating'],
  ['Interaction', 'interaction', 'interactionRating'],
  ['Wincons', 'wincons', 'comboRating'],
  ['Synergy', 'synergy', 'synergyRating'],
];

function tile(label, valueNode, sub) {
  return el('div', { class: 'solring-tile' }, [
    el('div', { class: 'solring-tile-label', text: label }),
    el('div', { class: 'solring-tile-value' }, valueNode),
    sub ? el('div', { class: 'solring-tile-sub', text: sub }) : null,
  ]);
}

function gradeChip(grade) {
  return el('span', { class: 'solring-grade', text: grade, attrs: { 'data-tier': tierFromGrade(grade) } });
}

// Bracket value = realistic bracket number, plus an arrow if it differs from the
// baseline (WOTC) bracket: red ↑ when it plays above (high = bad), grey ↓ below.
function bracketValue(f) {
  const real = f.bracketRealistic;
  const base = f.bracketBaseline;
  const node = el('span', { class: 'solring-num', text: real != null ? String(real) : '—' });
  if (real != null && base != null && real !== base) {
    const up = real > base;
    node.append(el('span', {
      class: `solring-bracket-arrow ${up ? 'solring-bracket-up' : 'solring-bracket-down'}`,
      text: up ? ' ↑' : ' ↓',
      title: `${up ? 'Plays above' : 'Plays below'} its baseline bracket (${base} → ${real})`,
    }));
  }
  return node;
}

function renderBody(body, f) {
  body.replaceChildren();
  const num = (n, d = 1) => (typeof n === 'number' && isFinite(n) ? n.toFixed(d) : '—');
  // grade-style tile: big colored letter grade + raw score sub (like Saltiness)
  const gradeTile = (label, key, field) =>
    tile(label, gradeChip(csRatingGrade(f[key], field)), typeof f[key] === 'number' ? `raw ${num(f[key])}` : '—');

  // Row 1: the headline tiles.
  const mainTiles = el('div', { class: 'solring-tiles' }, [
    tile('Power', el('span', { class: 'solring-num', text: `${num(f.power)} / 10` }),
      typeof f.power === 'number' ? String(f.power) : null),
    tile('Bracket', bracketValue(f), 'realistic'),
    tile('Commander tier', el('span', { class: 'solring-num', text: f.commanderTier != null ? `T${f.commanderTier}` : '—' })),
    gradeTile('Saltiness', 'salt', 'saltRating'),
    tile('Archetype', el('span', { class: 'solring-archetype', text: f.archetype || '—' })),
  ]);

  // Row 2: the report-card grades.
  const gradeTiles = el('div', { class: 'solring-tiles solring-grade-tiles' },
    GRADES.map(([label, key, field]) => gradeTile(label, key, field)));

  body.append(mainTiles, gradeTiles);
}

function renderMessage(body, text, action) {
  body.replaceChildren(el('div', { class: 'solring-msg', text }), action || null);
}

function renderAnalyze(body, canonicalUrl, md5, onResult) {
  const btn = el('button', { class: 'solring-btn', text: 'Analyze on CommanderSalt' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Analyzing… (~5s)';
    const res = await guardAsync(() => importDeck(canonicalUrl, md5));
    if (res && res.fields) return onResult(res.fields);
    if (res && res.unanalyzable) return renderMessage(body, 'Couldn’t analyze — deck appears private, non-Commander, or illegal.');
    btn.disabled = false;
    btn.textContent = 'Analyze on CommanderSalt — retry';
  });
  renderMessage(body, 'Not analyzed on CommanderSalt yet.', btn);
}

async function guardAsync(fn) {
  try { return await fn(); } catch (e) { console.warn('[solring]', e); return { error: String(e) }; }
}

export async function mount({ waitFor }) {
  const publicId = parseDeckId(location.href);
  if (!publicId) return;

  // Anchor in the slot below the "Support us on Patreon" banner and above the
  // Primer/Playtest toolbar — i.e. just before the deck-body container. The
  // toolbar is the container's previous sibling (a div containing Primer/Playtest).
  const deckview = await waitFor('section.deckview');
  if (!deckview) return; // private/404 page with no decklist → stay silent
  const container = deckview.closest('.container') || deckview;
  // Toolbar = the container's previous sibling whose text contains the deck
  // actions (Moxfield concatenates them without spaces, so no \b boundaries).
  const prev = container.previousElementSibling;
  const toolbar = prev && /Playtest|Primer/i.test(prev.textContent || '') ? prev : null;
  const anchor = toolbar || container;
  const parent = anchor.parentElement;
  if (!parent || parent.querySelector(':scope > .solring-container')) return; // already injected

  const md5 = deckMd5(canonicalDeckUrl(publicId));

  const body = el('div', { class: 'solring-panel-body' });
  const chevron = el('span', { class: 'solring-chevron', text: '▸' });
  const synced = el('span', { class: 'solring-synced' });
  const refreshBtn = el('button', {
    class: 'solring-refresh', text: '↻',
    attrs: { type: 'button', 'aria-label': 'Refresh from CommanderSalt', title: 'Refresh from CommanderSalt' },
  });
  // Bar is a role=button div (so the refresh <button> can nest without invalid HTML).
  const titleBar = el('div', { class: 'solring-panel-bar', attrs: { role: 'button', tabindex: '0', 'aria-expanded': 'false' } }, [
    el('span', { class: 'solring-wordmark', text: 'CommanderSalt' }),
    el('span', { class: 'solring-bar-right' }, [synced, refreshBtn, chevron]),
  ]);

  const panel = el('div', { class: `solring-panel${isDark() ? ' solring-dark' : ''}` }, [titleBar, body]);
  // Wrap in a Bootstrap .container so the panel aligns with the deck body width.
  const wrap = el('div', { class: 'container mt-3 solring-container', attrs: { 'data-solring-root': '' } }, [panel]);

  function setOpen(open) {
    panel.classList.toggle('solring-open', open);
    titleBar.setAttribute('aria-expanded', String(open));
    chevron.textContent = open ? '▾' : '▸';
  }
  const toggle = () => setOpen(!panel.classList.contains('solring-open'));
  titleBar.addEventListener('click', toggle);
  titleBar.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  refreshBtn.addEventListener('click', (e) => { e.stopPropagation(); doRefresh(); });

  function relTime(ts) {
    if (!ts) return '';
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
  }
  function setSynced(ts) {
    synced.textContent = ts ? `synced ${relTime(ts)}` : '';
    synced.title = ts ? new Date(ts).toLocaleString() : '';
  }
  async function doRefresh() {
    refreshBtn.classList.add('solring-spin');
    refreshBtn.disabled = true;
    const fresh = await guardAsync(() => getDeck(md5, true));
    refreshBtn.classList.remove('solring-spin');
    refreshBtn.disabled = false;
    if (fresh && fresh.fields) { showFields(fresh.fields); setSynced(fresh.fetchedAt || Date.now()); }
  }

  // insert just above the Primer/Playtest toolbar (the orange slot)
  parent.insertBefore(wrap, anchor);

  // always-on integrations (independent of whether the deck is analyzed)
  installOnce();
  installCommanderSaltLink(md5);

  renderMessage(body, 'Loading CommanderSalt…');
  setOpen(false);

  const res = await guardAsync(() => getDeck(md5));
  if (!res || res.error) {
    const retry = el('button', { class: 'solring-btn', text: 'Retry' });
    retry.addEventListener('click', () => {
      wrap.remove();
      mount({ waitFor });
    });
    renderMessage(body, 'Couldn’t reach CommanderSalt.', retry);
    setOpen(true);
    return;
  }
  const SOFT_TTL_MS = 10 * 60 * 1000; // trust cache within 10 min; auto-revalidate when older
  let shown = null;
  function showFields(f) {
    if (f.isPrivate || f.isIllegal) {
      renderMessage(body, 'Private/illegal — CommanderSalt can’t analyze it.');
      setOpen(false);
      currentFields = null;
      clearAnnotations();
      shown = f;
      return;
    }
    renderBody(body, f);
    setOpen(true); // analyzed/cached → default open
    startAnnotations(f);
    shown = f;
  }

  // A deck's analysis can change anytime, so an instant cached paint is followed
  // by a foreground revalidation that re-renders only if the values changed.
  async function revalidate() {
    const fresh = await guardAsync(() => getDeck(md5, true));
    if (fresh && fresh.fields) {
      if (JSON.stringify(fresh.fields) !== JSON.stringify(shown)) showFields(fresh.fields);
      setSynced(fresh.fetchedAt || Date.now());
    }
  }

  if (res.fields) {
    showFields(res.fields);
    setSynced(res.fetchedAt);
    const stale = !res.fetchedAt || (Date.now() - res.fetchedAt) > SOFT_TTL_MS;
    if (res.cached && stale) revalidate(); // soft-TTL auto-refresh; otherwise trust cache
    return;
  }
  // stub / un-indexed → closed; expand to Analyze
  currentFields = null;
  clearAnnotations();
  renderAnalyze(body, canonicalDeckUrl(publicId), md5, showFields);
  setOpen(false);
}
