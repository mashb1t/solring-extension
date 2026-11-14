// Moxfield helpers for the Guided Deck Builder. Card writes (applyBulkEdit) send the SAME single
// request Moxfield's own Bulk Edit "Save" sends (moxfield-edit.bulkEditWrite, token write —
// user-accepted 2026-11-14). Creating a deck and setting a commander still go through Moxfield's
// own UI (Create New Deck / Change Commander dialogs) and let Moxfield save. `editBulkText`,
// `bulkEditBody` and `bulkEditOutcome` are the pure, unit-tested core.
//
// LIVE-VERIFY 2026-11-14 (Brave, logged in, throwaway deck NI5kZZpj4Um1X0CjHozDOw, Moxfield
// "Version 2026.11.13.2") — Bulk Edit API, captured off Moxfield's own page:
// - Fill: opening Bulk Edit issues GET https://api2.moxfield.com/v2/decks/{publicId}/bulk-edit
//   ?ignoreFlavorNames=true&allowMultiplePrintings=true (Authorization: bearer) →
//   { boards: { mainboard, sideboard, maybeboard, companions, attractions, stickers, contraptions,
//   planes, schemes, tokens } (one text per board; NO commanders board), pricingProvider
//   ("cardMarket"), allowMultiplePrintings/usePrefPrintings/ignoreFlavorNames (all false) }.
//   The textarea shows exactly `boards.mainboard`.
// - Save: PUT https://api2.moxfield.com/v3/decks/{publicId}/bulk-edit (PUBLIC id, not the internal
//   `id`), headers Authorization, Content-Type: application/json, x-public-deck-id: {publicId},
//   x-deck-version: {v3 deck JSON `version`} (Moxfield also adds x-moxfield-version /
//   x-session-user; an in-page PUT without them succeeded). Body: { boards: <all 10 board texts,
//   only the edited one changed>, pricingProvider: "cardmarket", usePrefPrintings: true,
//   ignoreFlavorNames: true, allowMultiplePrintings: true } — Moxfield sends true/true/true even
//   though the GET echoes false/false/false; echoing the GET's "cardMarket" was accepted too.
//   Set-less lines get the preferred printing ("1 Island" comes back as "1 Island (SOS) 268").
// - Success: HTTP 200 { isSuccessful: true, boardSummary: { boardCounts: { mainboard: N, … } },
//   errors: { boards: { <board>: [] } }, deck: <full v3 deck JSON>, bulkEdit }; response header
//   x-deck-version = old + 1.
// - Rejected card name: also HTTP 200 (NOT a 4xx), { isSuccessful: false, boardSummary, errors:
//   { boards: { mainboard: [{ lineNumber: 6, errorMessage: 'Could not find card "X".',
//   originalText: "1 X" }] } } } and no `deck`; nothing saved (the version still bumps).
// - No optimistic concurrency: a PUT with a stale x-deck-version (forced to 3 while the deck was
//   at 53) still saved; the only signal is response header x-deck-has-changed: true (false on a
//   normal save). Hence applyBulkEdit re-reads the deck + bulk text right before every write.
// - Refreshing Moxfield's own deck view: an API write does NOT update an open deck view by itself
//   (no websocket). Moxfield syncs tabs over BroadcastChannel `moxfield-sync-{userId}`; posting
//   { v: 1, kind: 'deck', publicId, prevVersion, version, isTruncated: true } there (also from an
//   isolated world, i.e. a content script) makes the deck view refetch GET /v3/decks/all/{id} and
//   re-render in place: section.deckview, its parent and the decklist <li> rows keep their
//   identity. `userId` = the deck JSON's `ownerUserId` (= the session user for the owner).
//
// LIVE-VERIFY 2026-11-13 (still current; UI paths used by canEdit / setCommanderViaBulk /
// prefillNewDeck):
// - Deck view "Bulk Edit" link `a[href="/decks/{id}/edit"]`, text "Bulk Edit" (label spans hide at
//   small widths → match textContent); absent for non-owners and when logged out (logged out:
//   navbar `a[href^="/account/signin"]` "Sign in").
// - Ownership: the "More" menu (`#subheader-more`) of a deck you own adds "Change Authors",
//   "Change Commander", "Settings", "Delete"; a logged-in non-owner's menu has none of them.
// - Commanders: Bulk Edit has NO commander board (Other → Attraction/Contraption/Sticker/Planar/
//   Schemes only; the API body has none either), and commanders are not listed in the Main Deck
//   text. Moxfield's own path is the "Change Commander" dialog: deck view `#subheader-more`
//   ("More") → dropdown item "Change Commander" (or the `a.alert-link` "Pick a Commander" on
//   commander-less decks) → `.modal.show[role=dialog]` titled "Change Commander" → typeahead →
//   footer button "Save". Changing the commander moves the old one into the mainboard; picking a
//   card that is already in the mainboard moves it out (no duplicate).
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
import { readDeckJson, bulkEditRead, bulkEditWrite, PUBLIC_ID_RE } from './moxfield-edit.js';

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

// The `remove` names that no card line of the bulk text matches (front face, case-insensitive):
// editBulkText would silently skip them, so applyBulkEdit refuses the whole edit instead.
export function unmatchedRemovals(text, remove = []) {
  const have = new Set();
  for (const line of String(text ?? '').split('\n')) { const p = parseLine(line); if (p) have.add(p.key); }
  return (remove || []).filter((n) => n && !have.has(frontFace(n)));
}

// Sum of quantities over the card lines of a bulk-edit text.
export const bulkCount = (text) => String(text || '').split('\n').reduce((n, l) => { const p = parseLine(l); return n + (p ? p.qty : 0); }, 0);

// Sum of quantities of one board of a raw /v3/decks/all JSON; null when the board / shape is
// unknown (so the data-loss guard fails closed).
export function deckBoardCount(deck, board) {
  const b = deck && deck.boards && deck.boards[board];
  if (!b || !b.cards || typeof b.cards !== 'object') return null;
  let n = 0;
  for (const c of Object.values(b.cards)) {
    const q = c && c.quantity;
    if (!Number.isFinite(q)) return null;
    n += q;
  }
  return n;
}

/**
 * Data-loss guard: may a bulk-edit mainboard text whose card lines sum to `parsed` be rewritten
 * when the deck JSON says the mainboard holds `expected` cards? Fails closed: an unknown count on
 * either side, or any mismatch (incl. an empty text against a non-empty deck), refuses.
 */
export function countsAgree({ parsed, expected }) {
  return Number.isFinite(parsed) && Number.isFinite(expected) && parsed === expected;
}

// The board texts Moxfield's Bulk Edit GET returns and its Save sends back (LIVE-VERIFY 2026-11-14).
export const BULK_BOARDS = Object.freeze(['mainboard', 'sideboard', 'maybeboard', 'companions', 'attractions', 'stickers', 'contraptions', 'planes', 'schemes', 'tokens']);

/**
 * Data-loss guard over the whole Bulk Edit GET: the mainboard, sideboard and maybeboard texts must
 * each hold exactly the deck JSON's card count for that board (countsAgree, fails closed).
 */
export function bulkGuard(get, deck) {
  const boards = get && get.boards;
  if (!boards || !deck) return false;
  return ['mainboard', 'sideboard', 'maybeboard'].every((b) => typeof boards[b] === 'string'
    && countsAgree({ parsed: bulkCount(boards[b]), expected: deckBoardCount(deck, b) }));
}

/**
 * The PUT body Moxfield's own Bulk Edit Save sends, from the bulk-edit GET response and the new
 * mainboard text. Every other board passes through unchanged (never built from scratch: a board
 * left out would be wiped). null unless all 10 known board texts and the pricingProvider are there.
 */
export function bulkEditBody(get, mainboard) {
  const boards = get && get.boards;
  if (!boards || typeof boards !== 'object' || typeof mainboard !== 'string') return null;
  if (!BULK_BOARDS.every((b) => typeof boards[b] === 'string')) return null;
  if (Object.values(boards).some((t) => typeof t !== 'string')) return null;
  if (typeof get.pricingProvider !== 'string' || !get.pricingProvider) return null;
  return {
    boards: { ...boards, mainboard },
    pricingProvider: get.pricingProvider,
    usePrefPrintings: true,
    ignoreFlavorNames: true,
    allowMultiplePrintings: true,
  };
}

const UI_CHANGED = { ok: false, reason: 'ui-changed' };
const NOT_EDITABLE = { ok: false, reason: 'not-editable' };
const SESSION = { ok: false, reason: 'session' }; // no / expired token: a reload re-captures it

// Moxfield's per-line validation errors → 'Line 6 of mainboard: Could not find card "X". (1 X)'.
function lineErrors(json) {
  const boards = json && json.errors && json.errors.boards;
  if (!boards || typeof boards !== 'object') return [];
  const out = [];
  for (const [board, list] of Object.entries(boards)) {
    for (const e of Array.isArray(list) ? list : []) {
      if (!e || !e.errorMessage) continue;
      const where = Number.isFinite(e.lineNumber) ? `Line ${e.lineNumber} of ${board}: ` : `${board}: `;
      out.push(`${where}${e.errorMessage}${e.originalText ? ` (${e.originalText})` : ''}`);
    }
  }
  return out;
}

/**
 * Map a bulkEditRead result ({ ok, status, json } or null) before any write: null (no token) or
 * 401 → session, 403 → not-editable, 200 JSON → null (go on), anything else → ui-changed.
 */
export function bulkReadOutcome(res) {
  if (!res) return SESSION;
  if (res.status === 401) return SESSION;
  if (res.status === 403) return NOT_EDITABLE;
  return res.ok && res.json && typeof res.json === 'object' ? null : UI_CHANGED;
}

/** Did someone else save the deck between our read and our write? Our PUT bumps the version by
 *  exactly one (LIVE-VERIFY); anything else means another save landed. Unknown → false. */
export function concurrentChange(prevVersion, savedVersion) {
  return Number.isFinite(prevVersion) && Number.isFinite(savedVersion) && savedVersion !== prevVersion + 1;
}

/**
 * Map a bulkEditWrite result ({ ok, status, json } or null) to applyBulkEdit's contract.
 * 401 → session; 403 → not-editable; 200 + isSuccessful → ok; isSuccessful:false with line errors (Moxfield
 * answers an unknown card with HTTP 200, LIVE-VERIFY) → rejected; anything else → ui-changed.
 */
export function bulkEditOutcome(res) {
  if (!res || !Number.isFinite(res.status)) return UI_CHANGED;
  if (res.status === 401) return SESSION;
  if (res.status === 403) return NOT_EDITABLE;
  const json = res.json;
  if (res.ok && json && json.isSuccessful === true) return { ok: true };
  if (json && json.isSuccessful === false) {
    const errs = lineErrors(json);
    if (errs.length) return { ok: false, reason: 'rejected', message: errs.join('; ') };
  }
  return UI_CHANGED;
}

// Moxfield's cross-tab "this deck changed" message (LIVE-VERIFY 2026-11-14): isTruncated tells
// every open deck view to refetch the deck itself, so no deck data is injected. null without the
// ids/versions it needs.
export function deckSyncMessage({ publicId, ownerUserId, prevVersion, version }) {
  if (!publicId || !ownerUserId || !Number.isFinite(prevVersion) || !Number.isFinite(version)) return null;
  return {
    channel: `moxfield-sync-${ownerUserId}`,
    message: { v: 1, kind: 'deck', publicId, prevVersion, version, isTruncated: true },
  };
}

// ---------------------------------------------------------------------------------------------
// Entry points. applyBulkEdit writes via the Bulk Edit API; the dialog helpers below only click/type
// into Moxfield's own UI and let Moxfield save. Never throw: every entry point is wrapped and
// degrades to {ok:false, reason} / false.

const WAIT_MS = 5000;
const SAVE_WAIT_MS = 10000;
const POLL_MS = 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
// Bound to a deck when `publicId` is given (the write path); any deck's link otherwise (canEdit).
const bulkEditLink = (publicId = null) => findByText(publicId ? `a[href="/decks/${publicId}/edit"]` : 'a[href$="/edit"]', /^bulk\s*edit$/i);
/** Can the current user edit the open deck? Moxfield shows the deck view's "Bulk Edit" link only
 *  to its logged-in owner (LIVE-VERIFY above). Synchronous: false until the subheader renders. */
export const canEdit = () => !!bulkEditLink();
const visibleModal = () => [...document.querySelectorAll('.modal.show[role="dialog"]')].pop() || null;
const moreButton = () => document.getElementById('subheader-more') || findByText('a, button', /^more$/i);
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
async function editAccess(publicId = null) {
  const link = () => bulkEditLink(publicId);
  const seen = await waitFor(() => (link() && 'link') || (loggedOut() && 'out') || (moreButton() && 'nolink'));
  if (seen === 'link') return 'ok';
  if (seen === 'out' || loggedOut()) return NOT_EDITABLE;
  if (!seen) return UI_CHANGED;
  const owner = await ownerMenuSignal();
  if (owner === false) return NOT_EDITABLE;
  // Owner (or unreadable menu): give a late-rendering link a moment, else the UI moved.
  return (await waitFor(link, owner ? 2000 : 0)) ? 'ok' : UI_CHANGED;
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

// Tell Moxfield's open deck views (this tab and others) that the deck changed so they refetch it
// (LIVE-VERIFY 2026-11-14: an API write alone doesn't update the view). Best effort, never throws.
function notifyDeckChanged(info) {
  try {
    const m = deckSyncMessage(info);
    if (!m || typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(m.channel);
    ch.postMessage(m.message);
    ch.close();
  } catch { /* best effort */ }
}

/**
 * Add/remove mainboard cards of deck `publicId` with ONE request — the same PUT Moxfield's own Bulk
 * Edit "Save" sends (moxfield-edit.bulkEditWrite), carrying the deck's full Bulk Edit text. Call
 * from that deck's view. Never throws. The deck is bound explicitly by `publicId` (no URL reading).
 * Steps: owner check (deck view UI) → fresh deck JSON (version + mainboard count) → fresh Bulk Edit
 * text (GET) → data-loss guard (parsed mainboard text count must equal the deck JSON's) → pure
 * text edit → one PUT → refresh Moxfield's deck view via its own cross-tab sync message.
 * Data-loss guard: bulkGuard (main/side/maybe text counts == deck JSON) and bulkEditBody (all 10
 * boards + pricingProvider present), both fail closed. On success `concurrent: true` flags that the
 * saved version isn't ours + 1, i.e. another save landed in between (the server is last-write-wins).
 * @returns {Promise<{ok:true, concurrent?:boolean} | {ok:false, reason:'not-editable'|'session'|'ui-changed'|'rejected', message?:string}>}
 *   - 'not-editable': no deck id, logged out, not the deck's owner, or Moxfield answered 403.
 *   - 'session':      no captured token, or Moxfield answered 401 (expired token: reload the page).
 *   - 'ui-changed':   a read failed / returned an unknown shape, the counts disagree (refused before
 *                     any write), or the write failed in an unrecognised way.
 *   - 'rejected':     Moxfield refused the text (e.g. unknown card names); `message` is its error.
 *                     Also returned, before any write, when a `remove` name matches no Main Deck line.
 */
export async function applyBulkEdit({ add = [], remove = [], publicId = null } = {}) {
  try {
    if (typeof publicId !== 'string' || !PUBLIC_ID_RE.test(publicId)) return NOT_EDITABLE;
    const access = await editAccess(publicId);
    if (access !== 'ok') return access;
    const deck = await readDeckJson(publicId);
    if (!deck || deck.publicId !== publicId) return UI_CHANGED;
    // bulkEditRead waits briefly for the token relay; still none (null) → 'session', like a 401.
    const read = await bulkEditRead(publicId);
    const readFail = bulkReadOutcome(read);
    if (readFail) return readFail;
    const get = read.json;
    const original = get.boards && get.boards.mainboard;
    if (typeof original !== 'string') return UI_CHANGED;
    // Fail closed: never rewrite texts that don't hold the whole deck.
    if (!bulkGuard(get, deck)) return UI_CHANGED;
    const missing = unmatchedRemovals(original, remove);
    if (missing.length) return { ok: false, reason: 'rejected', message: `Not found in Bulk Edit: ${missing.join(', ')}` };
    const next = editBulkText(original, { add, remove });
    if (next === original) return { ok: true }; // nothing to change: no write
    const body = bulkEditBody(get, next);
    if (!body) return UI_CHANGED;
    const prevVersion = Number.isFinite(deck.version) ? deck.version : null;
    const res = await bulkEditWrite(publicId, body, { version: prevVersion });
    const outcome = bulkEditOutcome(res);
    if (outcome.ok) {
      const saved = res.json.deck;
      const version = saved && Number.isFinite(saved.version) ? saved.version : (prevVersion != null ? prevVersion + 1 : null);
      notifyDeckChanged({ publicId, ownerUserId: (saved && saved.ownerUserId) || deck.ownerUserId, prevVersion, version });
      if (concurrentChange(prevVersion, saved && saved.version)) return { ok: true, concurrent: true };
    }
    return outcome;
  } catch {
    return UI_CHANGED;
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
