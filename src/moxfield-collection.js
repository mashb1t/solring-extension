// Owned cards from the logged-in user's Moxfield collection (read-only).
//
// LIVE-VERIFY 2026-11-13 (Brave, logged in, moxfield.com/collection network tab):
//   GET https://api2.moxfield.com/v1/collections/search?q=+&pageNumber=N&pageSize=P&sortType=cardName&sortDirection=ascending
//   (Moxfield's own page also sends empty setId/deckId/rarity/... params; not needed.)
//   Auth: BEARER TOKEN REQUIRED. A cookie-only GET (credentials:'include') returns 401, so this uses
//   moxfield-edit.js `authedGet` (read-only GET with the captured token; see ToS-adjacent note there).
//   Response: { pageNumber, pageSize, totalResults, totalPages, totalOverall, data: [...] }.
//   One entry per owned PRINTING (not per card): totalResults counts printings, totalOverall counts copies.
//   Name path: data[].card.name (may be a "A // B" DFC full name -> keyed by front face).
//   Moxfield's UI page size is 50; the server caps pageSize at 100 (500 requested -> 100 returned).
import { frontFace } from './sources/scryfall.js';

const BASE = 'https://api2.moxfield.com/v1/collections/search';
const PAGE_SIZE = 100; // server max
const MAX_PAGES = 100; // 10k printings; beyond that we return null rather than a silently partial set
const BATCH = 4;

// One collection page JSON -> { names: lowercased front-face keys, totalPages }.
export function shapeCollectionPage(json) {
  const names = [];
  for (const e of (json && Array.isArray(json.data)) ? json.data : []) {
    const n = e && e.card && e.card.name;
    if (n) names.push(frontFace(n));
  }
  return { names, totalPages: Number(json && json.totalPages) || 0 };
}

const url = (n) => `${BASE}?q=+&pageNumber=${n}&pageSize=${PAGE_SIZE}&sortType=cardName&sortDirection=ascending`;

let memo = null;

// Set of lowercased front-face names the user owns, or null (logged out / any failure).
export function ownedNames() {
  if (!memo) {
    memo = (async () => {
      try {
        const { authedGet } = await import('./moxfield-edit.js'); // lazy: it touches `window` (not Node-testable)
        const out = new Set();
        const first = await authedGet(url(1));
        if (!first) return null;
        const s1 = shapeCollectionPage(first);
        if (s1.totalPages > MAX_PAGES) return null;
        s1.names.forEach((n) => out.add(n));
        for (let p = 2; p <= s1.totalPages; p += BATCH) {
          const nums = Array.from({ length: Math.min(BATCH, s1.totalPages - p + 1) }, (_, i) => p + i);
          const pages = await Promise.all(nums.map((n) => authedGet(url(n))));
          if (pages.some((j) => !j)) return null;
          pages.forEach((j) => shapeCollectionPage(j).names.forEach((n) => out.add(n)));
        }
        return out;
      } catch { return null; }
    })();
    memo.then((v) => { if (v === null) memo = null; }); // don't memoize failures (token may arrive later)
  }
  return memo;
}
