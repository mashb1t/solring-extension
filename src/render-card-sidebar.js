// Mirrors the per-card "Info" panel onto the deck page's left sidebar: the
// card-preview aside (aside.deckview-image-container), below the preview image. It
// renders the same layout/info as the card-detail modal (shared buildPanel),
// for whichever card the preview is currently showing.
//
// The preview image tracks decklist hover (commander by default), so we treat its
// `src` as the single source of truth and follow it rather than binding hover.
// That covers the default, hover, click, and Moxfield-internal swaps uniformly.

import { buildPanel, deckStats, lookupCard } from './render-card-modal.js';
import { onPrefChange } from './prefs.js';
import { registerDisposable } from './dom.js';

const ASIDE_SEL = 'aside.deckview-image-container';

let getFields = () => null;
let getOpts = () => ({});
let observer = null;
let raf = null;

// The card name behind a /cards/<id>- link: prefer the underlined name spans (decklist
// rows), fall back to the link text (e.g. a commander link in the header). Slugs in
// the href are lossy (commas dropped), so we read the rendered name instead.
function linkName(link) {
  const parts = [...link.querySelectorAll('.underline')].map((s) => s.textContent).join('');
  return (parts || link.textContent || '').trim();
}

function apply() {
  raf = null;
  const aside = document.querySelector(ASIDE_SEL);
  if (!aside) return;
  const opts = getOpts();
  if (opts.cardPanelSidebar === false) { // panel disabled
    const ex = aside.querySelector(':scope > .solring-card-modal');
    if (ex) ex.remove();
    return;
  }
  const img = aside.querySelector('img.front') || aside.querySelector('img.img-card') || aside.querySelector('img');
  const id = img && ((img.src || '').match(/\/card-([A-Za-z0-9]+)-/) || [])[1];
  const key = id || 'commander';
  const existing = aside.querySelector(':scope > .solring-card-modal');
  if (existing && existing.getAttribute('data-card') === key) return; // already current

  const fields = getFields();
  // Resolve the previewed card via its on-page link's rendered name. Fall back to
  // the commander (the default preview).
  let card = null;
  if (id) {
    const link = document.querySelector(`a[href^="/cards/${id}-"]`) || document.querySelector(`a[href^="/cards/${id}"]`);
    if (link) card = lookupCard(fields, linkName(link));
  }
  if (!card && fields) card = lookupCard(fields, fields.commander);

  if (existing) existing.remove();
  if (!card) return;
  const panel = buildPanel(card, key, { ...deckStats(fields), powerThreshold: opts.powerThreshold, saltThreshold: opts.saltThreshold });
  // Cap to the preview image width so a long tag/synergy list can't widen the column.
  const w = img ? Math.round(img.getBoundingClientRect().width) : 0;
  if (w > 40) panel.style.maxWidth = `${w}px`;
  aside.appendChild(panel); // below the image / price / buy buttons, mirroring the modal
}

function schedule() {
  if (raf) return;
  if (!document.querySelector(ASIDE_SEL)) return; // cheap early-out: no deck sidebar
  raf = requestAnimationFrame(() => {
    try { apply(); } catch (e) { console.warn('[solring] card-sidebar', e); }
  });
}

/** Install the deck-sidebar mirror once. `fieldsGetter` returns the live deck fields
    (or null when no deck is analyzed). */
export function installCardSidebar(fieldsGetter, optsGetter) {
  getFields = fieldsGetter || (() => null);
  if (optsGetter) getOpts = optsGetter;
  if (observer) return;
  // Watch the preview image's src (and node swaps) plus structural changes. The
  // attributeFilter keeps this cheap despite the body-wide subtree.
  observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  const offPref = onPrefChange((which) => { if (which === 'options') schedule(); }); // re-apply on toggle/threshold change
  // Router drains this on nav (disconnect + drop listener + reset once-guard).
  registerDisposable(() => { if (observer) observer.disconnect(); offPref(); observer = null; });
}
