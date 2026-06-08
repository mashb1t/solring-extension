# Design Spec: Solring — Moxfield × CommanderSalt Chrome Extension

_Created via brainstorming — Manuel (mashb1t) + Claude · 2026-06-08_
_Reference prototype: `/Volumes/data/private/mtg/.design/solring-mvp/prototype/{deck,user}.html` (read-only)._
_Reference fixtures: `commandersalt_api.json` (deck) and `tests/fixtures/commandersalt/search_mashb1t.json` (search)._

## Problem

A Commander player browsing Moxfield wants CommanderSalt's verdict on a deck — power, bracket,
commander tier, archetype, saltiness, and the threat/interaction/wincons/synergy report card —
**without leaving Moxfield**. CommanderSalt has the data but lives on a separate, ad-heavy site.

## Solution

A Chrome extension that, on Moxfield pages, fetches the matching CommanderSalt analysis and injects
it inline, styled to **blend into Moxfield's native look**:

- **Deck page** (`/decks/{id}`): a **collapsible** report-card panel below the deck header (default open
  when analyzed/cached, closed when not yet analyzed) — power, baseline/realistic
  bracket, commander tier, saltiness, deck value, archetype, plus the four letter grades (threat,
  interaction, wincons, synergy). **Plus per-card annotations** (salt value, tags, expandable stats)
  inlined into Moxfield's own decklist rows, controlled by toggles added to Moxfield's Customize View.
- **User page** (`/users/{name}`): per-deck metric columns added to the deck table, an averages block
  appended to the profile sidebar, and a per-row expander that loads the full profile on demand.

All data is cached persistently so revisits are instant and offline-tolerant.

## Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | User-page data depth | **Full, on-demand** — search-hit metrics for every row immediately; full per-deck profile/tier/value fetched + cached when a row is expanded (or when its deck page was visited). |
| 2 | Un-indexed decks | **Manual Analyze button** — user-initiated POST import only; never auto-import. |
| 3 | Visual style | **Blend into Moxfield** — native card/badge look, follows Moxfield light/dark, no orange branding. |
| 4 | Link entry | **On-page only** — no popup/input surface; the extension reacts to the current Moxfield page. |
| 5 | Tooling | Vanilla JS, **Manifest V3, no build step** (loads unpacked). |
| 6 | Per-card annotations | Salt value + tags + stats inlined into Moxfield decklist rows; shown in **Text view only**. |
| 7 | "Stats" control | A **per-card expander** (detailed breakdown) **plus a global "toggle all"** to expand/collapse every card at once. |
| 8 | Card-pref persistence | **Global** preference, shared across all decks (`chrome.storage.local`), applied immediately. |
| 9 | CommanderSalt menu link | Injected into Moxfield's external-links menu, **always shown** (not gated on EDHREC / 100-card legality). |
| 10 | Combos | **Deferred** — show combos via Commander Spellbook in a later iteration; not implemented now. |
| 11 | Bulk sync (user page) | Two buttons — **Scan all** (warm indexed + import un-indexed) and **Re-scan all** (re-import all) — over the user's **non-private** decks; throttled, single POST attempt, progress. Last-sync timestamp persisted + shown; Moxfield-style tooltip notes private decks can't be synced. |
| 12 | Syncability | Decided by each deck's **Moxfield visibility**: **Private → excluded**; **Unlisted + Public → syncable** (CommanderSalt can fetch an unlisted deck by URL). |

## Data sources (hard constraint)

The extension is a **pure client**. All data is fetched **directly from the third-party APIs**, never
through the solring backend (`solri.ng`) or any proxy — the extension must work standalone with nothing
of ours deployed.

- **CommanderSalt** — `https://api.commandersalt.com`
  - `GET /decks?id={md5}` — full deck payload.
  - `GET /search?type=decks&authorIndexId={username}` — a user's decks (the **user page hits this** —
    CommanderSalt, *not* solring).
  - `POST /decks?url={moxfieldUrl}` — manual import (the only write).
  - Verified by capturing the live site's own network calls: the CommanderSalt frontend itself calls
    `api.commandersalt.com/decks?id=…` and `api.commandersalt.com/search?…`. These public read endpoints
    respond **anonymously** (no auth token needed; the site's Cognito/Firebase calls are for logged-in
    features we don't use).
- **Commander Spellbook** — direct client calls for combos (roadmap; not implemented now).

`host_permissions` therefore lists `https://api.commandersalt.com/*` (and, when combos land, the Commander
Spellbook API host). **`solri.ng` never appears anywhere in the extension.**

## Architecture

Two halves communicating over `chrome.runtime` messages:

- **Background service worker** (`src/background.js`) — the *only* code that contacts
  `api.commandersalt.com` (declared in `host_permissions`, so its `fetch` bypasses page-origin CORS).
  Message handlers:
  - `getDeck({ md5 })` → cached display-fields or `GET /decks?id={md5}`.
  - `getUserDecks({ username, cursor? })` → cached or `GET /search?type=decks&authorIndexId={username}`.
  - `importDeck({ url })` → `POST /decks?url={url}` (manual, never auto-retried, 20 s timeout).
  Owns all caching, TTL, stale-while-revalidate, and in-flight request de-duplication.

- **Content script** (`src/content.js` + render modules) — runs at `document_idle` on
  `*://*.moxfield.com/*`. Detects page type, survives SPA navigation, requests data by message,
  injects/renders UI. Never fetches cross-origin itself; never throws into Moxfield's page.

**Shared modules** (importable by both contexts):

| Module | Responsibility |
|---|---|
| `src/md5.js` | Vendored MD5 (Web Crypto has no MD5). `deckMd5(canonicalUrl)`. |
| `src/ratings.js` | Grade ladder + per-field ceilings, lifted from the prototype. `csRatingGrade(value, field)`. |
| `src/extract.js` | Raw CommanderSalt payload → small `DeckFields` / `HitFields` objects. Pure, defensive. |
| `src/moxfield.js` | URL parsing/validation: `parseDeckId(url)`, `parseUsername(url)`, `canonicalDeckUrl(id)`. |
| `src/api.js` | Thin `fetch` wrappers (used only by the background worker). |
| `src/cache.js` | `chrome.storage.local` read/write, TTL, SWR, in-flight de-dupe. |
| `src/dom.js` | Idempotent injection helpers (sentinel-guarded). |

## Data flow

### Deck page (`/decks/{publicId}`)

```
parseDeckId(location.href)
  → canonicalDeckUrl = "https://moxfield.com/decks/{publicId}"
  → md5 = deckMd5(canonicalDeckUrl)        // === fixture id 9bc8a6c… for the sample
  → message bg getDeck({ md5 })
       cache hit (fresh)  → return fields           (instant)
       cache hit (stale)  → return fields + revalidate in background
       miss               → GET /decks?id={md5} → extract → cache → return
  → render report-card block below the deck header, inside a COLLAPSIBLE panel
       analyzed / cached  → panel default OPEN, showing the full report card
       stub / un-indexed  → panel default CLOSED; header bar expands to an "Analyze on CommanderSalt" button (manual importDeck)
       isPrivate/isIllegal→ panel default CLOSED; "Private/illegal — can't analyze" note on expand
```

The deck-scores panel sits **below the deck header** and is **collapsible**. Its **default** state is
data-driven: **open** when the deck is already analyzed/cached, **closed** when it isn't yet analyzed
(stub/un-indexed) — so an un-analyzed deck shows only a quiet collapsed header bar until expanded. A
manual toggle is allowed at runtime and is not persisted, so the data-driven default re-applies on each
load.

### User page (`/users/{username}`)

```
parseUsername(location.href)
  → message bg getUserDecks({ username })
       → GET /search?type=decks&authorIndexId={username.toLowerCase()}
       → extract hits (power, bracketRating, salt, synergy, archetype, commander, colors, deckId)
  → inject columns into the deck table (one row per hit; matched by deckId === md5 of the row's deck URL)
  → append averages block to the profile sidebar (ø power / ø bracket / ø saltiness / ø synergy)
  → per-row expander (on demand):
       message bg getDeck({ md5: hit.deckId })
       → fill Thr/Int/Win/Syn profile, commander tier, baseline/realistic bracket, value
       → enrich the threat/interaction/wincons/tier sidebar averages (coverage hint: "from N decks")
  → "load more" → getUserDecks({ username, cursor })
```

**Join key:** search hits expose `deckId` (= the md5), not the Moxfield publicId. Each Moxfield
table row's deck link → `deckMd5(canonicalDeckUrl)` → match against `hit.deckId`. Decks visited as
deck pages share the same `deck:{md5}` cache entry, so they're instant here and contribute to the
full-metric averages.

## Metric mapping

Grades use CommanderSalt's exact client-side algorithm (`ratings.js`): `pct = min(value/ceiling,1)*100`,
then a fixed 12-step ladder (`D–` … `A+`, no `F`).

| Display | Source path | Ceiling | Avail. in search hit? |
|---|---|---|---|
| Power | `powerLevelRating` → `X.X / 10` | — | ✅ (`powerLevelRating`/`displayValue`) |
| Bracket baseline | `details.brackets.wotcBracket` | — | ⚠️ only `bracketRating` (float) |
| Bracket realistic | `details.brackets.csBracket` (↑/↓ arrow vs baseline) | — | ❌ |
| Commander tier | `details.powerLevel.ratings.commanderTier` → `T{n}` | — | ❌ |
| Saltiness | `saltRating` (raw shown alongside grade) | 300 | ✅ |
| Threat | `threatRating` | 500 | ❌ |
| Interaction | `details.powerLevel.scoring.interaction.score` | 400 | ❌ |
| Wincons | `comboRating` | 300 | ❌ |
| Synergy | `synergyRating` | 2500 | ✅ |
| Archetype | `archetypeLabel` (else `archetypeMajor`/`archetypeMinor`) | — | ✅ |
| Deck value | `price.usd` | — | ❌ |

Baseline/realistic use the **real** `wotcBracket`/`csBracket` (both `3` in the fixture). The prototype's
hardcoded "2 realistic" is demo data and is **not** replicated; the up/down arrow is data-driven.

`extract.js` returns:
- `HitFields` (from a search hit): `{ deckId, title, commander, colorIdentity, power, bracketRating, salt, synergy, archetypeMajor, archetypeMinor, isPrivate, isIllegal }`.
- `DeckFields` (from a full payload): the above plus `{ bracketBaseline, bracketRealistic, commanderTier, threat, interaction, wincons, value, fingerprint, reportCard, cards }`.
  - `cards`: a per-card map keyed by normalized card name → `{ salt: number, tags: string[], stats: { …flags }, total: number, scoring?: { power, salt, synergy } }`, derived from each entry in the payload's top-level `cards` object.

## Per-card annotations (deck page, Text view only)

Each card in the payload's `cards` object carries `salt` (string number, e.g. `"5.5"`), `categories.stats`
(boolean flags from a fixed vocabulary — `anthem, boardWipes, burn, cantrip, cheat, combat, costReduction,
counterspell, evasion, fastmana, groupslug, landsmatter, manafixing, multipliers, otherControl,
plusOnePlusOneCounters, ramp, recursion, slow, spotRemoval, stax, stompy, tokens, voltron`), and
`categories.total`. Optional per-card scoring contribution comes from `details.powerLevel.scoring.*.list.{id}`,
`details.salt.scoring.*.list.{id}`, and `details.synergy`.

**Matching:** Moxfield decklist rows are matched to CommanderSalt cards by **normalized card name**
(lowercased, trimmed; double-faced cards match on the front-face name). Unmatched rows simply get no
annotation.

**Three toggles** are injected into Moxfield's **Customize View → Include Extra Data** section, alongside
the native Mana Cost / Price / Set Symbol checkboxes:

| Toggle | Renders per row | Notes |
|---|---|---|
| **Salt Value** | The card's salt as a compact chip, **accent-colored when ≥ 5.0**, muted otherwise. | Default **on**. Mirrors the screenshot styling. |
| **Tags** | The card's true stat-flags as small gray pills, with prettified labels (`multipliers`→"multiplier", `fastmana`→"fast mana", `boardWipes`→"boardwipe", `costReduction`→"cost↓", …). | Default **on**. |
| **Stats** | A small expander (`▸`) on each row revealing a detailed breakdown — full stat-category list + the card's power/salt/synergy contribution. Collapsed by default. | Default **off**. See toggle-all below. |

**Toggle-all:** when **Stats** is enabled, a single **"toggle all"** control (in the decklist header
region) expands/collapses every card's stat panel at once.

**Gating:**
- These annotations render **only when Moxfield's View Style is "Text"** (not Condensed Text / Visual
  Grid / Visual Stacks / Spoiler). The content script reads the current view style and re-evaluates when
  it changes (Customize View save, or DOM mutation).
- They require the full deck payload (already fetched/cached for the report-card block). On a stub/private
  deck, no annotations render.

**Persistence:** a single **global** preference object `prefs:cardData = { saltValue, tags, stats }` in
`chrome.storage.local`, shared across all decks. Changes **apply immediately** on toggle and persist
independently of Moxfield's own Save/Cancel (these are the extension's settings, not Moxfield's per-deck
view state). Defaults: `saltValue: true, tags: true, stats: false`.

## Moxfield UI integration

- **Customize View modal:** a MutationObserver detects the modal opening and injects the three checkboxes
  into the "Include Extra Data" group, styled to match Moxfield's native checkboxes and wired to the global
  prefs. Idempotent (sentinel-guarded) so re-opening doesn't duplicate them.
- **External-links menu — CommanderSalt link:** the extension injects a **"CommanderSalt"** link into the
  deck's tools/links menu, pointing at the deck's CommanderSalt page
  **`https://commandersalt.com/details/deck/{md5}`** (URL form confirmed against the live site). It is
  **always shown** — not gated on the EDHREC link or 100-card legality (alongside EDHREC when present, on
  its own otherwise).

## Bulk sync (user page)

Two controls injected next to the sidebar averages block on the user profile, operating over the user's
**non-private** decks:

- **Scan all** — for each syncable deck: GET + cache if CommanderSalt already has it (skipping entries
  still fresh within TTL); **POST-import** (~5 s) any deck CommanderSalt hasn't indexed yet. Result:
  every syncable deck is cached, so all sidebar averages and per-row profiles are complete.
- **Re-scan all** — **POST re-import** every syncable deck to pull the latest analysis (like the site's
  own Refresh). Heaviest; **confirm-gated**.

**Syncability — driven by Moxfield visibility** (read from each deck row's badge):

| Visibility | Syncable? | Why |
|---|---|---|
| Public | ✅ | Indexed/importable by CommanderSalt. |
| Unlisted | ✅ | Not listed, but CommanderSalt can fetch it by URL. |
| Private | ❌ | CommanderSalt can't read it. |

A **Moxfield-styled info tooltip** sits next to the buttons: *"Private decks can't be synced —
CommanderSalt can't read them."* Private rows are filtered out **before** any request is made.

**Safety / UX:**
- **Sequential + throttled** with a small inter-request delay; a **progress indicator** ("Syncing 4/15…")
  and a **cancel** control.
- Each **POST is attempted once** — never auto-retried (idempotency / ~5 s compute). Per-deck failures
  are listed, not retried.
- A **confirm dialog** precedes Re-scan all (and Scan all when it would import many un-indexed decks).
- **Last-sync timestamp** persisted per username (`sync:{username}` → `{ lastScanAt, lastRescanAt }`) and
  shown near the buttons (e.g. "Last synced 8 Jun 2026, 16:40").

**Deck enumeration:** the user's decks come from the Moxfield profile list joined with CommanderSalt
`/search`, with **visibility taken from the Moxfield row badges**. Enumerating decks beyond the loaded
page (Moxfield paginates) may use Moxfield's own deck API — an implementation-time detail; in all cases
private decks are excluded before any CommanderSalt request.

## Caching

`chrome.storage.local`, **extracted display fields only** (never the ~349 KB raw blob).

- Keys: `deck:{md5}` → `{ fetchedAt, fields }` (now includes the per-card `cards` map); `search:{username}`
  → `{ fetchedAt, hits, cursor }`; `prefs:cardData` → `{ saltValue, tags, stats }` (global, no TTL);
  `sync:{username}` → `{ lastScanAt, lastRescanAt }` (no TTL).
- **TTL** 7 days (configurable constant). **Stale-while-revalidate:** serve cached value immediately,
  refetch in the background when older than TTL.
- **Refresh** affordance per block forces a refetch and rewrites the cache entry.
- **In-flight de-dupe:** concurrent requests for the same key share one Promise.
- Persists across tab close / browser restart by definition. Extracted entries are small (tens of
  numbers + the fingerprint), so the default quota is sufficient; no `unlimitedStorage` needed. A
  simple size cap with oldest-first eviction guards pathological growth.

## SPA / DOM resilience

Moxfield is a React SPA — client-side routing, async-mounted DOM, re-renders that wipe injected nodes.

- **Navigation:** monkey-patch `history.pushState`/`replaceState` + listen for `popstate`; a
  `location.href` poll as a fallback. Each change re-runs the router.
- **Idempotency:** every injected root carries a `data-solring` sentinel; the router is safe to run
  repeatedly and re-mounts only what's missing.
- **Anchoring:** locate the deck header and the user deck table by structure/content, **not** by
  Moxfield's hashed class names.
- **Re-injection:** a `MutationObserver` on the table body re-adds cells React removes on re-render.
- **Motion:** honor `prefers-reduced-motion`; minimal motion regardless.

## Error & edge-case handling

The widget must **never throw into Moxfield's page** and must fail to a quiet, legible state.

| Case | Detection | Behavior |
|---|---|---|
| Not a deck/user URL | `parseDeckId`/`parseUsername` return null | No-op; nothing injected. |
| **Private deck, not owner** (e.g. `UncuYVlqC0y8rbtPCM73SQ`) | Moxfield renders its own private/404 page → no deck header found | Content script stays silent; no broken widget. |
| **Private/illegal deck, owner view** | Payload `isPrivate`/`isIllegal === true` | Specific note: "Private/illegal — CommanderSalt can't analyze it." No Analyze button. |
| Stub (private *or* not indexed, ambiguous) | `name == null` or `_cardCount == 0` | Show **Analyze** button. On click → POST import. |
| Analyze still returns a stub | POST result `is_stub` → `Unanalyzable` | "Couldn't analyze — deck appears private, non-Commander, or illegal." No endless spinner. |
| Not-yet-indexed public deck | stub → Analyze → POST returns full payload | Render normally. |
| Network / 4xx / 5xx / timeout / offline | `fetch` rejects or non-OK | Inline error + **single user-initiated Retry**; serve cache if present. POST is **never** auto-retried. |
| Malformed/partial payload | missing fields | Defensive extraction renders present fields, omits the rest. |

The Analyze POST: manual only, 20 s timeout, ~5 s loading affordance, one explicit retry on failure.

## Styling — blend into Moxfield

- Light-DOM injection with `solring-`-namespaced classes; a single small CSS file (`styles/solring.css`).
- Mirrors Moxfield's native card/badge/table styling and **follows its light/dark theme** (detected via
  Moxfield's theme class/attribute on `<html>`/`<body>`, with a `prefers-color-scheme` fallback).
- No orange branding, no wordmark. Rating color is a restrained accent only (grade-letter color / a
  small dot), always **paired with the letter or label** so meaning never rides on color alone.
- Accessibility: WCAG AA contrast; keyboard-operable expander/refresh/analyze controls with visible
  focus rings; `aria-live` on the analyze/poll status; alt text/labels on pips and images.

## Project layout

```
extension/
  manifest.json                 # MV3: content_scripts on *://*.moxfield.com/*, background SW,
                                #      host_permissions https://api.commandersalt.com/*, storage
  src/
    background.js               # message router; api + cache orchestration
    content.js                  # bootstrap: page-type router, SPA nav hooks
    router.js                   # idempotent inject/teardown per page type
    render-deck.js              # report-card block
    render-user.js              # table columns + sidebar averages + expanders
    sync.js                     # bulk Scan all / Re-scan all (throttled, progress, timestamp)
    render-cards.js             # per-card salt/tags/stats annotations (Text view)
    customize-view.js           # inject Salt Value/Tags/Stats checkboxes into Moxfield's modal
    links-menu.js               # inject CommanderSalt link, gated on EDHREC link
    prefs.js                    # global card-display prefs (chrome.storage.local)
    labels.js                   # stat-flag → prettified tag label map
    api.js  cache.js  extract.js  ratings.js  md5.js  moxfield.js  dom.js
  styles/solring.css
  fixtures/
    deck_ojer.json              # copied from the reference fixtures (read-only sources)
    search_mashb1t.json
  test/
    md5.test.js                 # deckMd5("https://moxfield.com/decks/1OeRLCXjAUC9dNmkw3e_7g") === "9bc8a6c2106583c1fd66e0492a3a5a26"
    extract.test.js             # deck + hit fixtures → expected DeckFields/HitFields, incl. per-card map
    ratings.test.js             # 130.6/300→C+, 197/400→B-, 347.8/300→A+, 1787.3/2500→B+
    labels.test.js              # multipliers→multiplier, fastmana→"fast mana", boardWipes→boardwipe …
```

A `MOCK` flag lets the content script render from the bundled fixtures (no network) for fast UI iteration.

## Testing

- **Unit (Node, no browser):** md5 join key, extraction against both fixtures, grade ladder against the
  values verified in `ratings.js`.
- **Manual load-unpacked checklist:** deck page (indexed), un-indexed deck (Analyze flow), private deck
  (silent + owner-view note), user page (columns + averages + expander + load more), SPA navigation
  deck→user→deck, light/dark theme, offline (cache), refresh, **per-card salt/tags/stats in Text view
  (and their absence in other views), Customize View checkboxes persist globally, toggle-all stats, and
  the CommanderSalt link always appearing**, and **Scan all / Re-scan all over non-private decks
  (private excluded with tooltip, progress, last-sync timestamp persisted)**.

## Assumptions to confirm at implementation time

1. Moxfield's user deck list is a real `<table>` (injection adapts to a flex/grid list otherwise).
2. CommanderSalt search hits do not include threat/interaction/wincons/tier/value (confirmed against
   `search_mashb1t.json`); full payloads are required for those.
3. Threat/interaction/wincons/tier sidebar averages are **partial** under on-demand — averaged over the
   decks opened so far, with a coverage hint. (Alternative: hide until all loaded — not chosen.)
4. Moxfield's Customize View modal exposes an "Include Extra Data" group we can append checkboxes to; the
   current View Style is detectable from the DOM; the EDHREC external link is detectable in the deck's
   links menu; and each deck row's **visibility (Public/Unlisted/Private) is readable** from its badge.
   All confirmed against the live DOM at implementation time (anchored by content, not hashed class names).
5. CommanderSalt cards match Moxfield rows by normalized name. (Deck-page URL form `/details/deck/{md5}`
   and API hosts/paths are already confirmed against the live site — see Data sources.)

## Roadmap (not implemented now)

- **Combos via Commander Spellbook** — a combos panel/section on the deck page (this deck can do / one
  card away), sourced from Commander Spellbook. Deferred to a later iteration.

## Out of scope

- Popup/options input surface (link entry is on-page only).
- Non-Moxfield deck sources; EDHREC/Spellbook synergy & "cards to add" panels from the prototype.
- Orange Solring branding / standalone site chrome.
- Account/auth-gated private deck access.
