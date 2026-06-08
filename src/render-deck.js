// Deck page: a collapsible CommanderSalt report-card panel injected below
// Moxfield's deck header (.deckheader). Default open when analyzed/cached,
// closed when not yet analyzed. Manual Analyze flow for un-indexed decks.
// Metrics: power, real bracket, commander tier, saltiness, archetype + the four
// letter grades (threat/interaction/wincons/synergy). No deck value, no baseline.

import { parseDeckId } from './moxfield.js';
import { deckMd5, canonicalDeckUrl } from './md5.js';
import { csRatingGrade } from './ratings.js';
import { getDeck, importDeck } from './messaging.js';
import { el, claim, guard, tierFromGrade, isDark } from './dom.js';

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

function renderBody(body, f) {
  body.replaceChildren();
  const num = (n, d = 1) => (typeof n === 'number' && isFinite(n) ? n.toFixed(d) : '—');

  const tiles = el('div', { class: 'solring-tiles' }, [
    tile('Power', el('span', { class: 'solring-num', text: `${num(f.power)} / 10` })),
    tile('Bracket', el('span', { class: 'solring-num', text: f.bracketRealistic != null ? String(f.bracketRealistic) : '—' }), 'realistic'),
    tile('Commander tier', el('span', { class: 'solring-num', text: f.commanderTier != null ? `T${f.commanderTier}` : '—' })),
    tile('Saltiness', gradeChip(csRatingGrade(f.salt, 'saltRating')), `raw ${num(f.salt)}`),
    tile('Archetype', el('span', { class: 'solring-archetype', text: f.archetype || '—' })),
  ]);

  const grades = el('div', { class: 'solring-grades' },
    GRADES.map(([label, key, field]) => el('div', { class: 'solring-grade-row' }, [
      el('span', { class: 'solring-grade-label', text: label }),
      gradeChip(csRatingGrade(f[key], field)),
      el('span', { class: 'solring-grade-score', text: typeof f[key] === 'number' ? num(f[key]) : '—' }),
    ])));

  body.append(tiles, grades);
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

  // Anchor below the whole header block (clears the hero art); fall back to .deckheader.
  const header = await waitFor('.deckheader-wrapper, .deckheader');
  if (!header) return; // private/404 page with no deck header → stay silent
  if (!claim(header, 'deck-panel')) return; // already injected this pass

  const md5 = deckMd5(canonicalDeckUrl(publicId));

  const body = el('div', { class: 'solring-panel-body' });
  const chevron = el('span', { class: 'solring-chevron', text: '▸' });
  const titleBar = el('button', {
    class: 'solring-panel-bar',
    attrs: { type: 'button', 'aria-expanded': 'false' },
  }, [el('span', { class: 'solring-wordmark', text: 'CommanderSalt' }), chevron]);

  const panel = el('div', {
    class: `solring-panel${isDark() ? ' solring-dark' : ''}`,
    attrs: { 'data-solring-root': '' },
  }, [titleBar, body]);

  function setOpen(open) {
    panel.classList.toggle('solring-open', open);
    titleBar.setAttribute('aria-expanded', String(open));
    chevron.textContent = open ? '▾' : '▸';
  }
  titleBar.addEventListener('click', () => setOpen(!panel.classList.contains('solring-open')));

  // insert below the header
  header.insertAdjacentElement('afterend', panel);

  renderMessage(body, 'Loading CommanderSalt…');
  setOpen(false);

  const res = await guardAsync(() => getDeck(md5));
  if (!res || res.error) {
    const retry = el('button', { class: 'solring-btn', text: 'Retry' });
    retry.addEventListener('click', () => {
      panel.remove();
      claimReset(header);
      mount({ waitFor });
    });
    renderMessage(body, 'Couldn’t reach CommanderSalt.', retry);
    setOpen(true);
    return;
  }
  if (res.fields) {
    const f = res.fields;
    if (f.isPrivate || f.isIllegal) { renderMessage(body, 'Private/illegal — CommanderSalt can’t analyze it.'); setOpen(false); return; }
    renderBody(body, f);
    setOpen(true); // analyzed/cached → default open
    return;
  }
  // stub / un-indexed → closed; expand to Analyze
  renderAnalyze(body, canonicalDeckUrl(publicId), md5, (fields) => { renderBody(body, fields); setOpen(true); });
  setOpen(false);
}

function claimReset(node) {
  const set = (node.dataset.solring || '').split(' ').filter((k) => k !== 'deck-panel');
  node.dataset.solring = set.join(' ');
}
