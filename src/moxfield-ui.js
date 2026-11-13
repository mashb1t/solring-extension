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
const visibleModal = () => [...document.querySelectorAll('.modal.show[role="dialog"]')].pop() || null;

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
  if (!option) return false;
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
// /decks/{id}/edit). Returns { ok, expected } where `expected` is the deck view's mainboard count.
async function openBulkEdit() {
  const p = deckPath();
  if (!p) return NOT_EDITABLE;
  if (p[2]) return { ok: true, expected: null };
  const link = await waitFor(bulkEditLink);
  if (!link) return loggedOut() || document.getElementById('subheader-more') || viewMainCount() ? NOT_EDITABLE : UI_CHANGED;
  const expected = await waitFor(viewMainCount, 2000);
  link.click();
  return { ok: true, expected };
}

// Wait for the bulk editor's Main Deck textarea and make sure it holds the full list before we
// rewrite it (saving a partially loaded list would delete cards). Moxfield mounts the textarea
// already filled (LIVE-VERIFY: no empty frame, SPA or hard load), but we still cross-check the
// parsed quantity sum against the deck view's count and Moxfield's own "Main Deck (N)" label.
async function readyMainboard(expected) {
  const tab = await waitFor(() => findByText('a.nav-link', /^main deck$/i));
  if (!tab) return null;
  if (!tab.classList.contains('active')) { tab.click(); if (!(await waitFor(() => tab.classList.contains('active'), 2000))) return null; }
  return waitFor(() => {
    const board = document.querySelector('textarea[data-testid="deck-bulk-edit-page-board"], textarea#board');
    if (!board || board.disabled || board.readOnly) return null;
    const label = document.querySelector('label[for="board"]');
    const m = /^main deck\s*\((\d+)\)/i.exec(text(label));
    const n = bulkCount(board.value);
    if (m && Number(m[1]) !== n) return null;
    if (expected && n !== expected.main && n !== expected.total) return null;
    return board;
  });
}

export async function applyBulkEdit({ add = [], remove = [] } = {}) {
  try {
    const opened = await openBulkEdit();
    if (!opened.ok) return opened;
    const board = await readyMainboard(opened.expected);
    if (!board) return UI_CHANGED;
    const next = editBulkText(board.value, { add, remove });
    if (next !== board.value) {
      setNativeValue(board, next);
      if (!(await waitFor(() => board.value === next, 1000))) return UI_CHANGED;
    }
    const form = board.closest('form') || document;
    const save = findByText('button', /^save$/i, form);
    if (!save) return UI_CHANGED;
    save.click();
    // Moxfield's "Save" returns to the deck view; staying on /edit means it rejected the text.
    return (await waitFor(() => { const p = deckPath(); return p && !p[2]; }, SAVE_WAIT_MS)) ? { ok: true } : UI_CHANGED;
  } catch {
    return UI_CHANGED;
  }
}

// Pre-fill Moxfield's "Create New Deck" dialog (already open). Name only if empty; format →
// Commander; commander picked from Moxfield's own typeahead. Never clicks Create.
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
// Bulk Edit has no commander board (LIVE-VERIFY 2026-11-13), hence this path.
export async function setCommanderViaBulk(commanders = []) {
  try {
    const names = (commanders || []).filter(Boolean);
    if (!names.length) return UI_CHANGED;
    const p = deckPath();
    if (!p || p[2]) return NOT_EDITABLE;
    if (!(await waitFor(bulkEditLink))) return loggedOut() || document.getElementById('subheader-more') ? NOT_EDITABLE : UI_CHANGED;

    let item = null;
    const more = document.getElementById('subheader-more') || findByText('a', /^more$/i);
    if (more) {
      more.click();
      item = await waitFor(() => findByText('.dropdown-menu.show a, .dropdown-menu.show button', /^change commander$/i), 2000);
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
