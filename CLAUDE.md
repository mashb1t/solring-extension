# Solring — developer / agent guide

Chromium MV3 extension that injects **CommanderSalt**, **EDHREC**, and **Commander Spellbook** data into
**Moxfield**. Vanilla JS, ES modules, **no bundler / no build step for the code** (see Build below). Never routes
through any Solring backend — all data is fetched straight from the third-party APIs.

## Architecture

- **`src/content.js`** — classic bootstrap injected on `https://*.moxfield.com/*`. Dynamically imports the ES-module
  logic, detects the page type via `moxfield.js`, and re-dispatches on Moxfield's SPA navigation (Navigation API
  `currententrychange`, popstate, 1 s href poll fallback; `solring:rebuild` re-mounts the build view). Every pass is
  idempotent and guarded; `dom.disposeAll()` tears down the previous route's observers/listeners first.
- **`src/background.js`** — the **only** code that fetches `api.commandersalt.com` / `backend.commanderspellbook.com`
  (both need `host_permissions` — neither serves CORS). Content scripts talk to it via `messaging.js`
  (`getDeck`, `importDeck`, `getEnrichment(source, md5)`, `getRecs`, `getBuildData` ops `themes`/`theme`/`byTheme`/`byCard`/`combos`,
  `getCardData` ops `search`/`info`/`flags`); responses may carry `{error}` / `{miss}`.
- **`src/sources/`** — fetch+shape helpers: `edhrec.js` (commander page, `json.edhrec.com`, ACAO:\*),
  `edhrec-recs.js` (`edhrec.com/api/recs` cuts, no ACAO → `getRecs` message), `spellbook.js` (`find-my-combos`),
  `edhrec-build.js` (deck-builder theme/commander pages, `json.edhrec.com`), `scryfall.js` (`api.scryfall.com` card info + flag lists).
  The `fetch*` functions are worker-only; the pure, fetch-free exports are shared with content code: `edhrec-recs.cutRecs`,
  `spellbook.spellbookComboUrl` / `keyCombos`, `scryfall.frontFace`, `edhrec.BASICS`. Keep those free of `fetch`/`chrome`.
- **Builder data** — `getBuildData` / `getCardData` take `fresh:true` (the builder header's ↻ reload): skip the TTL,
  overwrite the entry, fall back to the cached copy if the fetch fails. `scry:` entries missing a newly kept field
  (`eur`, `oracle`) are refetched once. Scryfall `/cards/collection` is queried by **front face** (full "A // B" names
  miss); `{notFound:true, v:2}` entries are trusted, older not-found entries are refetched.
- **Bracket flag lists** (`scry:flags`, `scryfall.fetchFlagSets`) — base lists `gameChangers` (`is:gamechanger`),
  `extraTurns`, `massLandDenial` are all-or-nothing (any failure → none cached → stale copy or the "checks unavailable"
  chip). Optional lists `tutors` (`otag:tutor -otag:tutor-land`) and `stax` (`otag:rule-of-law or otag:cost-increaser`;
  `otag:stax` doesn't exist) fail on their own → `null`; a 404 `not_found` search is an empty list. Stored as `v:2`
  (`flagsEntry`); `flagsNeedFetch` refetches pre-v2 once, and a v2 entry with a failed optional (`optFailedAt`) at most
  daily. `builder-view.flagsAvailable(res, rules)` requires only the lists active rules need (effective `tutorCap` → tutors,
  `noStax` → stax; `noLandHate` uses the base MLD list), so a null optional only blocks its own rule's Auto-complete.
- **Builder rules** — `tutorCap`, `noLandHate`, `noStax` on top of bracket / GC cap / power / budget. **Bracket presets**
  (`BRACKET_PRESETS`: GC 0/0/3/–/–, no MLD at B1–3, tutor cap 1/3 at B1/B2): `gameChangerCap` / `tutorCap` / `noLandHate`
  stored `null` = follow the current bracket's preset, a value = override; `effectiveRules(rawRules)` is the one merge
  (makeCtx keeps it as `ctx.eff`; never feed it its own output). Rules carry `v:2`; `migrateRules` reads an unversioned
  `noLandHate:false` (old default "off") as `null`. The GC cap is clamped to the bracket (`clampGcCap`); tutor overrides aren't.
  Extra turns stay blocked at B1–3 (not overridable). `tutorCap: -1` (`TUTORS_NO_LIMIT`, JSON-safe; typed "no limit" /
  "none" / "∞") = no cap by the user's choice. `parseRulesForm` stores an override equal to the bracket's preset as `null`.
  A missing tutors list only pauses Auto-complete for a USER cap; a preset cap goes unchecked with a warning chip.
- **Builder cuts** — over 100 cards, the build view shows EDHREC cuts: `getRecs` from content code + `cutRecs`, cached per
  card list in the module-level `cutsCache` (failures evicted); `cleanupCuts` skips commanders and multi-copy lines. Option `cutsPositiveOnly` (default on, live) hides
  cuts with EDHREC score ≤ 0 / missing via `edhrec-recs.positiveCuts`, in the builder (before the over+5 cap) and the Cuts tab. `src/land-formula.js` (pure, tested): TCGplayer land-formula target (option
  `landFormula`), article rules verbatim; land/spell MDFCs are partial lands, never cheap spells.
- **Picker** — commander rows use `cardPopAttrs` (shared `.solring-cardpop`, `data-pop="left"` of the dialog); the
  playstyle ⓘ popover is built-in text only (`picker-logic.themeHelp`: `THEME_HELP`, a typal line, a fallback), no
  network (EDHREC tag `description`s are empty upstream). `teardownPicker` / the observer clean both up.
- **`src/cache.js`** — `chrome.storage.local` cache. Prefixes `deck:` / `search:` / `edhrec:` / `sbook:` / `ebuild:` / `scry:` (disposable; cleared with the cache;
  shaped data only — `ebuild:<op>:<path>` holds the shaped EDHREC result, never the raw page; `scry:flags` is served stale on a failed refresh). `build:` (per-deck builder
  playstyle/rules + pending handoff) is **user state**, NOT in `isCacheKey`, never cleared with the cache. TTL-gated
  enrichment (`isFreshTtl`), schema-gated deck data (`isFresh`), `dedupe(key, fn)` for in-flight coalescing.
- **Renderers** — `render-deck.js` (deck report-card panel + tiles), `render-panels.js` (expandable detail panels +
  charts), `render-cards.js` (`annotate()` — per-card Power/Salt/Synergy/Tags/EDHREC% columns on any
  `a.table-deck-row-link` rows, sortable), `render-card-modal.js` + `render-card-sidebar.js` (per-card Info panel in
  Moxfield's card modal / image sidebar), `render-combos.js`, `render-user.js`, `decklist.js` (deck-manager columns).
- **`src/recommendations.js`** — the `/decks/{id}/recommendations` "Cuts" tab + Deck-Preview enhancements (see below).
- **Combo breakers** — `combo-breakers.js` (pure, tested): `comboBreakers(results, deckNames)` maps each card to the
  complete (`included`) Spellbook combos it is a piece of. `combo-breaker-ui.js` = the red ⓘ badge + popover and the
  "Removing X breaks N combo(s) … Remove anyway?" confirm, used by the Cuts tab's last-copy `−` and the builder's cut
  tiles. Off (no badge, no confirm) when `sources.spellbook === false`.
- **Guided Deck Builder** — pure: `build-rules.js`, `build-rank.js`, `autocomplete.js`, `build-store.js` (`build:` state),
  `builder-view.js`, `picker-logic.js`. `moxfield-ui.js` = builder card writes via Moxfield's Bulk Edit API request
  (`applyBulkEdit`) + Moxfield's **own** New-deck / Change Commander dialogs. `moxfield-collection.js` = read-only collection GET. `render-picker.js` = "✨ Find with Solring" in the Create New
  Deck dialog + "Pick a Commander" alert on commander-less decks. `render-builder.js` = the build view on Commander decks.
  `pricing.js` = prices in the user's Moxfield provider (Bulk Edit GET `pricingProvider`, cached as `build:pricingProvider`,
  else TCGplayer): deck cards from the v3 deck JSON's provider key, suggestions from Scryfall `usd`/`eur`/`tix` (same-currency
  stand-in, eur for EUR stores else usd, marked approx., for providers Scryfall lacks); `info[key].price` + a `pricing` ctx
  drive every budget text. A saved budget is a bare number shown in the current currency: no conversion. Budget covers commander + mainboard (Moxfield's footer total also adds the sideboard).
- **`src/moxfield-token.js`** — **MAIN-world** content script; captures Moxfield's bearer token off its own
  requests and relays it via `postMessage` (memory-only). **`src/moxfield-edit.js`** — deck read (`readDeck`, cookie
  GET; `readDeckJson`/`readDeckAny` with token fallback) + edits (`setCardQuantity` = `PUT …/cards/{board}/{cardId}`,
  `removeCard` = `DELETE …/{cardId}`, `bulkEditWrite` = `PUT /v3/decks/{publicId}/bulk-edit`).

## Conventions

- **Fail-silent**: every third-party fetch is wrapped; failures return `null`/`{miss}` and the UI degrades to nothing,
  never throws into Moxfield's page. Async renders re-check `parseDeckId(location.href)` + `node.isConnected` (stale
  guard) before touching the DOM.
- **Idempotent + disposable**: injectors check for their own marker before adding; observers/listeners register via
  `dom.registerDisposable()` so the router can drain them on nav.
- **CORS drives `host_permissions`**: only hosts that DON'T serve permissive CORS are declared
  (`api.commandersalt.com`, `backend.commanderspellbook.com`, `edhrec.com` for the recs POST). `json.edhrec.com`,
  `api.scryfall.com` + `api2.moxfield.com` serve ACAO, so no grant.
- **Settings**: `OPTIONS_DEFAULT` in `prefs.js` ↔ `options.html`/`options.js`. Colour tokens are applied on every route
  by `option-colors.js`; feature on/off switches apply live via the diffing
  `watchFeatureToggles` listener in `content.js` (builder/picker both ways; Cuts and EDHREC-on-the-reco-page only when
  turned off — turning them back on needs a reload). Default states (`deckPanelDefault`, `builderPanelDefault`) apply on
  the next load. Each installer also checks its own gate. The Options "wide" checkbox IS `prefs:wide` (same key as the
  page's wide toggle), not an `OPTIONS_DEFAULT` field.
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

Builder card writes send ONE request per write — the same `PUT https://api2.moxfield.com/v3/decks/{publicId}/bulk-edit`
Moxfield's own Bulk Edit "Save" sends, with the deck's full Bulk Edit text (`moxfield-ui.applyBulkEdit` →
`moxfield-edit.bulkEditRead`/`bulkEditWrite`; result `{ok, concurrent?}` or `{ok:false, reason}` with `not-editable` (403 /
not the owner) | `session` (no token or 401 → "reload the page" toast) | `ui-changed` | `rejected`).
This is a **token write** (user-accepted 2026-11-14), scoped to that one endpoint (URL/method fixed, public id validated,
`redirect:'error'`, token never logged). Flow: owner check (`editAccess`) → fresh deck JSON → fresh Bulk Edit GET text →
`bulkGuard` (main/side/maybe text counts == deck JSON via `countsAgree`, fails closed) → `editBulkText` → `bulkEditBody`
(requires all 10 `BULK_BOARDS` texts + `pricingProvider`; other boards passed through unchanged) → PUT →
`bulkEditOutcome`. Unknown card names come back as **HTTP 200** `isSuccessful:false` (→ `rejected`). The server is
last-write-wins (no version check): if the saved `deck.version` isn't ours + 1 (`concurrentChange`), the builder shows
"This deck changed elsewhere just now — please check it". The owner check is bound to `a[href="/decks/{id}/edit"]`. After a save, `deckSyncMessage` is posted on Moxfield's
own BroadcastChannel `moxfield-sync-{ownerUserId}` (`isTruncated:true`) so its deck view refetches in place. Creating a
deck (New-deck dialog pre-fill) and setting the commander (`setCommanderViaBulk`, Change Commander dialog — the Bulk
Edit payload has no commanders board) stay UI-driven; never click Create.
Rules: `checkCard` also blocks the last missing piece of a Spellbook combo above the bracket (`makeCtx({combos})` via
`comboGuards`). Row checkboxes / data loads only on decks you can edit (`moxfield-ui.canEdit`); others lazy-load on expand. `moxfield-edit.authedGet` is a
read-only, api2-only token GET (collection, private-deck and Bulk Edit text reads). All of this sits in the same
ToS-/CWS-sensitive area as above.

## Testing & build

- `npm test` → `node --test`. Pure-logic modules (extract, ratings, md5, cache, sources, decklist, prefs, …) are
  unit-tested against `fixtures/`; builder modules too (build-rules, build-rank, autocomplete, build-store, builder-view,
  picker-logic, edhrec-build, scryfall, moxfield-ui's pure Bulk Edit core (`editBulkText`, `bulkEditBody`,
  `bulkEditOutcome`, `countsAgree`, `deckSyncMessage`), the moxfield-collection shaper). DOM/render modules are **verified live in a real browser** (load unpacked, reload,
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
- Moxfield posts `{kind:'deck', publicId, prevVersion, version, isTruncated:false, boards}` on BroadcastChannel
  `moxfield-sync-{userId}` for its OWN edits (same tab too; LIVE-VERIFY 2026-11-15); the builder listens there to
  refresh on manual edits. Our `applyBulkEdit` post echoes back to that listener, so it's version-gated against the
  deck it holds. Known limit: Moxfield keys the channel by the SESSION user; we use the deck's `ownerUserId` (no cheap
  way to get the session id), so a co-author editing someone else's deck gets neither the refresh nor the view sync.
- Moxfield's deck-edit resources are keyed by **cardId**, not the internal board-entry id (a DELETE by entry id 404s).
- Moxfield dark mode is the `.darkmode` class on html/body, not `[data-bs-theme]` (see `dom.isDark`, `styles/solring.css`).
- The Bulk Edit API request/response + the sync channel (2026-11-14) and the dialog selectors (2026-11-13) are recorded in
  the `LIVE-VERIFY` comment atop `src/moxfield-ui.js`; re-check it when Moxfield changes.
- EDHREC GETs must be simple requests (no custom headers) or the CORS preflight returns 403.
- `readDeck` 404s on private decks; `readDeckAny` falls back to `authedGet`.
- Scryfall returns basics with `usd: null`; the builder prices them at $0 under a budget.
- Moxfield's Bulk Edit text writes DFCs with a **single** " / " (`Front / Back`), not Scryfall's " // "; match both.
- `content.js`'s patched pushState runs in the isolated world and misses Moxfield's own pushState; the Navigation API
  listener is what catches it (live-verified 2026-11-14: panel follows deck→deck moves in ~160 ms). Builder writes no longer navigate, so the build view re-renders in
  place after a write.
- Live testing: Playwright `connectOverCDP` to a manually launched (non-automated) Brave; Cloudflare blocks login in a
  Playwright-launched browser.
- User global rule: commit granularly (Conventional Commits w/ scope), don't push without being asked, stay on
  `develop`, don't commit planning artifacts / `.claude/` / secrets.
