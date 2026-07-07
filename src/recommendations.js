// EDHREC "cuts" tab on Moxfield's /decks/{id}/recommendations page. Moxfield's native tab
// shows cards to ADD; this adds a second view showing cards to CUT (EDHREC recs `outRecs` — the
// deck's own cards ranked by cut-worthiness), which Moxfield never surfaces. Both views show the
// EDHREC recommendation score (inRecs for adds, outRecs for cuts). Cut cards clone a live
// Moxfield recommendation card for identical grid/styling; a grey "−" button removes the card
// from the deck via moxfield-edit.js (authenticated with the page's own token). Read-only until
// the user clicks the minus.
//
// Note: clicking a cut card opens the full card page (a link), not Moxfield's in-page card modal
// — that modal is Moxfield-internal React state (no URL), so it can't be triggered for an
// injected card.

import { el, registerDisposable } from './dom.js';
import { getOptions, getCardPrefs, getCardSortView, onPrefChange } from './prefs.js';
import { fetchRecs, cutRecs } from './sources/edhrec-recs.js';
import { readDeck, frontKey, hasToken, setCardQuantity, removeCard } from './moxfield-edit.js';
import { deckMd5, canonicalDeckUrl } from './md5.js';
import { getDeck, getEnrichment } from './messaging.js';
import { annotate } from './render-cards.js';
import { installCustomizeViewToggles } from './customize-view.js';
import { installCardSidebar } from './render-card-sidebar.js';
import { installCardModal } from './render-card-modal.js';

// The recommendations route carries a suffix that moxfield.parseDeckId (anchored on /decks/{id}$)
// rejects, so match + extract the public id here.
const recoMatch = () => /^\/decks\/([A-Za-z0-9_-]+)\/recommendations\/?$/.exec(location.pathname);
const isRecoRoute = () => !!recoMatch();

let installed = false;

export function teardownRecommendations() {
  installed = false;
  document.querySelectorAll('.solring-cuts-tabs, .solring-cuts-view, .solring-autosave, .solring-score-badge').forEach((n) => n.remove());
  document.querySelectorAll('[data-solring-recohidden]').forEach((n) => { n.style.display = ''; n.removeAttribute('data-solring-recohidden'); });
}

export async function installRecommendations({ waitFor }) {
  if (installed || !isRecoRoute()) return;
  const opts = await getOptions().catch(() => ({}));
  if (opts.sources && opts.sources.edhrec === false) return; // gated on the EDHREC source
  const m = recoMatch();
  const publicId = m && m[1];
  if (!publicId) return;

  const firstCard = await waitFor('.decklist-card');
  if (!firstCard || !isRecoRoute()) return;
  const cell = firstCard.closest('[class*="col"]') || firstCard.parentElement;
  const grid = cell.parentElement; // Moxfield's row of recommendation cells
  if (!grid || grid.querySelector('.solring-cuts-tabs')) return;
  installed = true;
  const template = cell;

  const cutsView = el('div', { class: 'solring-cuts-view', attrs: { hidden: '' } });
  const tabAdd = mkTab('Recommended', true);
  const tabCut = mkTab('Cuts', false);
  const tabs = el('div', { class: 'solring-cuts-tabs' }, [tabAdd, tabCut]);
  // Place the tabs top-right, just before Moxfield's view-mode pill (.ms-4 in the
  // "We found N recommendations" header row). Fall back to above the grid.
  const pill = document.querySelector('.ms-auto .ms-4');
  if (pill && pill.parentElement) pill.parentElement.insertBefore(tabs, pill);
  else grid.parentElement.insertBefore(tabs, grid);
  grid.parentElement.insertBefore(cutsView, grid.nextSibling);
  registerDisposable(teardownRecommendations);

  // Load EDHREC recs once (used by both tabs): deck read → recs POST.
  const deck = await readDeck(publicId).catch(() => null);
  const json = deck ? await fetchRecs(deck.commanders, Object.values(deck.boards.mainboard).map((e) => e.name)) : null;
  const inScore = new Map();
  for (const r of (json && json.inRecs) || []) if (r && r.name && typeof r.score === 'number') inScore.set(frontKey(r.name), r.score);
  const cuts = deck
    ? cutRecs(json, Infinity).map((r) => { const e = deck.boards.mainboard[frontKey(r.name)]; return e ? { ...e, score: r.score } : null; }).filter(Boolean)
    : [];

  if (inScore.size) annotateAdds(grid, inScore); // stamp the native "add" cards with their score

  // Moxfield's "We found N recommendations from edhrec.com." header line — reword it for the Cuts
  // tab, restore the original for Recommended.
  const foundLine = [...document.querySelectorAll('.text-muted')].find((e) => /We found .*recommendations from edhrec/i.test(e.textContent || ''));
  const foundOrig = foundLine ? foundLine.innerHTML : null;

  let cutsRendered = false;
  const show = (showCuts) => {
    tabAdd.classList.toggle('active', !showCuts);
    tabCut.classList.toggle('active', showCuts);
    grid.style.display = showCuts ? 'none' : '';
    if (showCuts) grid.setAttribute('data-solring-recohidden', '1'); else grid.removeAttribute('data-solring-recohidden');
    if (showCuts) cutsView.removeAttribute('hidden'); else cutsView.setAttribute('hidden', '');
    if (foundLine) {
      if (showCuts) foundLine.textContent = `We found ${cuts.length} recommended cuts from edhrec.com (least-played in this commander’s decks first).`;
      else if (foundOrig != null) foundLine.innerHTML = foundOrig;
    }
    if (showCuts && !cutsRendered) { cutsRendered = true; renderCuts(cutsView, template, grid.className, cuts, { publicId, editId: deck && deck.editId }); }
  };
  tabAdd.addEventListener('click', () => show(false));
  tabCut.addEventListener('click', () => show(true));

  annotatePreview(publicId); // mirror the deck view's per-card Solring columns onto the Deck Preview
  installCustomizeViewToggles(); // add the Solring "Include Extra Data" toggles to the preview's Customize View
}

// Show the same per-card Solring columns (Power / Salt / Synergy / Tags / EDHREC%, per the user's
// Customize-View prefs) on the Deck Preview list that the deck view shows. The preview rows use
// the same `a.table-deck-row-link` markup annotate() targets, so once we have the deck's
// CommanderSalt analysis we just call annotate whenever the preview is expanded. No-op if the
// deck was never analyzed.
async function annotatePreview(publicId) {
  const md5 = deckMd5(canonicalDeckUrl(publicId));
  const res = await getDeck(md5).catch(() => null);
  const fields = res && res.fields;
  if (!fields || !fields.cards) return;
  try { const e = await getEnrichment('edhrec', md5); if (e && e.inclusion) fields.edhrecInclusion = e.inclusion; } catch { /* EDHREC% column stays blank */ }

  // Card-detail panel (power / saltiness / tags / synergy) below the Deck Preview's card image —
  // the preview uses the same aside.deckview-image-container the deck-view sidebar anchors on.
  const opts0 = await getOptions().catch(() => ({}));
  installCardSidebar(() => fields, () => opts0); // panel below the preview image
  installCardModal(() => fields, () => opts0);   // Solring Info panel inside the card-detail modal

  let obs = null, timer = null;
  const apply = async () => {
    if (!document.querySelector('.deck-preview.expanded')) return; // only when the preview list is shown
    const [prefs, cardSort, opts] = await Promise.all([getCardPrefs(), getCardSortView(), getOptions()]);
    if (obs) obs.disconnect(); // annotate() clears+re-adds nodes — don't let that retrigger us
    try { annotate(fields, prefs, opts, cardSort); } finally { if (obs) obs.observe(document.body, { childList: true, subtree: true }); }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(apply, 150); };
  obs = new MutationObserver(schedule);
  obs.observe(document.body, { childList: true, subtree: true });
  // Column-label clicks cycle the card-sort pref → re-annotate immediately (don't wait on the
  // debounced DOM observer, which made sorting feel unresponsive).
  const offPref = onPrefChange((which) => { if (which === 'card') apply(); });
  registerDisposable(() => { if (obs) obs.disconnect(); clearTimeout(timer); offPref(); });
  schedule();
}

// Open Moxfield's native card modal for a deck card by clicking its link in the "Deck Preview"
// panel (whose links open the modal in-page, no URL change). The panel renders its links only
// when expanded, so expand it first, then click once the link appears. Returns true if it took
// over the click (so the caller preventDefaults); false if no preview panel exists (navigate).
function openCardPreview(cardId) {
  const dp = document.querySelector('.deck-preview');
  if (!dp) return false;
  const sel = `a[href^="/cards/${cardId}-"], a[href="/cards/${cardId}"]`;
  const bar = dp.querySelector('a');
  const wasExpanded = dp.classList.contains('expanded');
  // Collapse again afterwards only if WE expanded it (leave it alone if the user had it open).
  // Re-query live nodes — the panel re-renders when the modal toggles, so captured refs go stale.
  const collapse = () => {
    if (wasExpanded) return;
    const live = document.querySelector('.deck-preview');
    if (live && live.classList.contains('expanded')) { const b = live.querySelector('a'); if (b) b.click(); }
  };
  // Collapsing while the modal is open dismisses it (counts as an outside click), so wait until
  // the modal has opened AND been closed, then collapse.
  const collapseWhenModalCloses = () => {
    let sawModal = false, ticks = 0;
    const t = setInterval(() => {
      const open = !!document.querySelector('.modal.show');
      if (open) sawModal = true;
      if (sawModal && !open) { clearInterval(t); collapse(); }
      else if (++ticks > 1200) clearInterval(t); // ~2min safety cap
    }, 100);
  };
  const existing = dp.querySelector(sel);
  if (existing) { existing.click(); return true; }
  if (bar && !wasExpanded) bar.click(); // expand so the card links render
  let tries = 0;
  const timer = setInterval(() => {
    const link = dp.querySelector(sel);
    if (link) { clearInterval(timer); link.click(); collapseWhenModalCloses(); }
    else if (++tries > 25) { clearInterval(timer); collapse(); }
  }, 100);
  return true;
}

function mkTab(label, active) {
  return el('button', { class: `solring-cuts-tab${active ? ' active' : ''}`, attrs: { type: 'button' }, text: label });
}

// A small corner badge with the EDHREC recommendation score.
function scoreBadge(score) {
  const b = el('span', { class: 'badge solring-score-badge', text: score == null ? '—' : String(score) });
  b.title = 'EDHREC recommendation score';
  return b;
}

// Stamp Moxfield's native recommendation ("add") cards with their EDHREC score. Runs now and on
// re-render (Moxfield lazily rebuilds the grid); the observer is paused during its own writes so
// appending a badge can't re-trigger it.
function annotateAdds(grid, inScore) {
  let obs;
  const stamp = () => {
    if (obs) obs.disconnect();
    for (const card of grid.querySelectorAll('.decklist-card')) {
      if (card.querySelector('.solring-score-badge')) continue;
      const nameEl = card.querySelector('.decklist-card-phantomsearch');
      const s = nameEl && inScore.get(frontKey(nameEl.textContent || ''));
      if (s == null) continue;
      const visual = card.querySelector('.img-card-visual') || card;
      visual.style.position = visual.style.position || 'relative';
      visual.appendChild(scoreBadge(s));
    }
    if (obs) obs.observe(grid, { childList: true, subtree: true });
  };
  stamp();
  obs = new MutationObserver(stamp);
  obs.observe(grid, { childList: true, subtree: true });
  registerDisposable(() => obs.disconnect());
}

function renderCuts(view, template, gridClass, cuts, ctx) {
  const header = el('div', { class: 'solring-cuts-head' }, [
    el('div', { class: 'solring-cuts-title', text: `EDHREC suggested cuts · ${cuts.length}` }),
    el('div', { class: 'solring-cuts-hedge', text: 'Ranked by how few of this commander’s decks keep the card — popularity, not deck-fit. The grey − removes the card from your deck immediately.' }),
  ]);
  if (!cuts.length) { view.replaceChildren(header, el('div', { class: 'solring-cuts-status', text: 'No cut suggestions (could not read the deck or EDHREC returned none).' })); return; }
  const gridEl = el('div', { class: gridClass }); // same grid classes as Moxfield's recommendation row
  for (const cut of cuts) gridEl.append(buildCutCard(template, cut, ctx));
  view.replaceChildren(header, gridEl);
}

// Clone a live Moxfield recommendation card for identical styling; keep its image + name, drop
// the price/buy footer and Options, repurpose Moxfield's own "+" add button into a grey "−"
// remove button (so it looks/positions exactly like the native control), and add the score badge.
function buildCutCard(template, cut, ctx) {
  const cell = template.cloneNode(true);
  cell.classList.add('solring-cut-cell');
  const card = cell.querySelector('.decklist-card') || cell;
  const ph = card.querySelector('.decklist-card-phantomsearch');
  if (ph) ph.textContent = cut.name;
  const a = card.querySelector('a[href^="/cards/"]');
  if (a) {
    a.setAttribute('href', `/cards/${cut.cardId}`);
    // Open Moxfield's native card modal in-page (via the Deck Preview) instead of navigating to
    // the full card page. Ignore clicks that land on the minus control. Falls through to the
    // link's normal navigation if the preview isn't available.
    a.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.decklist-card-button')) return;
      if (openCardPreview(cut.cardId)) e.preventDefault();
    });
  }
  const img = card.querySelector('img');
  if (img) { img.setAttribute('src', cut.image); img.setAttribute('alt', cut.name); img.removeAttribute('srcset'); }
  card.querySelectorAll('[id^="vsr-"]').forEach((n) => n.removeAttribute('id'));
  // Normalize Moxfield's cloned action overlay to a single "−" remove button, whatever it cloned
  // (a lone "+" add button, or a full "− [qty] +" stepper). Keep one Moxfield button for its exact
  // styling/size, swap its glyph to fa-minus, drop the input / extra buttons. Show a "×N" count
  // when the deck holds more than one copy.
  const overlay = card.querySelector('.decklist-card-button');
  const btn = overlay && (overlay.querySelector('.decklist-card-button-btn') || overlay.querySelector('button'));
  if (overlay && btn) {
    const svg = btn.querySelector('svg');
    if (svg) {
      svg.setAttribute('data-icon', 'minus');
      svg.classList.remove('fa-plus'); svg.classList.add('fa-minus');
      const path = svg.querySelector('path');
      if (path) path.setAttribute('d', 'M0 256c0-17.7 14.3-32 32-32l384 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 288c-17.7 0-32-14.3-32-32z');
    }
    btn.classList.add('solring-cut-minus');
    // Match Moxfield's stepper "−" exactly: its minus button carries btn-outline-primary but NOT
    // decklist-card-button-btn (that's only on the "+").
    btn.classList.remove('fa-plus', 'decklist-card-button-btn');
    btn.setAttribute('title', `Remove ${cut.name} from the deck`);
    wireRemove(btn, cut, ctx, cell);
    const wrap = el('div', { class: 'd-inline-flex flex-row flex-nowrap gap-1 align-items-center' }, [btn]);
    if (cut.quantity > 1) wrap.append(el('span', { class: 'solring-cut-count', text: `×${cut.quantity}` }));
    overlay.replaceChildren(wrap); // discard the cloned input / second button
  } else if (overlay) {
    overlay.remove();
  }
  // Keep only the card's name + image block; drop the cloned price/buy footer and Options.
  for (const child of [...card.children]) {
    if (!child.querySelector('img') && !child.classList.contains('decklist-card-phantomsearch')) child.remove();
  }
  // The clone template is a native "add" card that annotateAdds may have already stamped with a
  // score badge — drop any inherited badge before adding this cut's own.
  cell.querySelectorAll('.solring-score-badge').forEach((b) => b.remove());
  const visual = card.querySelector('.img-card-visual') || card;
  visual.appendChild(scoreBadge(cut.score));
  if (cut.faces && cut.faces.length > 1) visual.appendChild(flipButton(img, cut.faces)); // MDFC face switch
  return cell;
}

// Double-faced card switch — Moxfield's exact transform-button markup (img-card-flip circle with
// a fa-rotate glyph, centered over the art). Clicking it cycles the shown face.
function flipButton(img, faces) {
  let i = 0;
  const icon = el('span', { class: 'fas fa-rotate m-0 no-pointer-events', attrs: { 'aria-label': 'Transform' } });
  const btn = el('a', { class: 'cursor-pointer no-outline solring-cut-flip', attrs: { tabindex: '0', title: 'Flip card face' } }, [
    el('div', { class: 'img-card-flip doubleborder text-white' }, [icon]),
  ]);
  btn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    i = (i + 1) % faces.length;
    img.setAttribute('src', faces[i]);
  });
  return btn;
}

// The minus: a direct edit via Moxfield's API (bearer token from moxfield-token.js). For a
// single copy → DELETE the card and drop the tile. For multiples → PUT the decremented quantity
// (like the native quantity control) and update the ×N count. No Deck Preview UI is driven.
function wireRemove(btn, cut, ctx, cell) {
  btn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!hasToken()) { toast('Interact with Moxfield once so it authenticates, then retry.', true); return; }
    cell.classList.add('solring-cut-busy'); btn.disabled = true;
    try {
      if (cut.quantity > 1) {
        const next = cut.quantity - 1;
        await setCardQuantity(ctx.editId, 'mainboard', cut.cardId, next);
        cut.quantity = next;
        const count = cell.querySelector('.solring-cut-count');
        if (next > 1) { if (count) count.textContent = `×${next}`; } else if (count) count.remove();
        toast('Successfully removed one from main deck!');
        cell.classList.remove('solring-cut-busy'); btn.disabled = false;
      } else {
        await removeCard(ctx.editId, 'mainboard', cut.cardId);
        toast('Successfully removed one from main deck!');
        cell.remove();
        bumpCount(-1);
      }
    } catch (err) {
      cell.classList.remove('solring-cut-busy'); btn.disabled = false;
      toast(`Couldn’t remove “${cut.name}” (${(err && err.message) || 'error'}).`, true);
    }
  });
}

function bumpCount(delta) {
  const t = document.querySelector('.solring-cuts-title');
  if (!t) return;
  const mm = /·\s*(\d+)/.exec(t.textContent);
  if (mm) t.textContent = t.textContent.replace(/·\s*\d+/, `· ${Math.max(0, Number(mm[1]) + delta)}`);
}

// Toast styled like Moxfield's own autosave notification (reuses the .autosave-notification
// class → fixed bottom-center, blue, z-index). That class rests at opacity:0, so we control the
// fade ourselves; errors get a red background + ⚠️.
let toastTimer = null, toastHide = null;
function toast(msg, isError) {
  let box = document.querySelector('.solring-autosave');
  if (!box) {
    box = el('div', { class: 'autosave-notification solring-autosave' });
    box.style.transition = 'opacity .2s'; box.style.opacity = '0';
    document.body.appendChild(box);
  }
  const inner = el('span');
  inner.append(el('span', { class: 'me-2', text: isError ? '⚠️' : '👍' }));
  inner.append(msg);
  box.replaceChildren(inner);
  box.style.background = isError ? '#b00020' : '';
  requestAnimationFrame(() => { box.style.opacity = '1'; });
  clearTimeout(toastTimer); clearTimeout(toastHide);
  toastTimer = setTimeout(() => { box.style.opacity = '0'; toastHide = setTimeout(() => box.remove(), 300); }, 2600);
}
