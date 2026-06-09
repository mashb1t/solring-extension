# Solring — Stats for Moxfield

A Manifest V3 Chrome extension that injects [CommanderSalt](https://commandersalt.com)
deck and card metrics into [Moxfield](https://moxfield.com), blended into Moxfield's
own look (light & dark). It shows you power level, bracket, saltiness, archetype, and
per-card stats right where you're building or browsing a deck — no tab-switching.

> Unofficial. Not affiliated with Moxfield or CommanderSalt.

## Features

**On a deck page** (`moxfield.com/decks/…`) — a collapsible "Solring" report card injected into the deck:

- **Power** (`x / 10` rating + the deck's raw total power score)
- **Bracket** (baseline → realistic, with an up/down delta arrow)
- **Commander tier**, **Archetype**, and **Saltiness** (A–D grade)
- Report-card grades for **Threat**, **Interaction**, **Wincons**, **Synergy**
- **Combos** count (Commander Spellbook), expandable to a per-combo list with
  prerequisites, steps, results, and difficulty
- Every metric tile expands an inline detail panel (power pillars, bracket-defining
  cards, salt sources, archetype mix, synergy anchors, interaction breakdown)

**In the decklist (Text view)** — per-card annotations, each toggled from Moxfield's
**Customize View** dialog (Power · Salt Value · Tags · Stats · Combos):

- **Power** and **Salt** columns, placed right after the price; cards that stand out
  (power > 2× the deck average, salt ≥ 5) are highlighted in the accent color
- **Tags**, bracket flags, per-card power/salt breakdowns, and combo membership

**In the card-detail modal** — a per-card "Info" panel in the sidebar listing
saltiness, power contribution (as a share of the deck total), tags, bracket flags,
power/salt breakdowns, and synergy. Updates as you page through cards.

**Elsewhere** — a "CommanderSalt" link in the deck's links row, a manual re-analyze
(↻) button, and a live "synced … ago" timestamp.

## Install (load unpacked)

1. `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Open any Moxfield deck — the Solring panel appears below the header

No build step: the extension runs the source directly.

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
- The ↻ button forces a fresh re-analysis (`POST /decks?url=…&oldDeckId=…`); ordinary
  page loads use the cheap cached `GET /decks?id=…`.

## Privacy & data

- The extension only contacts **`api.commandersalt.com`** (its single host
  permission) — client → CommanderSalt directly, never through any proxy.
- It stores extracted metric fields and your display preferences in
  `chrome.storage.local`. Nothing else is collected or sent.

## Development

```sh
npm test        # node --test — pure-logic unit tests (extract, ratings, md5, …)
```

Pure ES modules, no bundler. The metric extraction, rating ladder, MD5, and Moxfield
URL parsing are unit-tested with `node:test` against JSON fixtures in `fixtures/`;
the DOM-rendering modules are validated in a real browser.

### Layout

```
manifest.json          MV3 manifest
styles/solring.css     all injected styles (themed via Moxfield's --bs-* vars)
src/
  content.js           bootstrap + SPA router
  background.js        service worker: API calls + cache
  api.js               CommanderSalt API wrappers
  cache.js             chrome.storage SWR cache + in-flight dedup
  messaging.js         content ⇄ worker helpers
  md5.js               canonical deck URL + vendored MD5 (the join key)
  moxfield.js          page-type / deck-id parsing
  extract.js           raw CommanderSalt payload → display fields
  ratings.js           A–D grade ladder + per-card power/salt ranking
  labels.js            human-readable category/tag labels
  prefs.js             persisted card-display + sort preferences
  dom.js               idempotent DOM helpers (el, claim, teardown, isDark, …)
  render-deck.js       the deck report-card panel
  render-panels.js     per-metric detail panels
  render-combos.js     the combo list
  render-cards.js      per-card decklist annotations
  render-card-modal.js per-card Info panel in the card-detail modal
  customize-view.js    injects the toggles into Moxfield's Customize View
  links-menu.js        the "CommanderSalt" deck link
test/                  node:test unit tests
fixtures/              sample CommanderSalt payloads used by the tests
```
