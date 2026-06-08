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
import { prettifyStat } from './labels.js';
import { normName } from './render-cards.js';

const MODAL_SEL = '.modal.show';
// The sticky image/price/buy container; we append the panel inside it (last child,
// below the buy buttons) so it scrolls with the sticky image instead of being
// covered by it. On mobile a media query widens this container to the full column.
const IMG_BOX_SEL = '.deckviewmodal-image-container';

let getFields = () => null;
let observer = null;
let raf = null;

// Match the modal's card name to a per-card entry: raw name → normalized → a
// DFC-tolerant scan (the cards map keys by full "Front // Back", normName strips it).
function lookup(name) {
  const fields = getFields();
  if (!fields || !fields.cards || !name) return null;
  const cards = fields.cards;
  const raw = name.toLowerCase().trim();
  if (cards[raw]) return cards[raw];
  const n = normName(name);
  if (cards[n]) return cards[n];
  for (const k of Object.keys(cards)) if (normName(k) === n) return cards[k];
  return null;
}

const num = (n, d = 1) => (typeof n === 'number' && isFinite(n) ? n.toFixed(d) : '—');

// Per-card saltiness → the extension's A–D rating tier (high = bad), so the value
// is colored on the global ramp (a=red … d=green) instead of plain grey.
function saltTier(salt) {
  if (typeof salt !== 'number') return null;
  if (salt >= 5) return 'a';
  if (salt >= 3) return 'b';
  if (salt >= 1.5) return 'c';
  return 'd';
}

// valueTier colors the value on the A–D rating ramp (used for saltiness severity).
function tile(label, value, sub, valueTier) {
  const valCls = valueTier ? `solring-num solring-tier-${valueTier}` : 'solring-num';
  return el('div', { class: 'solring-tile' }, [
    el('div', { class: 'solring-tile-label', text: label }),
    el('div', { class: 'solring-tile-value' }, [el('span', { class: valCls, text: value })]),
    sub ? el('div', { class: 'solring-tile-sub', text: sub }) : null,
  ]);
}

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

function sectionBlock(title, children) {
  return el('div', { class: 'solring-cm-section' }, [
    el('div', { class: 'solring-pl-h', text: title }),
    ...children,
  ]);
}

function chips(items, cls) {
  return el('div', { class: 'solring-cm-chips' }, items.map((t) => el('span', { class: cls, text: t })));
}

function bars(title, arr) {
  const max = Math.max(...arr.map((x) => x.score), 1);
  return sectionBlock(title, arr.map((x) => stackRow(prettifyStat(x.cat), num(x.score), (x.score / max) * 100)));
}

function buildBody(card) {
  const body = el('div', { class: 'solring-panel-body' });

  body.append(el('div', { class: 'solring-tiles' }, [
    tile('Saltiness', num(card.salt), 'card salt', saltTier(card.salt)),
    tile('Power', num(card.powerTotal), 'contribution'),
  ]));

  if (card.tags && card.tags.length) body.append(sectionBlock('Tags', [chips(card.tags, 'solring-tag')]));
  if (card.flags && card.flags.length) body.append(sectionBlock('Bracket flags', [chips(card.flags, 'solring-flag')]));
  if (card.power && card.power.length) body.append(bars('Power contribution', card.power));
  if (card.saltBreakdown && card.saltBreakdown.length) body.append(bars('Salt breakdown', card.saltBreakdown));

  const anchors = (card.combos && card.combos.anchors) || [];
  const effects = (card.combos && card.combos.total) || 0;
  if (anchors.length || card.deckCombos || effects) {
    const kids = [];
    if (anchors.length) kids.push(chips(anchors, 'solring-tag'));
    const sub = [];
    if (card.deckCombos) sub.push(`${card.deckCombos} combo${card.deckCombos === 1 ? '' : 's'} in this deck`);
    if (effects) sub.push(`${effects} synergy effect${effects === 1 ? '' : 's'}`);
    if (sub.length) kids.push(el('div', { class: 'solring-cm-note', text: sub.join(' · ') }));
    body.append(sectionBlock('Synergy', kids));
  }
  return body;
}

function buildPanel(card, key) {
  const bar = el('div', { class: 'solring-panel-bar solring-cm-bar' }, [
    el('span', { class: 'solring-wordmark', text: 'Solring' }),
  ]);
  return el('div', {
    class: `solring-panel solring-open solring-card-modal${isDark() ? ' solring-dark' : ''}`,
    attrs: { 'data-card': key },
  }, [bar, buildBody(card)]);
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
  if (existing && existing.getAttribute('data-card') === key) return; // already current
  const card = lookup(name);
  if (existing) existing.remove();
  if (!card) return;
  const panel = buildPanel(card, key);
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
    (or null when no deck is analyzed). */
export function installCardModal(fieldsGetter) {
  getFields = fieldsGetter || (() => null);
  if (observer) return;
  observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
}
