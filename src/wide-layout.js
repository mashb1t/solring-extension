// A "wide / normal" layout toggle injected into Moxfield's header, next to the
// search icon. Wide mode drops Moxfield's Bootstrap container max-widths (via the
// html.solring-wide class, rule in solring.css) so pages use the full viewport,
// handy for the deck-list metric columns. The choice is persisted (prefs:wide) and
// synced across tabs. The header search control is <a id="mainmenu-search"> inside
// <li.nav-item>, and unsetting the container max-width widens the page edge to edge.

import { el } from './dom.js';
import { getWide, setWide, onPrefChange } from './prefs.js';

const SEARCH_SEL = '#mainmenu-search';

let installed = false;
let wide = false;
let observer = null;
let raf = null;

function applyClass() {
  document.documentElement.classList.toggle('solring-wide', wide);
}

// Two arrows pointing outward, an "expand horizontally" glyph. Built as SVG because
// Moxfield renders icons as inline SVG, not icon-font CSS classes.
function wideIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '1em');
  svg.setAttribute('height', '1em');
  for (const pts of ['8 8 4 12 8 16', '16 8 20 12 16 16']) {
    const pl = document.createElementNS(NS, 'polyline');
    pl.setAttribute('points', pts);
    pl.setAttribute('stroke', 'currentColor');
    pl.setAttribute('stroke-width', '2');
    pl.setAttribute('stroke-linecap', 'round');
    pl.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(pl);
  }
  const line = document.createElementNS(NS, 'line');
  for (const [k, v] of [['x1', '4'], ['y1', '12'], ['x2', '20'], ['y2', '12']]) line.setAttribute(k, v);
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-linecap', 'round');
  svg.appendChild(line);
  return svg;
}

function syncBtn(a) {
  a.setAttribute('aria-pressed', String(wide));
  a.setAttribute('title', wide ? 'Layout: wide (full width) — click for normal' : 'Layout: normal — click for wide');
  a.classList.toggle('solring-wide-on', wide);
}

function buildToggle() {
  // Mirror the search control's nav-link styling so it blends into the header.
  const a = el('a', {
    class: 'nav-link px-3 cursor-pointer no-outline solring-wide-toggle',
    attrs: { role: 'button', tabindex: '0', 'aria-label': 'Toggle wide layout' },
  }, [wideIcon()]);
  const toggle = () => setWide(!wide); // persist, then onPrefChange re-applies and re-syncs
  a.addEventListener('click', (e) => { e.preventDefault(); toggle(); });
  a.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  syncBtn(a);
  return a;
}

// Inject the toggle as a sibling <li> just before the search item, idempotent. If it
// already exists, just refresh its pressed/title state.
function ensureToggle() {
  raf = null;
  const search = document.querySelector(SEARCH_SEL);
  if (!search) return;
  const searchLi = search.closest('li') || search.parentElement;
  if (!searchLi || !searchLi.parentElement) return;
  const existing = searchLi.parentElement.querySelector(':scope > .solring-wide-li .solring-wide-toggle');
  if (existing) { syncBtn(existing); return; }
  const li = el('li', { class: 'nav-item solring-wide-li' }, [buildToggle()]);
  searchLi.parentElement.insertBefore(li, searchLi);
}

function schedule() {
  if (raf) return;
  raf = requestAnimationFrame(() => { try { ensureToggle(); } catch (e) { console.warn('[solring] wide-toggle', e); } });
}

/** Install the header wide/normal toggle once; apply the saved choice immediately. */
export async function installWideToggle() {
  if (installed) return;
  installed = true;
  wide = await getWide();
  applyClass();
  ensureToggle();
  onPrefChange(async (which) => {
    if (which !== 'wide') return;
    wide = await getWide();
    applyClass();
    ensureToggle();
  });
  // Re-inject if Moxfield re-renders the header (SPA nav). Cheap, rAF-debounced.
  observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
}
