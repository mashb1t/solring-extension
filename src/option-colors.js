// Options-driven colour tokens (mark + rating colours) on <html>, so every Solring surface —
// the deck report card, the Guided Builder, the New-deck picker on any route — uses them.
// null = not customized: removeProperty falls back to the auto-themed CSS default.

import { getOptions, onPrefChange } from './prefs.js';

export function applyOptionColors(o) {
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

let subscribed = false;
/** Apply the colours now and keep them in sync with the options for the page's lifetime
    (one listener, never disposed: the tokens are global, not per-route). Idempotent. */
export async function installOptionColors() {
  if (!subscribed) {
    subscribed = true;
    onPrefChange(async (which) => {
      if (which === 'options') applyOptionColors(await getOptions().catch(() => ({})));
    });
  }
  applyOptionColors(await getOptions().catch(() => ({})));
}
