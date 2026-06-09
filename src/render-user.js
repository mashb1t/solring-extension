// User-profile averages (/users/{name}). Appends an "Averages" card to the profile
// sidebar summarising the user's decks: ø power / bracket / saltiness / synergy from
// every joined deck (hit metrics), plus ø threat / interaction / wincons / commander
// tier over the decks whose full payload is cached — each with a "from N" coverage
// hint. Recomputes as decks load or get scanned (decklist's onDeckListChange).

import { el, guard } from './dom.js';
import { tile, gradeChip } from './components.js';
import { csRatingGrade } from './ratings.js';
import { getViews, onDeckListChange } from './decklist.js';

const num = (n, d = 1) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : '—');

// ---- pure logic (unit-tested) ------------------------------------------------
// Average each metric over the views that have it, returning { v, n } where n is how
// many decks contributed (the coverage). Full-payload metrics (threat/…/tier) have
// lower n than the always-present hit metrics until more decks are scanned.
export function averageViews(views) {
  const all = views || [];
  const avg = (get) => {
    const xs = [];
    for (const v of all) { const x = get(v); if (typeof x === 'number' && Number.isFinite(x)) xs.push(x); }
    return { v: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, n: xs.length };
  };
  return {
    total: all.length,
    power: avg((v) => v.power),
    bracket: avg((v) => v.bracketRealistic),
    salt: avg((v) => v.salt),
    synergy: avg((v) => v.synergy),
    threat: avg((v) => v.threat),
    interaction: avg((v) => v.interaction),
    wincons: avg((v) => v.wincons),
    tier: avg((v) => v.commanderTier),
  };
}

// ---- DOM ----------------------------------------------------------------------

let active = false;
let wired = false;
let observer = null;
let raf = null;

// The profile card column on /users/{name}: the .flex-shrink-0 that holds the
// username card (its <h1>). Verified live. null on pages without it.
function profileColumn() {
  const h = document.querySelector('main .flex-shrink-0 h1');
  return h ? h.closest('.flex-shrink-0') : null;
}

const numAvg = (a) => el('span', { class: 'solring-num', text: a.v != null ? num(a.v) : '—' });
const gradeAvg = (a, field) => (a.v != null ? gradeChip(csRatingGrade(a.v, field)) : el('span', { class: 'solring-num', text: '—' }));
const cover = (a) => (a.n ? `ø of ${a.n}` : null);

function buildPanel() {
  const a = averageViews(getViews());
  return el('div', { class: 'solring-averages card card-light-border', attrs: { 'data-solring-root': '' } }, [
    el('div', { class: 'card-body p-3' }, [
      el('div', { class: 'solring-averages-title', text: `Deck averages · ${a.total} deck${a.total === 1 ? '' : 's'}` }),
      el('div', { class: 'solring-tiles solring-averages-tiles' }, [
        tile('ø Power', numAvg(a.power), cover(a.power)),
        tile('ø Bracket', numAvg(a.bracket), cover(a.bracket)),
        tile('ø Salt', gradeAvg(a.salt, 'saltRating'), cover(a.salt)),
        tile('ø Synergy', gradeAvg(a.synergy, 'synergyRating'), cover(a.synergy)),
        tile('ø Threat', gradeAvg(a.threat, 'threatRating'), cover(a.threat)),
        tile('ø Inter.', gradeAvg(a.interaction, 'interactionRating'), cover(a.interaction)),
        tile('ø Wincons', gradeAvg(a.wincons, 'comboRating'), cover(a.wincons)),
        tile('ø Cmd. tier', el('span', { class: 'solring-num', text: a.tier.v != null ? `T${num(a.tier.v)}` : '—' }), cover(a.tier)),
      ]),
    ]),
  ]);
}

function render() {
  raf = null;
  if (!active) return;
  const col = profileColumn();
  if (!col) return;
  const existing = col.querySelector(':scope > .solring-averages');
  if (existing) existing.remove();
  col.appendChild(buildPanel());
}
function schedule() {
  if (raf) return;
  raf = requestAnimationFrame(() => guard('user-averages', render));
}

/** Install the profile-averages card (call on /users/{name}). Recomputes on deck-list
    changes; re-injects if Moxfield re-renders the profile column away. */
export function installUserAverages() {
  active = true;
  if (!wired) {
    wired = true;
    onDeckListChange(() => schedule());
    observer = new MutationObserver(() => {
      if (active && profileColumn() && !document.querySelector('.solring-averages')) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  schedule();
}

/** Remove the averages card + stop owning the profile (SPA nav away from /users). */
export function teardownUserAverages() {
  active = false;
  document.querySelectorAll('.solring-averages').forEach((n) => n.remove());
}
