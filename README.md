# Solring - Stats for Moxfield

![Solring header](images/header.png)

Solring is an extension for Chromium-based browsers that injects [CommanderSalt](https://commandersalt.com)
deck and card metrics into [Moxfield](https://moxfield.com), blended into Moxfield's
own look (light & dark). It shows you power level, bracket, saltiness, archetype, and
per-card stats right where you're building or browsing a deck, no tab-switching.

> [!NOTE]
> Unofficial. Not affiliated with Moxfield or CommanderSalt.

## Features

### On a deck page (`moxfield.com/decks/…`)

A collapsible Solring report card is injected into the deck. Each metric is a tile
that expands an inline detail panel:

- **Power** — `x / 10` rating + the deck's raw total power score, with a **cEDH /
  fringe-cEDH** chip when applicable. Expands to: a deck **fingerprint** line
  (tutors · ramp · curve · instant-speed · creatures), the power pillars
  (per-category contributions), and the score drivers in side-by-side columns —
  **Boosts the score**, **Pulls it down**, **Anti-pattern flags**, and
  **Suggestions** (each sorted major → minor). A casual / cEDH lens toggle picks the
  baseline (defaults to the deck's inferred type).
- **Bracket** — baseline → realistic, with an up/down delta arrow. Expands to the
  bracket-defining cards grouped by category (Game Changers, tutors, …), any
  **rule-zero** notes, and three coaching columns: **Why this bracket**, **Drop a
  bracket**, **Push a bracket**.
- **Commander tier**, **Archetype**, and **Saltiness** (A–D grade).
- Report-card grades for **Threat**, **Interaction**, **Wincons**, **Synergy**.
  - **Wincons** expands to the win-condition profile (paths · goal) and combo
    consistency (count · effective lines · redundancy · a 2-/3-/4-card size breakdown).
  - **Synergy** expands to the deck's synergy anchors and hubs, ranked by weight.
- **Combos** count (Commander Spellbook), expandable to the per-combo list —
  fewest-pieces-first, then by score — each with prerequisites, steps, results, and
  difficulty.

Card names throughout the panels (bracket cards, combo pieces, synergy anchors) are
**hoverable**: hovering shows the deck's printing, clicking opens the card.

### In the decklist (Text view)

Per-card annotations, each toggled from Moxfield's **Customize View** dialog:

- **Power** and **Saltiness** columns, placed right after the price; cards that stand
  out (power above a multiple of the deck average, salt at/above a threshold) are
  highlighted in the accent color.
- A **Synergies** column (the card's synergy score, colored when it lands in the
  deck's top percentile), and a **Tags** line (CommanderSalt tags + bracket flags).

Full per-card breakdowns (power/salt pillars, synergy anchors) live in the card-detail
sidebar/modal rather than crowding the rows.

### On deck-list pages (user profile + personal manager)

On a user's profile (`moxfield.com/users/…`) and the personal deck manager, Solring
adds sortable CommanderSalt **metric columns** to the deck table — Commander tier,
Power, Bracket, Manabase, Threat, Saltiness, Interaction, Wincons, Combos, Synergy,
Archetype — plus a per-row re-analyze (↻) action. Grade cells show the raw total on
hover. A toolbar (next to Moxfield's Sort) carries:

- **Stats** — bulk-fetch the listed decks: *Fetch all*, *Fetch uncached*, or
  *Recalculate all* (forces a fresh upstream recompute, confirm-gated). Sequential and
  throttled, with a live progress/last-analyzed label; cancelable.
- **Columns** — pick which metric columns show (and reorder them).

These controls appear only where a deck **table** is shown — never on the image/grid
browse pages (`/decks/public`, `/liked`, `/private`, …).

### In the card-detail modal

A per-card "Info" panel listing saltiness, power contribution (as a share of the deck
total), tags, bracket flags, power/salt breakdowns, and synergy — mirrored onto the
deck page's left card-preview sidebar. Updates as you page through cards.

### Elsewhere

A "CommanderSalt" link in the deck's links row, a manual re-analyze (↻) button, a
live "synced … ago" timestamp, and a wide / normal layout toggle in the header.

## Enabling / disabling per-card data

The per-card columns are toggled from **Moxfield's own "Customize View" dialog** (on a
deck page, open the decklist's view settings). Solring adds its checkboxes to the
**Include Extra Data** group, next to Moxfield's Mana Cost / Price / Set Symbol:

| Toggle         | Default | Shows on each card                            |
|----------------|---------|-----------------------------------------------|
| **Power**      | on      | power-contribution column                     |
| **Saltiness**  | on      | saltiness column                              |
| **Synergies**  | off     | synergy score (colored when top-percentile)   |
| **Tags**       | off     | CommanderSalt tags (tutor, ramp, …) + flags   |

Tick or untick any of them, changes apply **immediately**, persist across sessions
(`chrome.storage.local`), and sync to other open Moxfield tabs.

These annotations only show in a **text-row layout** (the *Text* / *Condensed* views).
The *Visual* view has no rows to annotate. The deck report card and the card-modal
panel are always shown.

## Options

The extension's options page (`chrome://extensions` → Solring → *Extension options*):

- **Analysis** — auto-fetch uncached / edited decks on page load, and how long a
  cached analysis stays fresh before it's re-fetched (1 / 3 / 7 / 30 days / never).
- **Marks – standout cards** — the thresholds and highlight colors for the per-card
  marks: power (× deck average), saltiness (static value), synergy (deck percentile).
- **Rating colors** — the A–D grade colors.
- **Panels** — whether the card panel shows in the modal and/or the sidebar, the deck
  report-card default (auto / always open / always collapsed), and accordion behavior
  (only one metric tile open at a time).

## Install (load unpacked)

1. `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Open any Moxfield deck: the Solring panel appears below the header

For development the extension runs the source directly (no bundler); see **Building &
releasing** below for producing a Chrome Web Store package.

## How it works

- A **content script** ([`src/content.js`](src/content.js)) detects the page type,
  survives Moxfield's SPA navigation, and dispatches to the right renderer. Every
  injection is idempotent and guarded so an exception never breaks Moxfield's page.
- A **background service worker** ([`src/background.js`](src/background.js)) is the
  only code that talks to `api.commandersalt.com`. It applies stale-while-revalidate
  caching, de-dupes in-flight requests, and stores only the small set of extracted
  display fields (never raw payloads) in `chrome.storage.local`.
- Deck ↔ analysis are joined by **`md5(canonical Moxfield deck URL)`**, which is
  CommanderSalt's deck id. (Web Crypto has no MD5, so a small MD5 is vendored.)
- The ↻ button forces a fresh re-analysis (`POST /decks?url=…&oldDeckId=…`), whereas
  ordinary page loads use the cached `GET /decks?id=…`. The deck-list **Stats**
  control runs the same engine in bulk over the rendered rows.

## Privacy & data

- The extension only contacts **`api.commandersalt.com`** (its single host
  permission): client → CommanderSalt directly, never through any proxy.
- It stores extracted metric fields and your display preferences in
  `chrome.storage.local`. Nothing else is collected or sent.

## Development

```sh
npm test        # node --test, pure-logic unit tests (extract, ratings, md5, …)
```

Pure ES modules, no bundler. The metric extraction, rating ladder, MD5, deck-list
engine, and Moxfield URL parsing are unit-tested with `node:test` against JSON
fixtures in `fixtures/`; the DOM-rendering modules are validated in a real browser.

## Building & releasing

```sh
npm run build               # runs tests, then writes dist/solring-v<version>.zip
```

[`scripts/build.mjs`](scripts/build.mjs) packages a Chrome Web Store-ready zip into
`dist/` containing only the runtime files (`manifest.json`, `src/`, `styles/`,
`options.html`, `options.js`) — tests, fixtures, docs, and listing images are left out.
Locally the version comes from `manifest.json`; pass `--version=X.Y.Z` to override.

Releases are driven by **git tags**. Pushing a tag runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which tests, packages
the zip with the tag's version, and attaches it to a GitHub Release:

```sh
git tag v1.2.3 && git push origin v1.2.3   # → builds solring-v1.2.3.zip, creates the Release
```

The committed `manifest.json` / `package.json` versions are just dev placeholders; the
tag is the source of truth for a published build. Download the zip from the Release and
upload it in the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole)
(publishing is manual — no store credentials live in CI).

> [!NOTE]
> Before the first store submission, add an extension icon (`icons` in the manifest,
> e.g. 16/48/128 px) — the manifest currently declares none.

