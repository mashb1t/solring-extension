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
import { getOptions } from './prefs.js';
import { fetchRecs, cutRecs } from './sources/edhrec-recs.js';
import { readDeck, removeFromMain, hasToken, frontKey } from './moxfield-edit.js';

// The recommendations route carries a suffix that moxfield.parseDeckId (anchored on /decks/{id}$)
// rejects, so match + extract the public id here.
const recoMatch = () => /^\/decks\/([A-Za-z0-9_-]+)\/recommendations\/?$/.exec(location.pathname);
const isRecoRoute = () => !!recoMatch();

let installed = false;

export function teardownRecommendations() {
  installed = false;
  document.querySelectorAll('.solring-cuts-tabs, .solring-cuts-view, .solring-cuts-toast, .solring-score-badge').forEach((n) => n.remove());
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

  let cutsRendered = false;
  const show = (showCuts) => {
    tabAdd.classList.toggle('active', !showCuts);
    tabCut.classList.toggle('active', showCuts);
    grid.style.display = showCuts ? 'none' : '';
    if (showCuts) grid.setAttribute('data-solring-recohidden', '1'); else grid.removeAttribute('data-solring-recohidden');
    if (showCuts) cutsView.removeAttribute('hidden'); else cutsView.setAttribute('hidden', '');
    if (showCuts && !cutsRendered) { cutsRendered = true; renderCuts(cutsView, template, grid.className, cuts, { publicId, editId: deck && deck.editId }); }
  };
  tabAdd.addEventListener('click', () => show(false));
  tabCut.addEventListener('click', () => show(true));
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
// the price/buy footer and Options (their data is the template card's), put a grey minus button
// in the card's action overlay, and add the EDHREC score badge.
function buildCutCard(template, cut, ctx) {
  const cell = template.cloneNode(true);
  cell.classList.add('solring-cut-cell');
  const card = cell.querySelector('.decklist-card') || cell;
  const ph = card.querySelector('.decklist-card-phantomsearch');
  if (ph) ph.textContent = cut.name;
  const a = card.querySelector('a[href^="/cards/"]');
  if (a) a.setAttribute('href', `/cards/${cut.cardId}`);
  const img = card.querySelector('img');
  if (img) { img.setAttribute('src', cut.image); img.setAttribute('alt', cut.name); img.removeAttribute('srcset'); }
  card.querySelectorAll('[id^="vsr-"]').forEach((n) => n.removeAttribute('id'));
  // Grey minus button in Moxfield's action-overlay slot (replaces the "+ / N in sideboard" badge).
  const overlay = card.querySelector('.decklist-card-button');
  if (overlay) overlay.replaceChildren(minusButton(cut, ctx, cell));
  // Keep only the card's name + image block; drop the cloned price/buy footer and Options.
  for (const child of [...card.children]) {
    if (!child.querySelector('img') && !child.classList.contains('decklist-card-phantomsearch')) child.remove();
  }
  const visual = card.querySelector('.img-card-visual') || card;
  visual.appendChild(scoreBadge(cut.score));
  return cell;
}

function minusButton(cut, ctx, cell) {
  const btn = el('button', { class: 'btn btn-sm solring-cut-minus', attrs: { type: 'button', title: `Remove ${cut.name} from the deck` }, text: '−' });
  btn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!hasToken()) { toast('Interact with Moxfield once (so it authenticates), then retry.', true); return; }
    cell.classList.add('solring-cut-busy'); btn.disabled = true;
    try {
      await removeFromMain(ctx.publicId, ctx.editId, cut.entryId, cut.name);
      toast(`Removed: ${cut.name}`);
      cell.remove();
      bumpCount(-1);
    } catch (err) {
      cell.classList.remove('solring-cut-busy'); btn.disabled = false;
      toast(`Couldn’t remove “${cut.name}” (${(err && err.message) || 'error'}).`, true);
    }
  });
  return btn;
}

function bumpCount(delta) {
  const t = document.querySelector('.solring-cuts-title');
  if (!t) return;
  const mm = /·\s*(\d+)/.exec(t.textContent);
  if (mm) t.textContent = t.textContent.replace(/·\s*\d+/, `· ${Math.max(0, Number(mm[1]) + delta)}`);
}

let toastTimer = null;
function toast(msg, isError) {
  let box = document.querySelector('.solring-cuts-toast');
  if (!box) { box = el('div', { class: 'solring-cuts-toast' }); document.body.appendChild(box); }
  box.textContent = msg;
  box.classList.toggle('solring-cuts-toast-error', !!isError);
  box.classList.add('solring-cuts-toast-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('solring-cuts-toast-show'), 4000);
}
