// Per-card CommanderSalt "Info" panel injected into Moxfield's card-detail modal
// (the overlay opened by clicking a card). It lists every per-card metric we hold
// — saltiness, category total, tags, bracket flags, power contribution, salt
// breakdown, synergy — reusing the deck panel's tile/bar/chip/flag design, re-fit
// for the narrow (~220px) sidebar: a fixed 2-up tile grid and stacked bar rows.
//
// Deck-scoped: CommanderSalt is keyed by md5(deck URL), so we only have per-card
// data while a deck is analyzed. The fields are read live via a getter; a bare
// /cards/ page with no deck simply shows nothing.

import { el, isDark } from './dom.js';
import { num } from './format.js';
import { prettifyStat } from './labels.js';
import { normName } from './render-cards.js';
import { powerMark, saltMark, deckAvgPower } from './ratings.js';
import { onPrefChange } from './prefs.js';

const MODAL_SEL = '.modal.show';
// The sticky image/price/buy container; we append the panel inside it (last child,
// below the buy buttons) so it scrolls with the sticky image instead of being
// covered by it. On mobile a media query widens this container to the full column.
const IMG_BOX_SEL = '.deckviewmodal-image-container';

let getFields = () => null;
let getOpts = () => ({});
let observer = null;
let raf = null;

// Match a card name to a per-card entry: raw name → normalized → a DFC-tolerant
// scan (the cards map keys by full "Front // Back", normName strips it). Exported
// so the deck-page sidebar mirror can resolve the same way.
export function lookupCard(fields, name) {
  if (!fields || !fields.cards || !name) return null;
  const cards = fields.cards;
  const raw = name.toLowerCase().trim();
  if (cards[raw]) return cards[raw];
  const n = normName(name);
  if (cards[n]) return cards[n];
  for (const k of Object.keys(cards)) if (normName(k) === n) return cards[k];
  return null;
}

// value is a string (wrapped in .solring-num + optional valueClass for color) or a
// prebuilt node. valueClass uses solring-tier-* — 'a' is red for high salt /
// above-2×-average power; saltTier/powerTier live in ratings.js.
function tile(label, value, sub, valueClass) {
  const node = typeof value === 'string'
    ? el('span', { class: `solring-num${valueClass ? ` ${valueClass}` : ''}`, text: value })
    : value;
  return el('div', { class: 'solring-tile' }, [
    el('div', { class: 'solring-tile-label', text: label }),
    el('div', { class: 'solring-tile-value' }, [].concat(node)),
    sub ? el('div', { class: 'solring-tile-sub', text: sub }) : null,
  ]);
}

// Deck-wide totals (denominators for each card's "/ total") + the average power.
// Both use the deck's authoritative totals: power's scoring.total (powerScoreTotal)
// and salt's saltRating (fields.salt IS the deck total saltiness). Summed per-card
// values are a fallback for older cached decks. Exported for the sidebar mirror.
export function deckStats(fields) {
  const cards = (fields && fields.cards) || {};
  const ids = Object.keys(cards);
  let powerSum = 0;
  let saltSum = 0;
  for (const k of ids) { powerSum += cards[k].powerTotal || 0; saltSum += cards[k].salt || 0; }
  const powerTotal = (fields && fields.powerScoreTotal) || powerSum;
  const saltTotal = (fields && fields.salt) || saltSum;
  return { powerTotal, saltTotal, avgPower: deckAvgPower(cards, fields && fields.powerScoreTotal) };
}

const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}% contribution` : 'contribution');

// Stacked bar row (narrow column): label + value on one line, full-width bar below.
function stackRow(label, valText, pct) {
  const fill = el('span', { style: `width:${Math.max(0, Math.min(100, pct))}%` });
  return el('div', { class: 'solring-cm-row' }, [
    el('div', { class: 'solring-cm-row-head' }, [
      el('span', { class: 'solring-pl-label', text: label }),
      el('span', { class: 'solring-pl-val', text: valText }),
    ]),
    el('span', { class: 'solring-pl-bar' }, [fill]),
  ]);
}

function sectionBlock(title, children, headSuffix) {
  const head = el('div', { class: 'solring-pl-h' }, headSuffix ? [title, headSuffix] : [title]);
  return el('div', { class: 'solring-cm-section' }, [head, ...children]);
}

// A small "↓" on a section header marking its list as sorted high→low (by weight).
function sortDownCaret() {
  return el('span', {
    class: 'solring-sort-caret',
    attrs: { title: 'sorted by weight (high → low)', 'aria-hidden': 'true' },
    text: '↓',
  });
}

function chips(items, cls) {
  return el('div', { class: 'solring-cm-chips' }, items.map((t) => el('span', { class: cls, text: t })));
}

// ---- hover preview: show a synergy anchor's exact deck print on hover ----
// A single body-level fixed popover (escapes the panel's overflow:hidden) driven by
// delegated hover. The image loads only on first hover. Installed once, lazily.
let hoverPop = null;
let hoverInstalled = false;
function installCardHover() {
  if (hoverInstalled) return;
  hoverInstalled = true;
  const hide = () => { if (hoverPop) hoverPop.classList.remove('solring-cardpop-show'); };
  // All delegated listeners use CAPTURE: inside Moxfield's card modal an ancestor
  // calls stopPropagation() on mouseover/click, so a bubble-phase document listener
  // never fires there (it does on the deck sidebar). Capture runs before any
  // descendant can stop it. (Verified live: bubble=0, capture=1 in the modal.)
  document.addEventListener('mouseover', (e) => {
    const chip = e.target.closest && e.target.closest('.solring-syn-chip[data-img]');
    if (!chip) return;
    if (!hoverPop) {
      hoverPop = el('div', { class: 'solring-cardpop', attrs: { 'aria-hidden': 'true' } }, [el('img', { attrs: { alt: '' } })]);
      document.body.appendChild(hoverPop);
    }
    const img = hoverPop.querySelector('img');
    const primary = chip.dataset.img;
    const fallback = chip.dataset.imgCs; // CommanderSalt print, if the deck print 404s (e.g. DFCs)
    if (img.getAttribute('src') !== primary) {
      // The synthesized deck-print URL (card-<id>-normal.webp) doesn't exist for
      // double-faced cards (Moxfield serves card-face-<faceId>-…). On error, promote
      // the CommanderSalt fallback so we don't retry the dead URL on every hover.
      img.onerror = fallback ? () => { img.onerror = null; chip.dataset.img = fallback; img.setAttribute('src', fallback); } : null;
      img.setAttribute('src', primary);
    }
    hoverPop.classList.add('solring-cardpop-show');
    const r = chip.getBoundingClientRect();
    const pw = hoverPop.offsetWidth || 251;
    const ph = hoverPop.offsetHeight || 351;
    const top = r.top - ph - 8 >= 4 ? r.top - ph - 8 : Math.min(r.bottom + 8, window.innerHeight - ph - 4);
    hoverPop.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - pw - 4))}px`;
    hoverPop.style.top = `${Math.max(4, top)}px`;
  }, true);
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest && e.target.closest('.solring-syn-chip[data-img]')) hide();
  }, true);
  document.addEventListener('scroll', hide, true);
  // Click (or Enter/Space) opens Moxfield's card view for the chip's card. We click
  // the live on-page link so React Router handles it (modal overlay), falling back
  // to a plain navigation if the row was unmounted.
  const open = (chip) => {
    const href = chip.dataset.href;
    if (!href) return;
    hide();
    const live = document.querySelector(`a.table-deck-row-link[href="${href}"]`) || document.querySelector(`a[href="${href}"]`);
    if (live) live.click(); else location.assign(href);
  };
  document.addEventListener('click', (e) => {
    const chip = e.target.closest && e.target.closest('.solring-syn-chip[data-href]');
    if (!chip) return;
    e.preventDefault();
    open(chip);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const chip = e.target.closest && e.target.closest('.solring-syn-chip[data-href]');
    if (!chip) return;
    e.preventDefault();
    open(chip);
  }, true);
}

// Map decklist rows → normalized name → { img, href }. A card's id in its
// /cards/<id>- link is printing-specific, so `img` is the deck's SELECTED art
// (CommanderSalt's imageUri is only a default print, used as a fallback); `href`
// is the on-page card link we click to open Moxfield's card view.
function deckPrintMap() {
  const map = {};
  for (const link of document.querySelectorAll('a.table-deck-row-link[href^="/cards/"]')) {
    const href = link.getAttribute('href') || '';
    const m = href.match(/\/cards\/([^/-]+)-/);
    if (!m) continue;
    const parts = [...link.querySelectorAll('.underline')].map((s) => s.textContent).join('');
    const name = normName(parts || link.textContent || '');
    if (name && !(name in map)) map[name] = { img: `https://assets.moxfield.net/cards/card-${m[1]}-normal.webp`, href };
  }
  return map;
}

// Build hoverable card-reference spans from [{name, image?}] (or plain name strings).
// Each previews the card's deck print on hover (the deck's selected art when the card is
// on the page, else the supplied image) and opens Moxfield's card view on click for
// cards in the deck. Exported so other panels (bracket-defining cards, combo pieces)
// reuse the same hover/click behavior. `opts.chip` → pill style (synergy anchors);
// otherwise an inline card-name style for prose lists.
export function cardRefs(items, opts = {}) {
  installCardHover();
  const prints = deckPrintMap();
  const cls = opts.chip ? 'solring-tag solring-syn-chip' : 'solring-syn-chip solring-cardname';
  return (items || []).map((it) => {
    const name = typeof it === 'string' ? it : it.name;
    const image = typeof it === 'string' ? null : it.image;
    const hit = prints[normName(name)];
    const deckImg = hit && hit.img; // deck's selected art, else the supplied print
    const primary = deckImg || image;
    const attrs = {};
    if (primary) attrs['data-img'] = primary;
    // Keep the supplied (CommanderSalt) print as a fallback for when the synthesized
    // deck-print URL 404s (double-faced cards use a different, face-keyed URL).
    if (deckImg && image && image !== deckImg) attrs['data-img-cs'] = image;
    if (hit && hit.href) { attrs['data-href'] = hit.href; attrs.role = 'link'; attrs.tabindex = '0'; }
    return el('span', { class: cls, text: name, attrs });
  });
}

// Synergy anchor chips: scoreBias-ranked pills; top SYN_VISIBLE shown, "+N more" reveals
// the rest (already capped upstream at SYN_ANCHOR_CAP).
const SYN_VISIBLE = 8;
function synChips(anchors) {
  const chips = cardRefs(anchors, { chip: true });
  const cont = el('div', { class: 'solring-cm-chips' });
  chips.forEach((chip, i) => {
    if (i >= SYN_VISIBLE) chip.classList.add('solring-syn-hidden');
    cont.append(chip);
  });
  const hidden = chips.length - SYN_VISIBLE;
  if (hidden > 0) {
    const more = el('button', { class: 'solring-syn-more', attrs: { type: 'button' }, text: `+${hidden} more` });
    more.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      cont.querySelectorAll('.solring-syn-hidden').forEach((n) => n.classList.remove('solring-syn-hidden'));
      more.remove();
    });
    cont.append(more);
  }
  return cont;
}

function bars(title, arr) {
  const max = Math.max(...arr.map((x) => x.score), 1);
  return sectionBlock(title, arr.map((x) => stackRow(prettifyStat(x.cat), num(x.score), (x.score / max) * 100)));
}

function buildBody(card, stats) {
  const body = el('div', { class: 'solring-panel-body' });

  // Power/salt get their own mark color above the configured threshold (decoupled
  // from the A–D grade ramp); otherwise the value is plain.
  const pm = powerMark(card.powerTotal, stats.avgPower, stats.powerThreshold) ? 'solring-mark-power' : null;
  const sm = saltMark(card.salt, stats.saltThreshold) ? 'solring-mark-salt' : null;
  // Each value shows the card's contribution next to the deck total ("19.6 / 789.8"),
  // mirroring the deck panel's "x / 10" tile; only the card's number takes the color,
  // the "/ total" stays muted.
  const withTotal = (value, markCls, total) => el('span', { class: 'solring-num' }, [
    el('span', { class: markCls || undefined, text: value }),
    el('span', { class: 'solring-tile-total', text: ` / ${total}` }),
  ]);
  body.append(el('div', { class: 'solring-tiles' }, [
    tile('Power', withTotal(num(card.powerTotal), pm, num(stats.powerTotal)), pct(card.powerTotal, stats.powerTotal)),
    tile('Saltiness', withTotal(num(card.salt), sm, num(stats.saltTotal)), pct(card.salt, stats.saltTotal)),
  ]));

  // Tags + bracket flags share one "Tags" section — flag chips first, then tag chips.
  const tagItems = [
    ...(card.flags || []).map((f) => el('span', { class: 'solring-flag', text: f })),
    ...(card.tags || []).map((t) => el('span', { class: 'solring-tag', text: t })),
  ];
  if (tagItems.length) body.append(sectionBlock('Tags', [el('div', { class: 'solring-cm-chips' }, tagItems)]));
  if (card.power && card.power.length) body.append(bars('Power contribution', card.power));
  if (card.saltBreakdown && card.saltBreakdown.length) body.append(bars('Salt breakdown', card.saltBreakdown));

  const anchors = (card.combos && card.combos.anchors) || [];
  if (anchors.length || card.deckCombos) {
    const kids = [];
    // The cards this card synergizes with (CommanderSalt "outgoing impact"), then its
    // Commander Spellbook combo count. Chips preview the card's deck print on hover.
    if (anchors.length) kids.push(synChips(anchors));
    if (card.deckCombos) {
      kids.push(el('div', { class: 'solring-cm-note', text: `${card.deckCombos} combo${card.deckCombos === 1 ? '' : 's'} in this deck` }));
    }
    // ↓ marks the chips as ranked by weight (only meaningful with 2+ partners).
    body.append(sectionBlock('Synergy', kids, anchors.length > 1 ? sortDownCaret() : null));
  }
  return body;
}

// Build the full panel for a card. Exported so the deck-page sidebar renders the
// identical layout/info as the card-detail modal.
export function buildPanel(card, key, stats) {
  const bar = el('div', { class: 'solring-panel-bar solring-cm-bar' }, [
    el('span', { class: 'solring-wordmark', text: 'Solring' }),
  ]);
  return el('div', {
    class: `solring-panel solring-open solring-card-modal${isDark() ? ' solring-dark' : ''}`,
    attrs: { 'data-card': key },
  }, [bar, buildBody(card, stats)]);
}

// Re-fit the panel to the currently shown card. Idempotent: if the panel already
// matches the visible card, it returns without touching the DOM (so our own
// insertion never re-triggers the observer into a rebuild loop).
function apply() {
  raf = null;
  const modal = [...document.querySelectorAll(MODAL_SEL)].pop();
  if (!modal) return;
  const box = modal.querySelector(IMG_BOX_SEL);
  if (!box) return;
  const h1 = modal.querySelector('h1');
  const name = h1 ? h1.textContent.trim() : '';
  const key = normName(name);
  const existing = box.querySelector(':scope > .solring-card-modal');
  const opts = getOpts();
  if (opts.cardPanelModal === false) { if (existing) existing.remove(); return; } // panel disabled
  if (existing && existing.getAttribute('data-card') === key) return; // already current
  const fields = getFields();
  const card = lookupCard(fields, name);
  if (existing) existing.remove();
  if (!card) return;
  const stats = { ...deckStats(fields), powerThreshold: opts.powerThreshold, saltThreshold: opts.saltThreshold };
  const panel = buildPanel(card, key, stats);
  // Desktop: the container is inline-block (shrink-to-content), so a long tag/synergy
  // list would stretch the whole modal. Cap the panel to the card image's width
  // (measured before inserting, since our content could otherwise widen the box). On
  // mobile a media query widens the container to the full column and lifts this cap.
  const img = box.querySelector('.deckview-image-wrapper') || box.querySelector('img.deckview-image');
  const w = img ? Math.round(img.getBoundingClientRect().width) : 0;
  if (w > 40) panel.style.maxWidth = `${w}px`;
  box.appendChild(panel);
}

function schedule() {
  if (raf) return;
  if (!document.querySelector(MODAL_SEL)) return; // cheap early-out: no modal open
  raf = requestAnimationFrame(() => {
    try { apply(); } catch (e) { console.warn('[solring] card-modal', e); }
  });
}

/** Install the modal observer once. `fieldsGetter` returns the live deck fields
    (or null when no deck is analyzed); `optsGetter` returns the live options. */
export function installCardModal(fieldsGetter, optsGetter) {
  getFields = fieldsGetter || (() => null);
  if (optsGetter) getOpts = optsGetter;
  if (observer) return;
  observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  onPrefChange((which) => { if (which === 'options') schedule(); }); // re-apply on toggle/threshold change
}
