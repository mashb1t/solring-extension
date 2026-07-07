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
  (`getDeck`, `importDeck`, `getEnrichment(source, md5)`); responses may carry `{error}` / `{miss}`.
- **`src/sources/`** — worker-only pure fetch+shape helpers: `edhrec.js` (commander page, `json.edhrec.com`, ACAO:\*),
  `edhrec-recs.js` (`edhrec.com/api/recs` cuts, ACAO:\*), `spellbook.js` (`find-my-combos`).
- **`src/cache.js`** — `chrome.storage.local` cache. Prefixes `deck:` / `search:` / `edhrec:` / `sbook:`; TTL-gated
  enrichment (`isFreshTtl`), schema-gated deck data (`isFresh`), `dedupe(key, fn)` for in-flight coalescing.
- **Renderers** — `render-deck.js` (deck report-card panel + tiles), `render-panels.js` (expandable detail panels +
  charts), `render-cards.js` (`annotate()` — per-card Power/Salt/Synergy/Tags/EDHREC% columns on any
  `a.table-deck-row-link` rows, sortable), `render-card-modal.js` + `render-card-sidebar.js` (per-card Info panel in
  Moxfield's card modal / image sidebar), `render-combos.js`, `render-user.js`, `decklist.js` (deck-manager columns).
- **`src/recommendations.js`** — the `/decks/{id}/recommendations` "Cuts" tab + Deck-Preview enhancements (see below).
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
  (`api.commandersalt.com`, `backend.commanderspellbook.com`). EDHREC + `api2.moxfield.com` serve ACAO, so no grant.
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

## Testing & build

- `npm test` → `node --test`. Pure-logic modules (extract, ratings, md5, cache, sources, decklist, prefs, …) are
  unit-tested against `fixtures/`. DOM/render modules are **verified live in a real browser** (load unpacked, reload,
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
- User global rule: commit granularly (Conventional Commits w/ scope), don't push without being asked, stay on
  `develop`, don't commit planning artifacts / `.claude/` / secrets.
