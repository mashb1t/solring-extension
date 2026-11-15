// Combo-breaker UI shared by the Cuts tab (recommendations.js) and the builder's over-100 cuts
// (render-builder.js): the red ⓘ badge + its popover, and the confirm before removing a combo piece.
// Data comes from the pure combo-breakers.js. All text via textContent; one popover / confirm at a time.

import { el } from './dom.js';
import { comboUrl, backdropDismisses } from './combo-breakers.js';

const MAX_COMBOS_SHOWN = 5;
const plural = (n) => `${n} combo${n === 1 ? '' : 's'}`;

/** The red ⓘ for a card that is a piece of the deck's combos. `current()` returns its current
 *  combo list (read on every open). The caller positions it (absolute, top-right by default). */
export function breakerBadge(current) {
  const badge = el('span', {
    class: 'solring-breaker', text: 'ⓘ',
    attrs: { role: 'button', tabindex: '0', 'aria-label': 'Part of a combo', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
  });
  // The badge may sit inside a card's <a> / card-ref: swallow the click so it neither navigates
  // nor opens the card modal.
  const toggle = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (pop.anchor === badge && pop.pinned) closeBreakerPop();
    else openBreakerPop(badge, current(), true);
  };
  badge.addEventListener('click', toggle);
  badge.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') toggle(e); });
  badge.addEventListener('mouseenter', () => { if (!pop.pinned) openBreakerPop(badge, current(), false); });
  badge.addEventListener('mouseleave', scheduleHoverClose);
  return badge;
}

// The combo list shared by the popover and the confirm dialog: pieces, what it produces, and a
// Spellbook link; the first few most popular, then "+N more". All text via textContent.
function comboList(combos) {
  const list = el('ul', { class: 'solring-breaker-list' }, combos.slice(0, MAX_COMBOS_SHOWN).map((c) => el('li', {}, [
    el('span', { class: 'solring-breaker-pieces', text: c.pieces.join(' + ') }),
    c.produces.length ? el('span', { class: 'solring-breaker-produces', text: `→ ${c.produces.join(', ')}` }) : null,
    el('a', { class: 'solring-breaker-link', text: 'Spellbook ↗', attrs: { href: comboUrl(c.id), target: '_blank', rel: 'noopener' } }),
  ])));
  const more = combos.length - MAX_COMBOS_SHOWN;
  if (more > 0) list.append(el('li', { class: 'solring-breaker-more', text: `+${more} more` }));
  return list;
}

// One body-level popover (fixed, so the card grid can't clip it). Hover opens it; leaving both
// the badge and the popover closes it; a click pins it until Escape / outside click / re-click.
const pop = { node: null, anchor: null, pinned: false, timer: null, docOff: null };

function openBreakerPop(badge, combos, pinned) {
  if (!combos.length) return;
  clearTimeout(pop.timer);
  if (pop.anchor && pop.anchor !== badge) pop.anchor.setAttribute('aria-expanded', 'false');
  if (!pop.node || !pop.node.isConnected) {
    pop.node = el('div', { class: 'solring-breaker-pop', attrs: { role: 'dialog', 'aria-label': 'Combos this card is part of' } });
    pop.node.addEventListener('mouseenter', () => clearTimeout(pop.timer));
    pop.node.addEventListener('mouseleave', scheduleHoverClose);
    document.body.appendChild(pop.node);
  }
  pop.node.replaceChildren(
    el('div', { class: 'solring-breaker-title', text: `Part of ${plural(combos.length)} in this deck. Cutting it breaks ${combos.length === 1 ? 'it' : 'them'}.` }),
    comboList(combos),
  );
  pop.anchor = badge; pop.pinned = pinned;
  badge.setAttribute('aria-expanded', 'true');
  const r = badge.getBoundingClientRect();
  const w = pop.node.offsetWidth, h = pop.node.offsetHeight;
  const left = Math.max(4, Math.min(r.right - w, window.innerWidth - w - 4));
  const top = r.bottom + 6 + h > window.innerHeight ? Math.max(4, r.top - h - 6) : r.bottom + 6;
  pop.node.style.left = `${left}px`; pop.node.style.top = `${top}px`;
  if (!pop.docOff) {
    const onKey = (e) => { if (e.key === 'Escape') closeBreakerPop(); };
    const onDown = (e) => { if (pop.node && !pop.node.contains(e.target) && !(pop.anchor && pop.anchor.contains(e.target))) closeBreakerPop(); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    pop.docOff = () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true); };
  }
}

function scheduleHoverClose() {
  if (pop.pinned) return;
  clearTimeout(pop.timer);
  pop.timer = setTimeout(closeBreakerPop, 200);
}

export function closeBreakerPop() {
  clearTimeout(pop.timer);
  if (pop.anchor) pop.anchor.setAttribute('aria-expanded', 'false');
  if (pop.node) pop.node.remove();
  if (pop.docOff) pop.docOff();
  pop.node = null; pop.anchor = null; pop.pinned = false; pop.docOff = null;
}

// Red-accented confirm before removing a combo piece. Resolves true only on "Remove"; Cancel,
// Escape and a backdrop click resolve false. Focus starts on Cancel and returns to `returnTo`.
let cancelConfirm = null; // resolves an open confirm as "Cancel" (route teardown)

/** Resolve an open confirm as Cancel (route teardown). */
export function cancelBreakerConfirm() { if (cancelConfirm) cancelConfirm(); }

export function confirmRemove(name, combos, returnTo) {
  closeBreakerPop();
  if (cancelConfirm) cancelConfirm();
  return new Promise((resolve) => {
    const cancel = el('button', { class: 'btn btn-outline-secondary', text: 'Cancel', attrs: { type: 'button' } });
    const ok = el('button', { class: 'btn solring-breaker-remove', text: 'Remove', attrs: { type: 'button' } });
    const dialog = el('div', {
      class: 'solring-breaker-dialog',
      attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'solring-breaker-confirm-title' },
    }, [
      el('div', { class: 'solring-breaker-title', text: `Removing ${name} breaks ${plural(combos.length)}:`, attrs: { id: 'solring-breaker-confirm-title' } }),
      comboList(combos),
      el('div', { class: 'solring-breaker-ask', text: 'Remove anyway?' }),
      el('div', { class: 'solring-breaker-actions' }, [cancel, ok]),
    ]);
    const backdrop = el('div', { class: 'solring-breaker-confirm' }, [dialog]);
    const done = (yes) => {
      cancelConfirm = null;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (returnTo && returnTo.isConnected) returnTo.focus();
      resolve(yes);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === 'Tab') { // keep focus inside: cycle Cancel <-> Remove
        e.preventDefault();
        (document.activeElement === cancel ? ok : cancel).focus();
      }
    };
    cancel.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    // A double-click on "−" must not dismiss the confirm its first click opened: the backdrop
    // only cancels for a click whose pointerdown also began on it, after a short grace period.
    const openedAt = Date.now();
    let downOnBackdrop = false;
    backdrop.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === backdrop; });
    backdrop.addEventListener('click', (e) => {
      const yes = backdropDismisses({ openedAt, now: Date.now(), downOnBackdrop, clickOnBackdrop: e.target === backdrop });
      downOnBackdrop = false;
      if (yes) done(false);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    cancelConfirm = () => done(false);
    cancel.focus();
  });
}

