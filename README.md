# Solring - Stats for Moxfield

![Solring header](images/header.png)

Solring is an extension for Chromium-based browsers that injects deck and card metrics from
[CommanderSalt](https://commandersalt.com), [EDHREC](https://edhrec.com), and
[Commander Spellbook](https://commanderspellbook.com) into [Moxfield](https://moxfield.com). It shows power level,
bracket, saltiness, archetype, and per-card stats, plus EDHREC popularity / rank / stock, combos, and recommended cuts —
for your decks as well as the decks of other users.

## Features

### Deck page (`moxfield.com/decks/…`)

A report card is added below the deck header, most of the tiles expand an inline detail panel.
The features are designed to be easily readable either using a ranking (A-D), raw scores, or a mix of both.

Card names at all panels (such as e.g. synergy) are hoverable, so you can easily get the context of the related cards.

Each card can be annotated. Use the **"Advanced"** menu to customize the view to add **Power**, **Saltiness** and 
**Synergy** columns (color thresholds can be customized in the extension Options panel). **Tags** can also be toggled
on.

In addition to card metrics columns, you can also find per-card metrics in the card sidebar below the card image.

The **Power** tile keeps a forward-only history sparkline, and the **Commander tier** tile pulls in **EDHREC**
context — popularity, deck count, a bracket-spread chart, rank-over-time, and a "stock-o-meter" (how netdecked vs.
brewed the list is, with your off-meta cards called out). The **Wincons** tile lists the deck's combos and, via
**Commander Spellbook**, the combos it's *one card away* from completing.

### Recommendations page (`moxfield.com/decks/…/recommendations`)

Next to Moxfield's own recommendation tabs, Solring adds a **Cuts** tab powered by EDHREC's recs tool — the cards
worth cutting, which Moxfield's native view never surfaces. Each card shows its EDHREC score and a grey **−** button
that removes one copy from the deck directly (Moxfield's own edit API). The ranking is switchable between **Deck-fit**
(weakest for *this* build first, from CommanderSalt power + synergy) and **EDHREC popularity** (least-played first).
Moxfield's native recommendations are annotated with their EDHREC score too, and the **Deck Preview** panel gains the
same per-card columns and card sidebar as the deck view.

### Deck-List pages (user profile + personal manager)

Solring adds sortable CommanderSalt **metric columns** to the deck table, such as Commander tier,
Power, Bracket, Manabase, Threat, Saltiness, Interaction, Wincons, Combos, Synergy, and Archetype.

You can update the statistics using the **Stats** button next to Moxfield's Sort to *Fetch all*, *Fetch uncached*, or
*Recalculate all* (forces a fresh analysis instead of using cached data).

Data is fetched directly from `api.commandersalt.com` (metrics), `json.edhrec.com` + `edhrec.com` (popularity, stock,
recommended cuts), and `backend.commanderspellbook.com` (combos) — never routed through any Solring proxy.

You can also customize which columns are shown using the **Columns** button (kinda obvious ^^).

### Elsewhere

**CommanderSalt** offers even more metrics, both in their website and their API.
Solring focuses on the most popular ones, but if you want to see more, you can always open the full analysis on
CommanderSalt by clicking the **"CS"** buttons/links.

## Data sources

Solring pulls from three independent APIs. Everything is fetched **directly** from the source — nothing is ever routed
through a Solring backend. EDHREC and Commander Spellbook can each be turned off individually in the
[Options](#options).

### EDHREC (`json.edhrec.com`, `edhrec.com`)

Commander meta context, surfaced on the **Commander tier** tile and the **Recommendations** page:

- **Popularity** — EDHREC rank and deck count, a **bracket-spread** chart, and **rank-over-time**.
- **Stock-o-meter** — the mean EDHREC inclusion of your non-basic cards across this commander's decks (how *netdecked*
  vs. *brewed* the list is), with your off-meta cards listed out.
- **Per-card inclusion %** — the **EDH** column in the card lists and Deck Preview.
- **Recommended cuts** — the *Cuts* tab on the Recommendations page (EDHREC's recs tool), rankable by deck-fit or
  popularity.

EDHREC serves permissive CORS, so it needs no host permission.

### Commander Spellbook (`backend.commanderspellbook.com`)

Combo detection, surfaced under the **Wincons** tile:

- **Combos in the deck** — each with its pieces, prerequisites, step-by-step line, and what it produces.
- **"One card away"** — near-miss combos the deck would complete by adding a single card; the missing piece is marked,
  hover-previewed, and links out to the card.

Commander Spellbook does not serve CORS to the extension, so it requires the `backend.commanderspellbook.com`
host permission.

### CommanderSalt (`api.commandersalt.com`)

The core deck/card analysis — power level, bracket, saltiness, synergy, archetype, threat, interaction, manabase, and
per-card contributions — powering the deck panel, per-card columns, and deck-list metric columns.

## Options

The extension's [options page](chrome-extension://odjkckchpflbblnnngjmapjdmdfcihfb/options.html).

Here you can customize the cache lifetime, color thresholds for the card metrics (Power, Saltiness, Synergy), panel
display toggles, and enable/disable the **EDHREC** and **Commander Spellbook** data sources.

## Installation

### Chrome Web Store
You can download the extension directly from the [Chrome Web Store](https://chromewebstore.google.com/detail/kecdkhbccfanhnilmpfhhnflmmafpbhc).

### Manual (load unpacked)

1. Navigate to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Open any Moxfield deck / decklistto find the integration

## Development

```sh
npm test   # node --test, pure-logic unit tests (extract, ratings, md5, …)
```

Pure ES modules, no bundler. The metric extraction, rating ladder, MD5, deck-list
engine, and Moxfield URL parsing are unit-tested with `node:test` against JSON
fixtures in `fixtures/`; the DOM-rendering modules are validated in a real browser.

## Building & releasing

```sh
npm run build   # runs tests, then writes dist/solring-v<version>.zip
```

**git tags** are used to trigger the Gitlab action [`.github/workflows/release.yml`](.github/workflows/release.yml), 
which tests, packages the zip with the tag's version, and attaches it to a GitHub Release.

```sh
git tag v1.2.3 && git push origin v1.2.3   # builds solring-v1.2.3.zip, creates the release
```

## Licenses

[AGPL v3](LICENSE)

The Solring icon is derived from [Brush PNGs by Vecteezy](https://www.vecteezy.com/free-png/brush), to be exact [here](https://www.vecteezy.com/png/21975762-colored-grunge-circle-brush-ink-frame).

This is an unofficial fan project, and neither affiliated nor endorsed, sponsored, or specifically approved by Wizards
of the Coast LLC, Moxfield, CommanderSalt nor any other company/provider. It may use the trademarks and other
intellectual property of Wizards of the Coast LLC, which is permitted under Wizards' Fan Site Policy. MAGIC: THE
GATHERING® is a trademark of Wizards of the Coast. For more information about Wizards of the Coast or any of Wizards'
trademarks or other intellectual property, please visit their website at https://company.wizards.com/.

