# Moxfield × CommanderSalt Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Manifest V3 Chrome extension that injects CommanderSalt deck metrics (power, real bracket, commander tier, archetype, saltiness, threat/interaction/wincons/synergy) and per-card salt/tags/stats into Moxfield deck, user-profile, and personal-deck-manager pages, with persistent caching and bulk sync.

**Architecture:** Content script (DOM injection, SPA-aware, never fetches) ↔ background service worker (sole caller of `api.commandersalt.com`, owns caching). Pure-logic core (md5, grade ladder, payload extraction, label map) lives in ES modules shared by both contexts and unit-tested under `node --test`. Data is fetched **directly from CommanderSalt** — never via solri.ng.

**Tech Stack:** Vanilla JS (ES modules), Manifest V3, `chrome.storage.local`, `node:test` (no build step, no runtime deps). Reference spec: `docs/superpowers/specs/2026-06-08-moxfield-commandersalt-extension-design.md`.

**Locked defaults:** partial sidebar averages (coverage hint), 7-day cache TTL (stale-while-revalidate), salt accent threshold ≥ 5.0, dedicated "Sort by score" control (not clickable headers), card-display prefs global, deck-scores panel collapsible (open when cached / closed when un-analyzed).

---

## File Structure

```
extension/
  manifest.json                 # MV3 manifest
  package.json                  # { "type": "module", "scripts": { "test": "node --test" } }
  src/
    md5.js          # deckMd5(canonicalUrl) — vendored MD5  (pure)
    ratings.js      # CS_RATING_HIGH, csRatingGrade(value, field), csGradeFromPct (pure)
    labels.js       # TAG_LABELS map + prettifyTag(flag) (pure)
    extract.js      # extractDeck(payload) → DeckFields, extractHit(hit) → HitFields (pure)
    moxfield.js     # parseDeckId / parseUsername / canonicalDeckUrl / page-type detection (pure)
    api.js          # getDeckById / searchByAuthor / importByUrl — fetch wrappers (worker only)
    cache.js        # chrome.storage.local get/set, TTL, SWR, in-flight de-dupe, prefs helpers
    background.js   # message router wiring api.js + cache.js
    messaging.js    # sendMessage helper used by content script
    dom.js          # idempotent injection helpers (sentinel), theme detection, tooltip
    prefs.js        # global prefs (cardData, sort) load/save/subscribe
    content.js      # bootstrap: SPA nav hooks + page-type router
    render-deck.js  # collapsible report-card panel + per-card annotations + customize-view + links-menu
    decklist.js     # shared: below-line detail strip + per-row expander + score-sort engine
    render-user.js  # user-profile sidebar averages (uses decklist.js)
    sync.js         # bulk Scan all / Re-scan all (throttled, progress, timestamp)
  styles/solring.css
  fixtures/
    deck_ojer.json        # copy of commandersalt_api.json
    search_mashb1t.json   # copy of the search fixture
  test/
    md5.test.js  ratings.test.js  labels.test.js  extract.test.js  moxfield.test.js
  README.md         # load-unpacked instructions + manual QA checklist
```

---

## Phase 0 — Scaffold

### Task 0: Project skeleton, fixtures, test runner

**Files:**
- Create: `package.json`, `manifest.json`, `README.md`, `styles/solring.css`
- Create: `fixtures/deck_ojer.json`, `fixtures/search_mashb1t.json` (copied from the read-only reference repo)

- [ ] **Step 1: package.json**

```json
{
  "name": "solring-extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
```

- [ ] **Step 2: Copy fixtures** (sources are read-only — copy, never modify originals)

Run:
```bash
cp /Volumes/data/private/mtg/commandersalt_api.json fixtures/deck_ojer.json
cp /Volumes/data/private/mtg/tests/fixtures/commandersalt/search_mashb1t.json fixtures/search_mashb1t.json
```

- [ ] **Step 3: manifest.json** (host permission is CommanderSalt only; modules exposed for dynamic import in the content script)

```json
{
  "manifest_version": 3,
  "name": "Solring — Stats for Moxfield",
  "version": "0.1.0",
  "description": "Shows CommanderSalt deck metrics on Moxfield.",
  "permissions": ["storage"],
  "host_permissions": ["https://api.commandersalt.com/*"],
  "background": { "service_worker": "src/background.js", "type": "module" },
  "content_scripts": [{
    "matches": ["*://*.moxfield.com/*"],
    "js": ["src/content.js"],
    "css": ["styles/solring.css"],
    "run_at": "document_idle"
  }],
  "web_accessible_resources": [{
    "resources": ["src/*.js"],
    "matches": ["*://*.moxfield.com/*"]
  }]
}
```

Note: `content.js` is injected as a classic script; it dynamically `import(chrome.runtime.getURL('src/<module>.js'))` to load the ES-module logic. The service worker is a module and uses static imports.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore(extension): scaffold MV3 manifest, package.json, fixtures, test runner"
```

---

## Phase 1 — Pure-logic core (TDD)

### Task 1: MD5 + canonical URL (`md5.js`)

**Files:**
- Create: `src/md5.js`, `test/md5.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/md5.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md5Hex, deckMd5, canonicalDeckUrl } from '../src/md5.js';

test('md5Hex matches known vector', () => {
  assert.equal(md5Hex(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72');
});

test('deckMd5 of canonical Moxfield URL matches CommanderSalt deck id', () => {
  assert.equal(
    deckMd5('https://moxfield.com/decks/1OeRLCXjAUC9dNmkw3e_7g'),
    '9bc8a6c2106583c1fd66e0492a3a5a26'
  );
});

test('canonicalDeckUrl normalizes a public id', () => {
  assert.equal(canonicalDeckUrl('1OeRLCXjAUC9dNmkw3e_7g'),
    'https://moxfield.com/decks/1OeRLCXjAUC9dNmkw3e_7g');
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npm test` — Expected: FAIL (cannot find `../src/md5.js`).

- [ ] **Step 3: Implement** — vendor a small UTF-8-correct MD5 (RFC 1321). Use a vetted compact implementation (e.g. blueimp-md5, MIT) adapted to an ES export. `deckMd5 = md5Hex(canonicalUrl)`; `canonicalDeckUrl(id) = ` template. Ensure UTF-8 encoding (encode to bytes before hashing) so the `abc` and known-deck vectors pass.

```js
// src/md5.js  — md5Hex(str) hashes the UTF-8 bytes of str (vendored MD5 core omitted here; use blueimp-md5 core).
export function md5Hex(str) { /* vendored MD5 over UTF-8 bytes → 32-char lowercase hex */ }
export function canonicalDeckUrl(publicId) { return `https://moxfield.com/decks/${publicId}`; }
export function deckMd5(canonicalUrl) { return md5Hex(canonicalUrl); }
```

- [ ] **Step 4: Run, expect pass.** `npm test`
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(extension): vendored md5 + canonical deck-url helpers"`

### Task 2: Grade ladder (`ratings.js`)

**Files:** Create `src/ratings.js`, `test/ratings.test.js`

- [ ] **Step 1: Failing test** (values verified against the prototype's ratings.js)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csRatingGrade, csGradeFromPct } from '../src/ratings.js';

test('grades from the reference deck', () => {
  assert.equal(csRatingGrade(130.5928, 'saltRating'), 'C+');   // 43.5%
  assert.equal(csRatingGrade(197, 'interactionRating'), 'B–'); // 49.2%
  assert.equal(csRatingGrade(347.8, 'comboRating'), 'A+');     // 100%
  assert.equal(csRatingGrade(1787.3, 'synergyRating'), 'B+');  // 71.5%
});
test('ladder boundaries', () => {
  assert.equal(csGradeFromPct(0), 'D–');
  assert.equal(csGradeFromPct(100), 'A+');
});
```

- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — port the prototype `ratings.js` verbatim to ES exports: `CS_RATING_HIGH` ceilings `{saltRating:300, interactionRating:400, comboRating:300, powerLevelRating:10, synergyRating:2500, threatRating:500}`; `csRatingPct(value, field)=min(value/high,1)*100`; `GRADE_LADDER` 12 steps `[2,'D–']…[Inf,'A+']`; `csGradeFromPct`; `csRatingGrade`.
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(extension): CommanderSalt grade ladder (ratings.js)"`

### Task 3: Tag labels (`labels.js`)

**Files:** Create `src/labels.js`, `test/labels.test.js`

- [ ] **Step 1: Failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prettifyTag } from '../src/labels.js';

test('prettifies known CommanderSalt stat flags', () => {
  assert.equal(prettifyTag('multipliers'), 'multiplier');
  assert.equal(prettifyTag('fastmana'), 'fast mana');
  assert.equal(prettifyTag('boardWipes'), 'boardwipe');
  assert.equal(prettifyTag('costReduction'), 'cost↓');
  assert.equal(prettifyTag('burn'), 'burn');           // pass-through
  assert.equal(prettifyTag('plusOnePlusOneCounters'), '+1/+1 counters');
});
```

- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — `TAG_LABELS` map for the 24-flag vocabulary (anthem, boardWipes→boardwipe, burn, cantrip, cheat, combat, costReduction→cost↓, counterspell→counter, evasion, fastmana→fast mana, groupslug, landsmatter→lands matter, manafixing→mana fixing, multipliers→multiplier, otherControl→control, plusOnePlusOneCounters→+1/+1 counters, ramp, recursion, slow, spotRemoval→removal, stax, stompy, tokens, voltron); `prettifyTag(flag)` returns the mapped label or the flag unchanged.
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(extension): tag label map"`

### Task 4: Payload extraction (`extract.js`)

**Files:** Create `src/extract.js`, `test/extract.test.js`

- [ ] **Step 1: Failing test** (against the bundled fixtures; value & baseline bracket intentionally absent)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractDeck, extractHit } from '../src/extract.js';

const deck = JSON.parse(readFileSync(new URL('../fixtures/deck_ojer.json', import.meta.url)));
const search = JSON.parse(readFileSync(new URL('../fixtures/search_mashb1t.json', import.meta.url)));

test('extractDeck pulls the displayed metrics', () => {
  const d = extractDeck(deck);
  assert.equal(d.deckId, '9bc8a6c2106583c1fd66e0492a3a5a26');
  assert.equal(Math.round(d.power * 10) / 10, 5.9);
  assert.equal(d.bracketRealistic, 3);          // csBracket
  assert.equal(d.commanderTier, 4);             // T4
  assert.equal(d.threat, 394.9);
  assert.equal(d.interaction, 197);
  assert.equal(d.wincons, 347.8);               // comboRating
  assert.equal(d.synergy, 1787.3);
  assert.equal(d.salt, 130.5928003116271);
  assert.equal(d.archetype, 'MIDRANGE / COMBO');
  assert.equal(d.value, undefined);             // dropped on purpose
  assert.equal(d.bracketBaseline, undefined);   // dropped on purpose
});

test('extractDeck builds a per-card map (salt + prettified tags)', () => {
  const d = extractDeck(deck);
  const ojer = d.cards['ojer axonil, deepest might'];
  assert.equal(ojer.salt, 0);
  assert.deepEqual(ojer.tags.sort(), ['burn', 'multiplier'].sort());
  const arsonist = d.cards['gleeful arsonist'];
  assert.equal(arsonist.salt, 5.5);
});

test('extractHit pulls per-row metrics from a search hit', () => {
  const h = extractHit(search.hits.find(x => /ojer/i.test(x.title)));
  assert.equal(h.deckId, '9bc8a6c2106583c1fd66e0492a3a5a26');
  assert.equal(Math.round(h.power * 10) / 10, 5.9);
  assert.equal(h.salt, 130.5928003116271);
  assert.equal(h.archetypeMajor, 'MIDRANGE');
});
```

- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — `extractDeck(p)`:
  - `_g` safe-path helper.
  - `deckId = p.id`; `power = p.powerLevelRating`; `bracketRealistic = _g(p,'details','brackets','csBracket')`; `commanderTier = _g(p,'details','powerLevel','ratings','commanderTier')`; `salt = p.saltRating`; `threat = p.threatRating`; `interaction = _g(p,'details','powerLevel','scoring','interaction','score')`; `wincons = p.comboRating`; `synergy = p.synergyRating`; `archetype = p.archetypeLabel`; `commander = (p.commanders||[])[0]`; `colorIdentity = p.colorIdentity`; `isPrivate = p.isPrivate`; `isIllegal = p.isIllegal`.
  - `cards`: for each value `c` in `p.cards`, key `c.name.toLowerCase().trim()` → `{ salt: parseFloat(c.salt)||0, tags: Object.keys(c.categories?.stats||{}).filter(k=>c.categories.stats[k]).map(prettifyTag), total: c.categories?.total||0 }`.
  - **Do not** set `value` or `bracketBaseline`.
  - `extractHit(h)`: `{ deckId:h.deckId, title:h.title, commander:(h.commanders||[])[0], colorIdentity:h.colorIdentity, power:h.powerLevelRating, bracketRating:h.bracketRating, salt:h.saltRating, synergy:h.synergyRating, archetypeMajor:h.archetypeMajor, archetypeMinor:h.archetypeMinor, isPrivate:h.isPrivate, isIllegal:h.isIllegal }`.
  - `isStub(p) = p.name == null || (p._cardCount||0) === 0` (export for the worker).
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(extension): payload + search-hit extraction with per-card map"`

### Task 5: URL parsing & page-type (`moxfield.js`)

**Files:** Create `src/moxfield.js`, `test/moxfield.test.js`

- [ ] **Step 1: Failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeckId, parseUsername, pageType } from '../src/moxfield.js';

test('parseDeckId', () => {
  assert.equal(parseDeckId('https://moxfield.com/decks/abc-123'), 'abc-123');
  assert.equal(parseDeckId('https://moxfield.com/decks/personal'), null); // reserved word, not a deck
  assert.equal(parseDeckId('https://moxfield.com/users/mashb1t'), null);
});
test('parseUsername', () => {
  assert.equal(parseUsername('https://moxfield.com/users/mashb1t'), 'mashb1t');
  assert.equal(parseUsername('https://moxfield.com/decks/abc'), null);
});
test('pageType', () => {
  assert.equal(pageType('https://moxfield.com/decks/abc-123'), 'deck');
  assert.equal(pageType('https://moxfield.com/users/mashb1t'), 'user');
  assert.equal(pageType('https://moxfield.com/decks/personal'), 'personal');
  assert.equal(pageType('https://moxfield.com/decks/personal/Folder%20A'), 'personal');
  assert.equal(pageType('https://moxfield.com/'), null);
});
```

- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — regexes: deck = `^/decks/([A-Za-z0-9_-]+)$` **excluding** the reserved words `personal|public|all|bookmarks`; user = `^/users/([A-Za-z0-9_-]+)$`; personal = `^/decks/(personal|all|public|bookmarks)(/|$)`. `pageType` returns `'deck' | 'user' | 'personal' | null`.
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(extension): moxfield url parsing + page-type detection"`

---

## Phase 2 — Background worker (api + cache + messaging)

### Task 6: API wrappers (`api.js`)

**Files:** Create `src/api.js`

- [ ] **Step 1: Implement** (worker-only; thin `fetch`). No unit test (network); covered by manual QA + mock mode.

```js
const BASE = 'https://api.commandersalt.com';
export async function getDeckById(md5) {
  const r = await fetch(`${BASE}/decks?id=${encodeURIComponent(md5)}`);
  if (!r.ok) throw new Error(`getDeck ${r.status}`);
  return r.json();
}
export async function searchByAuthor(username, cursor) {
  const u = new URL(`${BASE}/search`);
  u.searchParams.set('type', 'decks');
  u.searchParams.set('authorIndexId', username.toLowerCase());
  if (cursor) u.searchParams.set('cursor', cursor);
  const r = await fetch(u); if (!r.ok) throw new Error(`search ${r.status}`);
  return r.json();   // { hits, cursor }
}
export async function importByUrl(canonicalUrl) {     // manual only, never auto-retried
  const u = new URL(`${BASE}/decks`); u.searchParams.set('url', canonicalUrl);
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(u, { method: 'POST', signal: ctrl.signal });
    if (!r.ok) throw new Error(`import ${r.status}`);
    return r.json();
  } finally { clearTimeout(t); }
}
```

- [ ] **Step 2: Commit** — `git commit -am "feat(extension): CommanderSalt api wrappers"`

### Task 7: Cache + prefs (`cache.js`)

**Files:** Create `src/cache.js`

- [ ] **Step 1: Implement** — `chrome.storage.local` wrappers; `TTL_MS = 7*864e5`; `getCached(key)`, `setCached(key, data)` storing `{fetchedAt, data}`; `isFresh(entry)`; an in-memory `Map` of in-flight Promises keyed by request key to de-dupe; helpers `getPref(key, default)` / `setPref(key, val)` for `prefs:cardData`, `prefs:sort`; `getSync(username)` / `setSync(username, patch)` for `sync:{username}`. Storage keys per spec: `deck:{md5}`, `search:{username}`, `prefs:cardData`, `prefs:sort`, `sync:{username}`.
- [ ] **Step 2: Commit** — `git commit -am "feat(extension): storage cache (SWR, de-dupe) + prefs/sync helpers"`

### Task 8: Background message router (`background.js`)

**Files:** Create `src/background.js`

- [ ] **Step 1: Implement** — `chrome.runtime.onMessage` handler for:
  - `getDeck {md5}` → SWR: return cached `deck:{md5}` immediately if fresh; on miss/stale, `getDeckById`, `isStub`? return `{stub:true}` : `extractDeck` → cache → return `{fields}`. De-dupe in-flight.
  - `getUserDecks {username, cursor}` → cached `search:{username}` if fresh (and no cursor) else `searchByAuthor` → `hits.map(extractHit)` → cache → return `{hits, cursor}`.
  - `importDeck {canonicalUrl, md5}` → `importByUrl`; `isStub`? return `{unanalyzable:true}` : `extractDeck` → cache → return `{fields}`. Single attempt, never retried.
  - All handlers wrapped so errors return `{error: message}` (never throw to the port). Return `true` to keep the message channel open for async `sendResponse`.
- [ ] **Step 2: Commit** — `git commit -am "feat(extension): background message router (getDeck/getUserDecks/importDeck)"`

### Task 9: Messaging helper (`messaging.js`)

**Files:** Create `src/messaging.js`

- [ ] **Step 1: Implement** — `export const send = (msg) => chrome.runtime.sendMessage(msg)` returning a Promise; small typed wrappers `getDeck(md5)`, `getUserDecks(username, cursor)`, `importDeck(canonicalUrl, md5)`.
- [ ] **Step 2: Commit** — `git commit -am "feat(extension): content↔worker messaging helper"`

---

## Phase 3 — Content-script foundation

### Task 10: DOM helpers + theme + tooltip (`dom.js`)

**Files:** Create `src/dom.js`

- [ ] **Step 1: Implement** — `el(tag, props, children)` builder; `once(node, key)` returns false if `node.dataset.solring` already includes `key` (else marks + returns true) for idempotent injection; `isDark()` reads Moxfield's theme (`document.documentElement` class/attribute; fallback `matchMedia('(prefers-color-scheme: dark)')`); `tooltip(target, text)` attaches a Moxfield-styled info tooltip; `gradeColorVar(grade)` / `pctColorVar(pct)` mapping to the rating-color CSS vars. All selectors that touch Moxfield are **confirmed against the live DOM during this task** (load unpacked, inspect).
- [ ] **Step 2: Commit** — `git commit -am "feat(extension): dom injection helpers, theme detection, tooltip"`

### Task 11: Prefs module (`prefs.js`)

**Files:** Create `src/prefs.js`

- [ ] **Step 1: Implement** — load/save `prefs:cardData {saltValue:true, tags:true, stats:false}` and `prefs:sort {key:null, dir:'desc'}` via `cache.js`; `subscribe(cb)` using `chrome.storage.onChanged` so all open tabs react to a pref change.
- [ ] **Step 2: Commit** — `git commit -am "feat(extension): global prefs module with cross-tab sync"`

### Task 12: Content bootstrap + SPA router (`content.js`)

**Files:** Create `src/content.js`

- [ ] **Step 1: Implement** — dynamic-import the ES modules via `chrome.runtime.getURL`. Patch `history.pushState`/`replaceState` to emit a `solring:navigate` event; listen for `popstate` + that event; debounce + also poll `location.href` as a fallback. On each route change: compute `pageType`, tear down stale injected roots, dispatch to `render-deck` / `render-user` / `decklist`+`render-user`(sidebar) / nothing. Guard everything so exceptions are caught and logged, never bubbling into Moxfield.
- [ ] **Step 2: Manual check** — load unpacked; navigate deck→user→personal; confirm the router fires once per navigation and re-injection is idempotent.
- [ ] **Step 3: Commit** — `git commit -am "feat(extension): content bootstrap + SPA-aware router"`

---

## Phase 4 — Deck page

### Task 13: Collapsible report-card panel (`render-deck.js`)

**Files:** Create `src/render-deck.js`

- [ ] **Step 1: Implement** — locate the deck header (by content/structure; confirm live). Inject a collapsible panel below it (sentinel-guarded). Request `getDeck(md5)`:
  - **fields** → render tiles **power, real bracket (T-less number), commander tier `T{n}`, saltiness (grade + raw), archetype** and four grades **threat/interaction/wincons/synergy** via `csRatingGrade`. Panel **default open**. (No value, no baseline.)
  - **stub** → panel **default closed**; expanding shows an **"Analyze on CommanderSalt"** button → `importDeck`; on `{unanalyzable}` show "Couldn't analyze — private, non-Commander, or illegal"; on success re-render.
  - **isPrivate/isIllegal** → default closed; "Private/illegal — can't analyze" on expand.
  - **error** → inline message + single Retry.
  - Private-not-owner (no deck header found) → render nothing.
- [ ] **Step 2: Manual check** against the live deck `9bc8a6c…` (Ojer) and a private deck (`UncuYVlqC0y8rbtPCM73SQ`).
- [ ] **Step 3: Commit** — `git commit -am "feat(extension): collapsible deck report-card panel + analyze flow"`

### Task 14: Per-card annotations + Customize View toggles (`render-deck.js`)

**Files:** Modify `src/render-deck.js`

- [ ] **Step 1: Implement** — only when View Style is **Text** (detect; re-evaluate on change). For each decklist row, match by normalized card name to `fields.cards`:
  - **Salt Value** (pref, default on): salt chip, class `solring-salt-high` when `≥ 5.0`.
  - **Tags** (pref, default on): prettified tag pills.
  - **Stats** (pref, default off): a `▸` per-row expander revealing the stat-category list + the card's power/salt/synergy contribution; plus a single **"toggle all"** control in the decklist header to expand/collapse all.
  - Inject the three checkboxes into Moxfield's **Customize View → Include Extra Data** (MutationObserver for the modal; idempotent); wire to `prefs:cardData`; apply immediately on toggle; re-render rows on `prefs` change. MutationObserver re-applies row annotations after Moxfield re-renders.
- [ ] **Step 2: Manual check** — toggle each in Customize View; switch view styles; confirm Text-only and global persistence.
- [ ] **Step 3: Commit** — `git commit -am "feat(extension): per-card salt/tags/stats + Customize View toggles"`

### Task 15: CommanderSalt links-menu entry (`render-deck.js`)

**Files:** Modify `src/render-deck.js`

- [ ] **Step 1: Implement** — find the deck's tools/links menu (confirm live); inject a **CommanderSalt** link → `https://commandersalt.com/details/deck/{md5}` (alongside EDHREC when present, on its own otherwise — **always shown**); idempotent; re-inject on menu re-render.
- [ ] **Step 2: Commit** — `git commit -am "feat(extension): always-on CommanderSalt links-menu entry"`

---

## Phase 5 — Deck-list surfaces (user profile + personal manager)

### Task 16: Shared deck-list engine — below-line detail (`decklist.js`)

**Files:** Create `src/decklist.js`

- [ ] **Step 1: Implement** — given a container of deck rows (works for both `/users/{name}` and `/decks/personal` + folders; confirm live selectors): for each **deck** row (skip folders / "Up a level"):
  - read its deck link → `canonicalDeckUrl` → `md5`; look up the joined `HitFields` (from `getUserDecks`) and any cached `DeckFields`.
  - append a **below-line detail strip**: tier `T{n}`, power `X.X/10` + bar, saltiness, **THR/INT/WIN/SYN** bars + grades, **real bracket**, archetype, CommanderSalt/Moxfield link icons. (No deck name, value, or baseline bracket.)
  - hit metrics render immediately; full-payload metrics show "—" until cached. A per-row expand affordance calls `getDeck(md5)` to fill them (and contributes to averages).
  - rating-color bars + A–F grades via `dom.js` color helpers. Idempotent; MutationObserver re-applies after re-render.
- [ ] **Step 2: Manual check** on `/users/mashb1t`.
- [ ] **Step 3: Commit** — `git commit -am "feat(extension): shared deck-list below-line detail strip"`

### Task 17: Score-sort control (`decklist.js`)

**Files:** Modify `src/decklist.js`

- [ ] **Step 1: Implement** — inject a **"Sort by score"** control into the current view's toolbar. Keys: power, bracket(real), saltiness, synergy (always) + threat, interaction, wincons, tier (when cached). Click toggles desc/asc. Reorder **only the deck rows in the current folder** (each row + its detail strip move together); pin folders / "Up a level". Missing-metric rows sort last (marked, with "Scan all" hint). Persist `prefs:sort`; re-apply on folder nav + Moxfield re-render; detect a native-sort click and yield. Reuse the prototype's comparator logic.
- [ ] **Step 2: Manual check** — sort by power/salt within a folder; confirm pinning, persistence, and yielding to Moxfield's own sort.
- [ ] **Step 3: Commit** — `git commit -am "feat(extension): per-folder score-sort control"`

### Task 18: User-profile sidebar averages (`render-user.js`)

**Files:** Create `src/render-user.js`

- [ ] **Step 1: Implement** — append an averages block to the profile sidebar: **ø power / ø bracket / ø saltiness / ø synergy** from all hits (always); **ø threat / ø interaction / ø wincons / ø commander-tier** averaged over decks whose full payload is cached, each with a **"from N decks"** coverage hint. Recompute as more decks get cached (subscribe to relevant updates). Uses `decklist.js` for the table itself.
- [ ] **Step 2: Commit** — `git commit -am "feat(extension): user-profile sidebar averages (partial w/ coverage)"`

### Task 19: Bulk sync (`sync.js`)

**Files:** Create `src/sync.js`

- [ ] **Step 1: Implement** — inject **Scan all** + **Re-scan all** buttons + a Moxfield-styled tooltip ("Private decks can't be synced — CommanderSalt can't read them") + a last-sync timestamp (`sync:{username}`). Enumerate the user's decks (Moxfield rows joined with `/search`); read **visibility badges**; exclude **Private**; keep **Public + Unlisted**.
  - **Scan all**: for each syncable deck, `getDeck(md5)` (warm; skip fresh); if stub → `importDeck` (POST). 
  - **Re-scan all**: confirm-gated; `importDeck` for every syncable deck.
  - Sequential + throttled (small delay), progress "Syncing n/N…", cancel control; each POST attempted once (never retried); per-deck failures listed. Update timestamp on completion; refresh detail strips + averages from the new cache.
- [ ] **Step 2: Commit** — `git commit -am "feat(extension): bulk Scan all / Re-scan all with visibility gating"`

---

## Phase 6 — Styling, mock mode, docs

### Task 20: Styles (`styles/solring.css`)

**Files:** Create/extend `styles/solring.css`

- [ ] **Step 1: Implement** — `solring-`-namespaced styles: report-card panel + tiles, grade chips, salt chips (`.solring-salt-high`), tag pills, below-line detail strip + bars, score-sort + sync controls, tooltip. Rating-color CSS vars (light + dark) keyed off Moxfield's theme via `dom.isDark()`. Blend with Moxfield surfaces/typography; no orange branding/wordmark; rating color only as data accent. WCAG AA contrast; visible focus rings; `prefers-reduced-motion` honored.
- [ ] **Step 2: Commit** — `git commit -am "style(extension): blended-in CommanderSalt UI styling"`

### Task 21: Mock mode + README + QA checklist

**Files:** Modify `src/content.js`/`src/background.js`; create `README.md`

- [ ] **Step 1: Implement** — a `MOCK` flag (e.g. `localStorage.solringMock = '1'`) that serves `fixtures/deck_ojer.json` / `fixtures/search_mashb1t.json` instead of network, for offline UI iteration.
- [ ] **Step 2: README** — load-unpacked steps + the manual QA checklist from the spec (deck indexed / un-indexed / private; user + personal below-line detail; score sort; per-card Text-only; Customize View persistence; CommanderSalt link; Scan all/Re-scan all; SPA nav; light/dark; offline cache).
- [ ] **Step 3: Commit** — `git commit -am "chore(extension): mock mode + README + QA checklist"`

---

## Self-review notes

- **Spec coverage:** deck panel (T13), per-card + Customize View (T14), links menu (T15), user profile + averages (T16/T18), personal manager (T16/T17 shared engine), below-line detail (T16), score sort (T17), bulk sync (T19), caching/SWR (T7/T8), direct CommanderSalt sourcing (T6/manifest), md5 join (T1), grade ladder (T2), per-card extraction (T4), value/base-bracket dropped (T4/T13/T16). Combos (Spellbook) intentionally out of scope.
- **DOM-dependent tasks (10, 12–19)** carry explicit "confirm against live DOM" steps because Moxfield is a React SPA with hashed class names and `/decks/personal` is login-gated; selectors are finalized at implementation time, anchored by content/structure.
- **Pure modules (1–5)** are fully TDD'd against the bundled fixtures with concrete assertions and known vectors.
