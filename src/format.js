// Pure string/number formatters shared across the render modules. No DOM, no state,
// kept out of dom.js (DOM-injection helpers) so each module's purpose stays honest.

/** Relative "ago" label for a timestamp (ms). Falsy `ts` returns '' (no timestamp yet),
    otherwise 'just now' (<60s), 'N min ago', 'N h ago', or 'N d ago'. */
export function relTime(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** Format a number to `d` decimals, returning an em-dash placeholder when it isn't a finite number. */
export function num(n, d = 1) {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : '—';
}
