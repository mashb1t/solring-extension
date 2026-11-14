// Moxfield UI driver for the Guided Deck Builder. Solring never writes decks through Moxfield's
// API: this module only clicks and types into Moxfield's own UI (Bulk Edit, Create New Deck,
// Change Commander) and lets Moxfield save. `editBulkText` is the pure, unit-tested core.
//
// LIVE-VERIFY 2026-11-13 (Brave, logged in, throwaway deck, Moxfield "Version 2026.11.13.2"):
// - Bulk Edit: deck-view link `a[href="/decks/{id}/edit"]`, text "Bulk Edit" (label spans hide at
//   small widths → match textContent). It is an in-app SPA route, not a modal. Absent for
//   non-owners and when logged out (logged out: navbar `a[href^="/account/signin"]` "Sign in").
// - Bulk editor: ONE `textarea#board[data-testid="deck-bulk-edit-page-board"]` shared by the board
//   tabs `a.nav-link` "Main Deck" / "Sideboard" / "Considering" / "Other" (active tab has `.active`);
//   `label[for="board"]` reads "Main Deck (N)" and tracks the textarea live. The textarea mounts
//   already filled (sampled every 20–30 ms: no empty frame on SPA nav or hard load).
// - Save: `button` with text "Save" in the bulk-edit form → saves and returns to /decks/{id}.
//   ("Save & Continue Editing" = `data-testid="deck-bulk-edit-page-save"`, stays on /edit; unused.)
//   `button` "Cancel" → back to /decks/{id}; while the text differs from the loaded list it first
//   raises a native confirm("You have unsaved changes…"), so restore the text before cancelling.
//   A refused Save (unknown card) stays on /edit and shows `.invalid-feedback` "Error on line N of
//   mainboard: Could not find card "X". (1 X)".
// - Ownership: the "More" menu (`#subheader-more`) of a deck you own adds "Change Authors",
//   "Change Commander", "Settings", "Delete"; a logged-in non-owner's menu has none of them.
// - Commanders: Bulk Edit has NO commander board (Other → Attraction/Contraption/Sticker/Planar/
//   Schemes only), and commanders are not listed in the Main Deck text. Moxfield's own path is the
//   "Change Commander" dialog: deck view `#subheader-more` ("More") → dropdown item
//   "Change Commander" (or the `a.alert-link` "Pick a Commander" on commander-less decks) →
//   `.modal.show[role=dialog]` titled "Change Commander" → typeahead → footer button "Save".
//   Changing the commander moves the old one into the mainboard; picking a card that is already in
//   the mainboard moves it out (no duplicate).
// - Deck view summary: "<N> main deck" (counts commanders too); commander section header
//   `[data-testid="deck-view-header-options-title"]` "Commander" + sibling
//   `[data-testid="deck-view-header-options-total"]` "(k)".
// - Create New Deck dialog (Your Decks → "New Deck"): `.modal.show[role=dialog]` "Create New Deck";
//   name `input#name[data-testid="deck-settings-page-name"]`; format `select#format` (value
//   "commander" = "Commander / EDH", the default); visibility radios under "Advanced options";
//   Create = `data-testid="new-deck-modal-create"` (never clicked here).
// - Commander typeahead (same component in both dialogs): `input[data-testid="commander-search-input"]`
//   (role=combobox, placeholder "Who is your commander?", `aria-controls` → listbox
//   `[data-testid="commander-search-dropdown"]`); options `a[role=option][data-testid^=
//   "commander-search-result-"]` with the card name as text. Clicking an option closes the list
//   (`aria-expanded="false"`) and leaves the name in the input.

import { frontFace } from './sources/scryfall.js';

// One bulk-edit line: "<qty>[x] <name>[ (SET) num][ *F*][ #tag…]".
// Returns { qty, key } or null for anything that isn't a card line (blank, section header, comment).
const LINE_RE = /^(\s*)(\d+)(x?\s+)(.+)$/;
function parseLine(line) {
  const m = LINE_RE.exec(line.replace(/\r$/, ''));
  if (!m) return null;
  let name = m[4];
  name = name.replace(/\s+\([A-Za-z0-9]{2,8}\)(\s+\S+)?(\s+\*[A-Za-z]+\*)*(\s+#.*)?\s*$/, '');
  name = name.replace(/(\s+\*[A-Za-z]+\*)+(\s+#.*)?\s*$/, '').replace(/\s+#.*$/, '').trim();
  if (!name) return null;
  return { qty: Number(m[2]), key: frontFace(name) };
}

// Pure text transform over Moxfield's Bulk Edit text. Removes lines whose front-face name is in
// `remove` (case-insensitive); for each `add`, bumps the first matching line's quantity or appends
// "<qty> <name>". Every other line is preserved byte-for-byte (incl. CR, set codes, foil marks).
export function editBulkText(text, { add = [], remove = [] } = {}) {
  const src = String(text ?? '');
  const removeKeys = new Set((remove || []).map(frontFace));
  const adds = new Map();
  for (const a of add || []) {
    if (!a || !a.name) continue;
    const k = frontFace(a.name);
    const q = Math.max(0, Math.floor(Number(a.qty) || 0)) || 1;
    const prev = adds.get(k);
    adds.set(k, { name: prev ? prev.name : a.name, qty: (prev ? prev.qty : 0) + q });
  }
  if (!removeKeys.size && !adds.size) return src;

  const out = [];
  for (const line of src === '' ? [] : src.split('\n')) {
    const p = parseLine(line);
    if (p && removeKeys.has(p.key)) continue;
    if (p && adds.has(p.key)) {
      const extra = adds.get(p.key).qty;
      adds.delete(p.key);
      out.push(line.replace(/^(\s*)\d+/, (_, ws) => `${ws}${p.qty + extra}`));
      continue;
    }
    out.push(line);
  }
  const appended = [...adds.values()].map((a) => `${a.qty} ${a.name}`);
  if (appended.length) {
    // Keep a trailing newline (if the text had one) after the appended lines.
    const trailing = out.length && out[out.length - 1].replace(/\r$/, '') === '' ? out.pop() : null;
    out.push(...appended);
    if (trailing !== null) out.push(trailing);
  }
  return out.join('\n');
}

// Sum of quantities over the card lines of a bulk-edit text.
const bulkCount = (text) => String(text || '').split('\n').reduce((n, l) => { const p = parseLine(l); return n + (p ? p.qty : 0); }, 0);

/**
 * Data-loss guard: may a bulk-edit textarea whose card lines sum to `parsed` be rewritten?
 * `label` = Moxfield's "Main Deck (N)" number (or null), `view` = the deck view's { main, total }
 * (or null). Fails closed: at least one source must be known and every known source must match
 * (the view's summary may or may not count commanders, so main or total). An empty textarea is
 * refused while any known mainboard count says the deck has cards.
 */
export function countsAgree({ parsed, label = null, view = null }) {
  if (label == null && !view) return false;
  if (label != null && label !== parsed) return false;
  if (view && parsed !== view.main && parsed !== view.total) return false;
  if (parsed === 0 && ((label || 0) > 0 || (view && view.main > 0))) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// DOM driver. Everything below only clicks/types into Moxfield's own UI; Moxfield does the write.
// Never throws: every entry point is wrapped and degrades to {ok:false, reason} / false.

const WAIT_MS = 5000;
const SAVE_WAIT_MS = 10000;
const POLL_MS = 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UI_CHANGED = { ok: false, reason: 'ui-changed' };
const NOT_EDITABLE = { ok: false, reason: 'not-editable' };
const text = (n) => (n && n.textContent ? n.textContent.replace(/\s+/g, ' ').trim() : '');

// Poll `fn` until it returns a truthy value (returned) or `ms` elapses (→ null).
async function waitFor(fn, ms = WAIT_MS) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(POLL_MS);
  }
}

// React-controlled inputs ignore a plain `.value =`; go through the native setter + event.
function setNativeValue(node, value, event = 'input') {
  const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value);
  node.dispatchEvent(new Event(event, { bubbles: true }));
}

const findByText = (selector, re, root = document) => [...root.querySelectorAll(selector)].find((n) => re.test(text(n))) || null;
const deckPath = () => /^\/decks\/([\w-]+)(\/edit)?\/?$/.exec(location.pathname);
// Logged out: Moxfield renders a "Sign in" link in the navbar instead of the account menu.
const loggedOut = () => !!findByText('a', /^sign in$/i) || !!document.querySelector('a[href^="/account/signin"]');
const bulkEditLink = () => findByText('a[href$="/edit"]', /^bulk\s*edit$/i);
/** Can the current user edit the open deck? Moxfield shows the deck view's "Bulk Edit" link only
 *  to its logged-in owner (LIVE-VERIFY above). Synchronous: false until the subheader renders. */
export const canEdit = () => !!bulkEditLink();
const visibleModal = () => [...document.querySelectorAll('.modal.show[role="dialog"]')].pop() || null;
const moreButton = () => document.getElementById('subheader-more') || findByText('a, button', /^more$/i);
const onDeckView = () => { const p = deckPath(); return !!(p && !p[2]); };
// Items only the deck's owner gets in the deck view's "More" menu (LIVE-VERIFY: a non-owner's menu
// stops at "Add to Wish List"; the owner's adds Change Authors / Change Commander / Settings / Delete).
const OWNER_ITEM_RE = /^(change authors|change commander|settings|delete)$/i;

const menuOpen = () => !!document.querySelector('.dropdown-menu.show');
// Toggle Moxfield's dropdown shut; it closes asynchronously (LIVE-VERIFY), so wait for it.
async function closeMenu(more) {
  if (more && menuOpen()) { more.click(); await waitFor(() => !menuOpen(), 1000); }
}

// Open the "More" menu, report whether it holds owner-only items, close it again.
// true = owner, false = menu opened without owner items, null = no menu / it didn't open.
async function ownerMenuSignal() {
  const more = moreButton();
  if (!more) return null;
  if (!menuOpen()) more.click();
  const items = await waitFor(() => {
    const list = [...document.querySelectorAll('.dropdown-menu.show a, .dropdown-menu.show button')];
    return list.length ? list : null;
  }, 2000);
  const owner = items ? items.some((n) => OWNER_ITEM_RE.test(text(n))) : null;
  await closeMenu(more);
  return owner;
}

// Can the current user edit the deck in the deck view? Resolves to 'ok' (Bulk Edit link present),
// NOT_EDITABLE (logged out, or logged in with a non-owner "More" menu) or UI_CHANGED (owner-looking
// page without our anchors, or no recognisable deck view). Logged out short-circuits immediately;
// once the deck subheader ("More") has rendered, the link would be there too, so no full wait.
async function editAccess() {
  const seen = await waitFor(() => (bulkEditLink() && 'link') || (loggedOut() && 'out') || (moreButton() && 'nolink'));
  if (seen === 'link') return 'ok';
  if (seen === 'out' || loggedOut()) return NOT_EDITABLE;
  if (!seen) return UI_CHANGED;
  const owner = await ownerMenuSignal();
  if (owner === false) return NOT_EDITABLE;
  // Owner (or unreadable menu): give a late-rendering link a moment, else the UI moved.
  return (await waitFor(bulkEditLink, owner ? 2000 : 0)) ? 'ok' : UI_CHANGED;
}

// Type `name` into one of Moxfield's commander typeaheads and pick the suggestion whose front face
// equals `name`'s (case-insensitive). true once the suggestion was clicked and the list closed.
async function pickCommander(input, name) {
  const want = frontFace(name);
  input.focus();
  setNativeValue(input, String(name));
  const option = await waitFor(() => {
    const list = document.getElementById(input.getAttribute('aria-controls') || '') || input.closest('.dropdown');
    if (!list) return null;
    return [...list.querySelectorAll('[role="option"], [data-testid^="commander-search-result-"]')]
      .find((o) => frontFace(text(o)) === want) || null;
  });
  if (!option) { setNativeValue(input, ''); return false; }
  option.click();
  return !!(await waitFor(() => input.getAttribute('aria-expanded') !== 'true' && frontFace(input.value) === want, 2000));
}

// Deck view's own mainboard total ("13 main deck", which counts the commanders too) minus the
// "Commander (k)" section count. null when the deck view isn't rendered / the summary moved.
function viewMainCount() {
  const sum = findByText('div, span', /^\d+ main deck$/i);
  if (!sum) return null;
  const head = findByText('[data-testid="deck-view-header-options-title"]', /^commanders?$/i);
  const tot = head && head.parentElement.querySelector('[data-testid="deck-view-header-options-total"]');
  const cmd = tot ? parseInt(text(tot).replace(/\D/g, ''), 10) || 0 : 0;
  return { total: parseInt(text(sum), 10), main: parseInt(text(sum), 10) - cmd };
}

// From the deck view, follow Moxfield's own "Bulk Edit" link (an in-app SPA route,
// /decks/{id}/edit). Returns { ok, expected, navigated } where `expected` is the deck view's
// mainboard count and `navigated` says we left the deck view (so a failure must bring the user back).
async function openBulkEdit() {
  const p = deckPath();
  if (!p) return NOT_EDITABLE;
  if (p[2]) return { ok: true, expected: null, navigated: false };
  const access = await editAccess();
  if (access !== 'ok') return access;
  const expected = await waitFor(viewMainCount, 2000);
  const link = bulkEditLink();
  if (!link) return UI_CHANGED;
  link.click();
  return { ok: true, expected, navigated: true };
}

// Wait for the bulk editor's Main Deck textarea and make sure it holds the full list before we
// rewrite it (saving a partially loaded list would delete cards). Moxfield mounts the textarea
// already filled (LIVE-VERIFY: no empty frame, SPA or hard load), but we still cross-check the
// parsed quantity sum against the deck view's count and Moxfield's own "Main Deck (N)" label, and
// refuse (null) when neither is readable (countsAgree fails closed).
const boardTextarea = () => document.querySelector('textarea[data-testid="deck-bulk-edit-page-board"], textarea#board');
async function readyMainboard(expected) {
  const tab = await waitFor(() => findByText('a.nav-link', /^main deck$/i));
  if (!tab) return null;
  if (!tab.classList.contains('active')) { tab.click(); if (!(await waitFor(() => tab.classList.contains('active'), 2000))) return null; }
  return waitFor(() => {
    const board = boardTextarea();
    if (!board || board.disabled || board.readOnly) return null;
    const label = document.querySelector('label[for="board"]');
    const m = /^main deck\s*\((\d+)\)/i.exec(text(label));
    return countsAgree({ parsed: bulkCount(board.value), label: m ? Number(m[1]) : null, view: expected || null }) ? board : null;
  });
}

// Undo our edit and leave the bulk editor without saving: put the original text back (Moxfield's
// Cancel raises a native "unsaved changes" confirm() while the text differs — LIVE-VERIFY), then
// click Moxfield's own Cancel (falls back to history.back()) and wait for the deck view.
async function leaveBulkEdit(board, original) {
  try {
    if (board && board.isConnected && original != null && board.value !== original) {
      setNativeValue(board, original);
      await waitFor(() => board.value === original, 1000);
      await sleep(100);
    }
    if (onDeckView()) return;
    const cancel = findByText('button', /^cancel$/i);
    if (cancel) cancel.click(); else history.back();
    await waitFor(onDeckView, 3000);
  } catch { /* best effort: never throw into the page */ }
}

// Moxfield's own validation message under the textarea after a refused Save, e.g.
// 'Error on line 11 of mainboard: Could not find card "Zzzz". (1 Zzzz)' (LIVE-VERIFY).
const bulkError = () => [...document.querySelectorAll('.invalid-feedback')].map(text).find(Boolean) || null;

/**
 * Add/remove mainboard cards through Moxfield's own Bulk Edit page and let Moxfield save.
 * Call from the deck view (or the bulk editor). Never throws. With `publicId`, the edit is bound to
 * that deck: if the URL names another deck on entry, before Save, or when the view returns, the
 * result is 'ui-changed' (nothing is saved unless the mismatch only shows up after Save).
 * @returns {Promise<{ok:true} | {ok:false, reason:'not-editable'|'ui-changed'|'rejected', message?:string}>}
 *   - 'not-editable': not a deck page, logged out, or logged in but not the deck's owner.
 *   - 'ui-changed':   Moxfield's UI no longer matches our anchors (Bulk Edit link / textarea / Save
 *                     missing, list never fully loaded) or the Save didn't finish within 10 s.
 *   - 'rejected':     Moxfield refused the text (e.g. unknown card names); `message` is its error.
 *   On every failure before or at Save (incl. 'rejected') the original text is restored and the
 *   user is returned to the deck view if we navigated away from it; nothing is saved. After a Save
 *   timeout the page is left as is.
 */
export async function applyBulkEdit({ add = [], remove = [], publicId = null } = {}) {
  // Bound to the deck the edit was planned for: after an SPA move the URL names another deck.
  const sameDeck = () => !publicId || (deckPath() || [])[1] === publicId;
  if (!sameDeck()) return UI_CHANGED;
  let opened = null;
  let board = null;
  let original = null;
  const fail = async (result) => {
    if (opened && opened.navigated) await leaveBulkEdit(board, original);
    else if (board && original != null && board.isConnected && board.value !== original) setNativeValue(board, original);
    return result;
  };
  try {
    opened = await openBulkEdit();
    if (!opened.ok) return opened;
    board = await readyMainboard(opened.expected);
    if (!board) return await fail(UI_CHANGED);
    original = board.value;
    const next = editBulkText(original, { add, remove });
    if (next !== original) {
      setNativeValue(board, next);
      if (!(await waitFor(() => board.value === next, 1000))) return await fail(UI_CHANGED);
    }
    const save = findByText('button', /^save$/i, board.closest('form') || document);
    if (!save || !sameDeck()) return await fail(UI_CHANGED);
    save.click();
    // Moxfield's "Save" returns to the deck view; a validation error keeps it on /edit.
    // Landing on another deck's view mid-save is not a confirmed save of this one.
    const outcome = await waitFor(() => (onDeckView() && (sameDeck() ? 'saved' : 'moved')) || (bulkError() && 'rejected'), SAVE_WAIT_MS);
    if (outcome === 'saved') return { ok: true };
    if (outcome === 'rejected') {
      const message = bulkError();
      return await fail({ ok: false, reason: 'rejected', message });
    }
    return UI_CHANGED;
  } catch {
    try { return await fail(UI_CHANGED); } catch { return UI_CHANGED; }
  }
}

// Pre-fill Moxfield's "Create New Deck" dialog (already open). Name only if empty; format →
// Commander; commander picked from Moxfield's own typeahead. Never clicks Create.
// Returns false when the dialog, the commander input or a matching suggestion doesn't show up in
// time (the typed commander text is cleared again; a Name we filled stays).
export async function prefillNewDeck({ name, commander } = {}) {
  try {
    const nameInput = await waitFor(() => {
      const m = visibleModal();
      return m && m.querySelector('input[data-testid="deck-settings-page-name"], input#name');
    });
    if (!nameInput) return false;
    const modal = nameInput.closest('.modal');
    if (name && !nameInput.value) setNativeValue(nameInput, String(name));
    const format = modal.querySelector('select#format');
    if (format && format.value !== 'commander' && [...format.options].some((o) => o.value === 'commander')) setNativeValue(format, 'commander', 'change');
    if (commander) {
      const input = await waitFor(() => modal.querySelector('input[data-testid="commander-search-input"]'));
      if (!input || !(await pickCommander(input, commander))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Set the commander(s) of the deck currently open in the deck view through Moxfield's own
// "Change Commander" dialog (More menu, or the "Pick a Commander" alert on commander-less decks).
// Bulk Edit has no commander board (LIVE-VERIFY 2026-11-13), hence this path. Existing decks only.
/**
 * @param {string[]} commanders  one name, or two for partners
 * @returns {Promise<{ok:true} | {ok:false, reason:'not-editable'|'ui-changed'}>}
 *   'not-editable' = not on a deck view, logged out, or not the deck's owner; 'ui-changed' = the
 *   menu item / dialog / suggestion / Save wasn't found (dialog closed unsaved) or Save timed out.
 */
export async function setCommanderViaBulk(commanders = []) {
  try {
    const names = (commanders || []).filter(Boolean);
    if (!names.length) return UI_CHANGED;
    const p = deckPath();
    if (!p || p[2]) return NOT_EDITABLE;
    const access = await editAccess();
    if (access !== 'ok') return access;

    let item = null;
    const more = moreButton();
    if (more) {
      if (!menuOpen()) more.click();
      item = await waitFor(() => findByText('.dropdown-menu.show a, .dropdown-menu.show button', /^change commander$/i), 2000);
      // Not in the menu: close it again before trying the alert link / giving up.
      if (!item) await closeMenu(more);
    }
    if (!item) item = findByText('a.alert-link', /^pick a commander$/i);
    if (!item) return UI_CHANGED;
    item.click();

    const modal = await waitFor(() => { const m = visibleModal(); return m && /change commander/i.test(text(m.querySelector('.modal-title'))) ? m : null; });
    if (!modal) return UI_CHANGED;
    // Bail out without saving: close Moxfield's dialog so nothing half-filled is left open.
    const abort = () => { const x = modal.querySelector('.btn-close'); if (x) x.click(); return UI_CHANGED; };
    for (let i = 0; i < names.length; i++) {
      // A partner's second input appears once the first commander allows one.
      const input = await waitFor(() => modal.querySelectorAll('input[data-testid="commander-search-input"]')[i]);
      if (!input || !(await pickCommander(input, names[i]))) return abort();
    }
    const save = findByText('.modal-footer button', /^save$/i, modal);
    if (!save) return abort();
    save.click();
    return (await waitFor(() => !modal.isConnected || !modal.classList.contains('show'), SAVE_WAIT_MS)) ? { ok: true } : UI_CHANGED;
  } catch {
    return UI_CHANGED;
  }
}
