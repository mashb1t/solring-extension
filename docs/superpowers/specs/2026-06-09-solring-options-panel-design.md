# Solring Options Panel — Design

**Date:** 2026-06-09
**Status:** approved for planning

## Goal

Give Solring a settings surface so users can control fetch behavior, the
colors/thresholds used to mark standout cards, the rating-grade colors, which
injected panels appear, the deck report-card's default state, and cached-data
lifetime/cleanup — instead of those being hardcoded constants.

## Surface & storage

- **Options page.** A dedicated extension options page (`options.html` + `options.js`),
  registered in the manifest with `"options_ui": { "page": "options.html", "open_in_tab": true }`.
  Reuses `styles/solring.css` (plus a little page-specific CSS). Reachable via
  `chrome://extensions → Details → Extension options` or right-clicking the entry.
- **One storage key.** All settings live under `prefs:options` in `chrome.storage.local`,
  beside the existing `prefs:cardData` / `prefs:sort`. `prefs.js` gains
  `getOptions()` / `setOptions(patch)` and extends `onPrefChange(cb)` to fire
  `cb('options')`, so every open Moxfield tab re-applies settings live.

### Options model + defaults

```js
const OPTIONS_DEFAULT = {
  autoFetch: true,             // GET uncached/stale + POST re-analyze edited decks; off = cached only
  powerThreshold: 2,           // mark power above N× the deck average
  powerColor: null,            // null = default (accent); else "#rrggbb"
  saltThreshold: 5,            // mark saltiness at/above N (absolute)
  saltColor: null,             // null = default (accent); else "#rrggbb"
  ratingColors: { a: null, b: null, c: null, d: null }, // null = current auto-themed ramp
  cardPanelModal: true,        // Info panel on the card-detail modal
  cardPanelSidebar: true,      // Info panel mirrored on the deck-page sidebar
  deckPanelDefault: 'auto',    // 'auto' | 'open' | 'collapsed'
  cacheLifetimeDays: 7,        // staleness window; 0 = never expire
};
```

`null` colors mean "not customized" — the CSS keeps today's auto-themed values. A set
color is a single hex value used in **both** light and dark.

## Color model

Two independent systems, surfaced as CSS custom properties set on `:root` by the
content script (only when customized):

- **A–D rating colors** (`--solring-rating-a…d`) — used **only** by the deck panel's
  letter-grade chips (Saltiness / Threat / Interaction / Wincons / Synergy). Default:
  current ramp (red→green, brighter on dark).
- **Threshold marks** — `--solring-mark-power` / `--solring-mark-salt` (default
  `var(--solring-accent)`). A per-card **power** value is colored with the power mark
  color when it exceeds `powerThreshold × deck-average`; a **saltiness** value is
  colored with the salt mark color when it is `≥ saltThreshold`. Applies to the
  decklist columns and the modal + sidebar tiles.

Consequence (accepted): the modal/sidebar **Saltiness** tile becomes a binary mark
(salt color when salty, plain otherwise) rather than the current green→red A–D
gradient — consistent with the decklist column. The A–D ramp is reserved for the
deck-level grade chips.

## Auto-fetch behavior

`extractDeck` gains **`analyzedAt`** = `ingestDate.ingestDate` (epoch ms — when
CommanderSalt last analyzed the deck).

`getDeck` (background + `messaging.js`) takes `{ allowFetch, maxAgeMs }`:

- cached **and** fresh (age < `maxAgeMs`, or `maxAgeMs` falsy) → return cached.
- not cached → `allowFetch` ? `GET` + cache : `{ miss: true }`.
- cached but stale → `allowFetch` ? `GET` + cache : return cached with `{ stale: true }`.

On the **deck page**, the content script additionally reads Moxfield's absolute
"last updated" timestamp and, **when `autoFetch` is on**, applies the edit-detection
step after `getDeck` resolves:

- if `moxfieldLastUpdated > fields.analyzedAt` → the deck was edited since CommanderSalt
  analyzed it (a GET would return stale analysis) → **`POST` re-analyze**
  (`importDeck(canonicalUrl, md5, md5)`), then render the fresh result.

So with `autoFetch` **on**: uncached → GET; edited-since-analysis → POST re-analyze;
lifetime-stale (unchanged deck) → cheap GET refresh; otherwise → cache. With
`autoFetch` **off**: cached only — a miss shows the manual *Analyze* button, and a
stale/edited deck shows its cached values with the "synced … ago" age (the ↻ button
remains the manual recompute).

**Guards / scope:**
- At most **one auto-POST per deck per page view** (no loops); the ↻ button is the
  manual escape hatch.
- **Graceful degradation:** if Moxfield's absolute timestamp isn't reachable from the
  DOM, skip only the edit-detection POST — GET/lifetime behavior still works. (Read
  it from the deck header's relative-time element `title`/`<time datetime>`; confirm
  against the live DOM at implementation time; a MAIN-world read of Moxfield's deck
  state is the fallback.)
- **Deck page only.** Deck-list surfaces (Phase 5) would need per-row last-updated to
  do edit-detection there — deferred to that phase.

## Cache lifetime & clear

- **Lifetime** = staleness window (`cacheLifetimeDays`, default 7; `0` = never). Feeds
  `getDeck`'s `maxAgeMs`, the "synced … ago" staleness, and `/search` freshness.
- **Clear cached data.** The options page shows the total size of cached analyses and a
  Clear button:
  - **Size:** a `cacheStats` background message sums the bytes of `deck:*` + `search:*`
    entries (`chrome.storage.local.getBytesInUse` over those keys), shown in KB.
  - **Clear:** a `clearCache` background message removes the `deck:*` + `search:*` keys
    only — preferences (`prefs:*`) and per-user sync timestamps (`sync:*`) are kept.

## Panels & default state

- **Card Info panel — card-detail page** (`cardPanelModal`): when off, `installCardModal`
  does not inject (and removes any existing panel on toggle-off).
- **Card Info panel — deck page** (`cardPanelSidebar`): same for `installCardSidebar`.
- **Deck report-card default state** (`deckPanelDefault`): `auto` = open when analyzed /
  closed when not (current); `open` = always start open; `collapsed` = always start
  closed. This sets only the initial state — the user can still toggle the panel.

## Architecture & components

- **`options.html` / `options.js`** (new) — the settings form: native `<input type=color>`
  pickers, number inputs (with units), selects, checkboxes, the cache-size readout, and
  the Clear button. Reads/writes `prefs:options` via `prefs.js`; queries `cacheStats` /
  `clearCache` via `messaging.js`.
- **`prefs.js`** — `getOptions`/`setOptions`; `onPrefChange` emits `'options'`.
- **`ratings.js`** — `powerTier(power, avg, mult)` and the salt mark check take the
  threshold as a parameter (defaults preserve current values, so existing tests pass);
  stays pure.
- **`extract.js`** — add `analyzedAt` (`ingestDate.ingestDate`).
- **`background.js` / `cache.js` / `messaging.js`** — `getDeck({allowFetch, maxAgeMs})`;
  add `cacheStats` and `clearCache` handlers.
- **`content.js` / `render-deck.js`** — load options on mount + subscribe to `'options'`;
  apply custom CSS vars on `:root`; pass `allowFetch`/`maxAgeMs` to `getDeck`; do the
  Moxfield-lastUpdated read + edit-detection POST; honor `deckPanelDefault`; gate the
  panel installs on `cardPanelModal`/`cardPanelSidebar`.
- **`render-cards.js` / `render-card-modal.js` / `render-card-sidebar.js`** — use the
  configured thresholds for marks and the `--solring-mark-*` colors.
- **`styles/solring.css`** — `--solring-mark-power`/`--solring-mark-salt` (default to
  accent); decklist + tile marks reference them.

## Error handling & edge cases

- Missing/invalid stored options → fall back to `OPTIONS_DEFAULT` (merge over defaults).
- `analyzedAt` or Moxfield timestamp missing → skip edit-detection (no POST); behaviors
  otherwise unchanged.
- Auto-POST failure (network/unanalyzable) → keep showing the cached values; never loop.
- Clearing the cache while a deck page is open → panels fall back to "not analyzed"
  (auto-fetch on re-fetches on next view/navigation).

## Testing

- **Unit (`node:test`):** `ratings.js` threshold parameters (power multiple, salt cutoff)
  with explicit assertions; `extract.js` `analyzedAt`; `prefs.js` options defaults/merge.
- **Browser-validated:** the options page round-trip (set → Moxfield tab re-renders),
  color-var application, auto-fetch on/off + edit-detection POST, panel toggles, deck
  default state, cache size/clear.

## Out of scope (now)

- Deck-list (user-profile / personal) auto-fetch + edit-detection → Phase 5.
- Per-light/dark custom color pairs (single value each was chosen).
- A toolbar popup (options page only).
