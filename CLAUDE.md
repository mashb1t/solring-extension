# Solring — developer / agent guide

Chromium MV3 extension that injects **CommanderSalt**, **EDHREC**, and **Commander Spellbook** data into
**Moxfield**. Vanilla JS, ES modules, **no bundler / no build step for the code** (see Build below). Never routes
through any Solring backend — all data is fetched straight from the third-party APIs.

## Architecture

- **`src/content.js`** — classic bootstrap injected on `https://*.moxfield.com/*`. Dynamically imports the ES-module
  logic, detects the page type via `moxfield.js`, and re-dispatches on Moxfield's SPA navigation. Every pass is
  idempotent and guarded; `dom.disposeAll()` tears down the previous route's observers/listeners first.
- **`src/background.js`** — the **only** code that fetches `api.commandersalt.com` / `backend.commanderspellbook.com`
  (both need `host_permissions` — neither serves CORS). Content scripts talk to it via `messaging.js`
  (`getDeck`, `importDeck`, `getEnrichment(source, md5)`, `getRecs`, `getBuildData` ops `themes`/`theme`/`byTheme`/`byCard`/`combos`,
  `getCardData` ops `search`/`info`/`flags`); responses may carry `{error}` / `{miss}`.
- **`src/sources/`** — worker-only pure fetch+shape helpers: `edhrec.js` (commander page, `json.edhrec.com`, ACAO:\*),
  `edhrec-recs.js` (`edhrec.com/api/recs` cuts, no ACAO → `getRecs` message), `spellbook.js` (`find-my-combos`),
  `edhrec-build.js` (deck-builder theme/commander pages, `json.edhrec.com`), `scryfall.js` (`api.scryfall.com` card info + flag lists).
- **`src/cache.js`** — `chrome.storage.local` cache. Prefixes `deck:` / `search:` / `edhrec:` / `sbook:` / `ebuild:` / `scry:` (disposable; cleared with the cache). `build:` (per-deck builder
  playstyle/rules + pending handoff) is **user state**, NOT in `isCacheKey`, never cleared with the cache. TTL-gated
  enrichment (`isFreshTtl`), schema-gated deck data (`isFresh`), `dedupe(key, fn)` for in-flight coalescing.
- **Renderers** — `render-deck.js` (deck report-card panel + tiles), `render-panels.js` (expandable detail panels +
  charts), `render-cards.js` (`annotate()` — per-card Power/Salt/Synergy/Tags/EDHREC% columns on any
  `a.table-deck-row-link` rows, sortable), `render-card-modal.js` + `render-card-sidebar.js` (per-card Info panel in
  Moxfield's card modal / image sidebar), `render-combos.js`, `render-user.js`, `decklist.js` (deck-manager columns).
- **`src/recommendations.js`** — the `/decks/{id}/recommendations` "Cuts" tab + Deck-Preview enhancements (see below).
- **Guided Deck Builder** — pure: `build-rules.js`, `build-rank.js`, `autocomplete.js`, `build-store.js` (`build:` state),
  `builder-view.js`, `picker-logic.js`. `moxfield-ui.js` drives Moxfield's **own** Bulk Edit + New-deck dialog (never API
  writes). `moxfield-collection.js` = read-only collection GET. `render-picker.js` = "✨ Find with Solring" in the Create New
  Deck dialog + "Pick a Commander" alert on commander-less decks. `render-builder.js` = the build view on Commander decks.
- **`src/moxfield-token.js`** — **MAIN-world** content script; captures Moxfield's bearer token off its own
  requests and relays it via `postMessage` (memory-only). **`src/moxfield-edit.js`** — deck read (`readDeck`, cookie
  GET) + edits (`setCardQuantity` = `PUT …/cards/{board}/{cardId}`, `removeCard` = `DELETE …/{cardId}`).

## Conventions

- **Fail-silent**: every third-party fetch is wrapped; failures return `null`/`{miss}` and the UI degrades to nothing,
  never throws into Moxfield's page. Async renders re-check `parseDeckId(location.href)` + `node.isConnected` (stale
  guard) before touching the DOM.
- **Idempotent + disposable**: injectors check for their own marker before adding; observers/listeners register via
  `dom.registerDisposable()` so the router can drain them on nav.
- **CORS drives `host_permissions`**: only hosts that DON'T serve permissive CORS are declared
  (`api.commandersalt.com`, `backend.commanderspellbook.com`, `edhrec.com` for the recs POST). `json.edhrec.com`,
  `api.scryfall.com` + `api2.moxfield.com` serve ACAO, so no grant.
- All third-party text goes in via `textContent` / `el(...)`, never `innerHTML`.
- `el(tag, {class, text, attrs}, children)` from `dom.js` is the DOM builder. Numbers are formatted via `format.js`
  (`num`, `exact`); identifiers humanized via `labels.js`.

## Recommendations page (`recommendations.js`)

Clones a live Moxfield recommendation card per cut for identical styling. Ranking toggle: **Deck-fit** (CommanderSalt
power + synergy, normalized, weakest first) vs **EDHREC popularity** (`outRecs`). The `−` edits the deck directly via
`moxfield-edit.js` (`PUT` decremented quantity for >1 copies, `DELETE` for the last); toast reuses Moxfield's
`.autosave-notification` class. The Deck Preview reuses `render-cards.annotate`, `installCardSidebar`,
`installCardModal`, and `installCustomizeViewToggles` to mirror the deck view. **Note:** the token-interception +
`api2.moxfield.com` writes are the ToS-adjacent / CWS-review-sensitive part — treat changes there carefully.

## Guided Deck Builder writes

The builder writes ONLY through Moxfield's own Bulk Edit UI (`moxfield-ui.applyBulkEdit`, result `{ok}` or `{ok:false, reason}`
with reason `not-editable` | `ui-changed` | `rejected`); there are no builder API writes. `moxfield-edit.authedGet` is a
read-only, api2-only token GET (collection + private-deck reads). Both sit in the same ToS-/CWS-sensitive area as above.

## Testing & build

- `npm test` → `node --test`. Pure-logic modules (extract, ratings, md5, cache, sources, decklist, prefs, …) are
  unit-tested against `fixtures/`; builder modules too (build-rules, build-rank, autocomplete, build-store, builder-view,
  picker-logic, edhrec-build, scryfall, `editBulkText` in moxfield-ui, the moxfield-collection shaper). DOM/render modules are **verified live in a real browser** (load unpacked, reload,
  open a Moxfield deck) — there are no DOM unit tests, so exercise UI changes in-browser.
- `npm run build` (`node scripts/build.mjs`) runs tests then writes `dist/solring-v<version>.zip`. Version lives in
  `manifest.json`; git tags `vX.Y.Z` trigger the release workflow.

## Gotchas

- `moxfield.parseDeckId` is anchored on `/decks/{id}$`, so it rejects the `/recommendations` suffix — the reco page is
  NOT pageType `deck`; `recommendations.js` extracts the id itself.
- Moxfield's card modal is internal React state (no URL change) — can't be opened for an injected card; the reco tab
  clicks the matching row inside the Deck Preview to open it.
- Card art: `card-{id}` works for normal/adventure/split; only `transform`/`modal_dfc` fronts need
  `card-face-{frontFaceId}` (drives the DFC image + flip button).
- Moxfield's deck-edit resources are keyed by **cardId**, not the internal board-entry id (a DELETE by entry id 404s).
- Moxfield dark mode is the `.darkmode` class on html/body, not `[data-bs-theme]` (see `dom.isDark`, `styles/solring.css`).
- Bulk Edit / dialog selectors are recorded in the `LIVE-VERIFY` comment atop `src/moxfield-ui.js`; re-check it when Moxfield's UI shifts.
- EDHREC GETs must be simple requests (no custom headers) or the CORS preflight returns 403.
- `readDeck` 404s on private decks; `readDeckAny` falls back to `authedGet`.
- Scryfall returns basics with `usd: null`; the builder prices them at $0 under a budget.
- `content.js`'s nav hook (patched pushState) runs in the isolated world and misses Moxfield's own pushState; only the 1 s URL
  poll catches route changes, so the build view self-remounts after writes.
- Live testing: Playwright `connectOverCDP` to a manually launched (non-automated) Brave; Cloudflare blocks login in a
  Playwright-launched browser.
- User global rule: commit granularly (Conventional Commits w/ scope), don't push without being asked, stay on
  `develop`, don't commit planning artifacts / `.claude/` / secrets.
