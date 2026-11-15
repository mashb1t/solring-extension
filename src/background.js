// Background service worker, the only code that contacts api.commandersalt.com.
// Routes content-script messages, applies stale-while-revalidate caching, and
// de-dupes in-flight requests. Errors are returned as { error }, never thrown
// into the message channel.

import { getDeckById, searchByAuthor, importByUrl } from './api.js';
import { extractDeck, extractHit, isStub } from './extract.js';
import { getEntry, setEntry, isFresh, isFreshTtl, dedupe, SCHEMA_VERSION, ENRICH_TTL_MS, SBOOK_TTL_MS, SCRY_INFO_TTL_MS, SCRY_FLAGS_TTL_MS, recordPowerPoint } from './cache.js';
import { commanderSlug, inclusionByName, stockMeter, commanderPopularity, fetchEdhrec } from './sources/edhrec.js';
import { fetchMyCombos, nearMissCombos } from './sources/spellbook.js';
import { fetchRecs } from './sources/edhrec-recs.js';
import { fetchEdhrecPage, themesOf, themeCards, topCommanders, cardSlug } from './sources/edhrec-build.js';
import { searchCommanders, fetchCardLookup, fetchFlagSets, frontFace } from './sources/scryfall.js';
import { md5Hex } from './md5.js';

async function fetchAndCacheDeck(md5) {
  const key = `deck:${md5}`;
  return dedupe(key, async () => {
    const raw = await getDeckById(md5);
    if (isStub(raw)) return { stub: true };
    const fields = extractDeck(raw);
    const entry = await setEntry(key, fields);
    return { fields, fetchedAt: entry.fetchedAt };
  });
}

// allowFetch=false means cache-only (returns {miss:true} on a cold miss). With
// maxAgeMs>0, entries older than that count as stale: re-GET when allowFetch, else
// returned with {stale:true}. Schema-stale entries (older SCHEMA_VERSION) are likewise
// not fresh, so a field added to extractDeck backfills on the next allow-fetch read.
// Defaults preserve the old cache-or-GET behavior.
async function getDeckInner({ md5, allowFetch = true, maxAgeMs = 0 }) {
  const key = `deck:${md5}`;
  const entry = await getEntry(key);
  const fresh = entry && entry.v === SCHEMA_VERSION && (!maxAgeMs || Date.now() - entry.fetchedAt < maxAgeMs);
  if (entry && fresh) return { fields: entry.data, cached: true, fetchedAt: entry.fetchedAt };
  if (allowFetch) return fetchAndCacheDeck(md5); // cold miss or stale, so GET and cache
  if (entry) return { fields: entry.data, cached: true, stale: true, fetchedAt: entry.fetchedAt };
  return { miss: true };
}

async function getDeck(msg) {
  const res = await getDeckInner(msg);
  // Record the deck's power/bracket in its local history (deduped per analysis) and hand
  // the series back so the Power tile can chart it. Failure never breaks the read.
  if (res && res.fields) res.history = await recordPowerPoint(msg.md5, res.fields).catch(() => []);
  return res;
}

async function getUserDecks({ username, cursor }) {
  const key = `search:${username.toLowerCase()}`;
  if (!cursor) {
    const entry = await getEntry(key);
    if (isFresh(entry)) return { ...entry.data, cached: true };
  }
  const body = await searchByAuthor(username, cursor);
  const hits = (body.hits || []).map(extractHit);
  const result = { hits, cursor: body.cursor || null, total: body.total };
  if (!cursor) await setEntry(key, result);
  return result;
}

async function importDeck({ canonicalUrl, md5, oldDeckId }) {
  const raw = await importByUrl(canonicalUrl, oldDeckId); // single attempt, never retried
  if (isStub(raw)) return { unanalyzable: true };
  const fields = extractDeck(raw);
  let fetchedAt;
  if (md5) ({ fetchedAt } = await setEntry(`deck:${md5}`, fields));
  const history = md5 ? await recordPowerPoint(md5, fields).catch(() => []) : [];
  return { fields, fetchedAt, history };
}

// EDHREC enrichment for a deck: read the commander + card names from the CACHED deck
// entry (no extra CS fetch), derive the EDHREC slug, cache the commander page JSON
// commander-scoped (shared across every deck with that commander, TTL-only), and derive
// popularity + stock meter + the inclusion map. All three come from one payload.
async function edhrecEnrichment(md5) {
  const deck = await getEntry(`deck:${md5}`);
  if (!deck || !deck.data) return { miss: true };
  const commanders = (deck.data.commanders && deck.data.commanders.length)
    ? deck.data.commanders
    : (deck.data.commander ? [deck.data.commander] : []);
  const slug = commanderSlug(commanders);
  if (!slug) return { miss: true };
  // dedupe ONLY the commander-scoped JSON fetch/cache (shared across every deck with this
  // commander). Deck-specific derivation (stock meter) is done OUTSIDE per caller, so a
  // concurrent request for a different deck sharing the commander can't get this deck's stock.
  const key = `edhrec:${slug}`;
  const entry = await dedupe(key, async () => {
    const cached = await getEntry(key);
    if (isFreshTtl(cached, ENRICH_TTL_MS)) return cached;
    const json = await fetchEdhrec(slug);
    if (!json) return null;
    return setEntry(key, json);
  });
  if (!entry || !entry.data) return { miss: true };
  const inclusion = inclusionByName(entry.data);
  const deckCardNames = Object.values(deck.data.cards || {}).map((c) => c.name).filter(Boolean);
  return {
    popularity: commanderPopularity(entry.data),
    stock: stockMeter(inclusion, deckCardNames, commanders),
    inclusion,
    fetchedAt: entry.fetchedAt,
  };
}

// Commander Spellbook "one card away": POST the cached deck to find-my-combos and return the
// combos it's a single card short of. Cached by a hash of the (sorted) card list so an edit
// invalidates it (the deck md5 is URL-based and stable across edits); 30-day TTL. The
// near-miss diff is computed fresh per call from the cached results.
async function spellbookEnrichment(md5) {
  const deck = await getEntry(`deck:${md5}`);
  if (!deck || !deck.data || !deck.data.cards) return { miss: true };
  const commanderNames = (deck.data.commanders && deck.data.commanders.length)
    ? deck.data.commanders
    : (deck.data.commander ? [deck.data.commander] : []);
  if (!commanderNames.length) return { miss: true };
  const front = (n) => String(n).split(' // ')[0].toLowerCase().trim();
  const cmdFront = new Set(commanderNames.map(front));
  const names = Object.values(deck.data.cards).map((c) => c.name).filter(Boolean);
  const commanders = commanderNames.map((card) => ({ card, quantity: 1 }));
  const main = names.filter((n) => !cmdFront.has(front(n))).map((card) => ({ card, quantity: 1 }));
  const key = `sbook:${md5Hex([...names].sort().join('|'))}`;
  const entry = await dedupe(key, async () => {
    const cached = await getEntry(key);
    if (isFreshTtl(cached, SBOOK_TTL_MS)) return cached;
    const results = await fetchMyCombos(commanders, main);
    if (!results) return null;
    return setEntry(key, results);
  });
  if (!entry || !entry.data) return { miss: true };
  return { nearMiss: nearMissCombos(entry.data, names), fetchedAt: entry.fetchedAt };
}

async function getEnrichment({ source, md5 }) {
  if (source === 'edhrec') return edhrecEnrichment(md5);
  if (source === 'spellbook') return spellbookEnrichment(md5);
  return { error: `unknown enrichment source: ${source}` };
}

// edhrec.com/api/recs stopped serving ACAO, so the deck-specific recs POST runs here (host grant).
const getRecs = ({ commanders, cards }) => fetchRecs(commanders, cards);

// Guided Deck Builder: the SHAPED result of one EDHREC page per op, cached TTL-only
// (ebuild:<op>:<path>). Raw pages run ~120 KB each and would crowd deck:* analyses out of the
// storage quota; cache.js keeps display fields only. Old raw ebuild:<path> entries are never read
// again and age out through eviction.
async function buildPage(op, path, shape) {
  const key = `ebuild:${op}:${path}`;
  const entry = await dedupe(key, async () => {
    const cached = await getEntry(key);
    if (isFreshTtl(cached, ENRICH_TTL_MS)) return cached;
    const json = await fetchEdhrecPage(path);
    if (!json) return null;
    return setEntry(key, shape(json));
  });
  return entry && entry.data ? entry.data : null;
}

// Raw Spellbook find-my-combos results for an arbitrary in-progress deck (content scripts
// compute keyCombos from them). Cached by a hash of the sorted card list, like spellbookEnrichment.
async function buildCombos(commanders, cards) {
  const cmds = (commanders || []).filter(Boolean);
  const names = (cards || []).filter(Boolean);
  if (!cmds.length) return { miss: true };
  const key = `sbook:${md5Hex([...cmds, ...names].sort().join('|'))}`;
  const entry = await dedupe(key, async () => {
    const cached = await getEntry(key);
    if (isFreshTtl(cached, SBOOK_TTL_MS)) return cached;
    const results = await fetchMyCombos(cmds.map((card) => ({ card, quantity: 1 })), names.map((card) => ({ card, quantity: 1 })));
    if (!results) return null;
    return setEntry(key, results);
  });
  return entry && entry.data ? { results: entry.data } : { miss: true };
}

async function getBuildData({ op, commanders, theme, card, cards }) {
  if (op === 'combos') return buildCombos(commanders, cards);
  let path = null; let shape = null;
  if (op === 'themes') {
    const slug = commanderSlug(commanders);
    if (slug) { path = `commanders/${slug}`; shape = (j) => ({ themes: themesOf(j) }); }
  } else if (op === 'theme') {
    const slug = commanderSlug(commanders);
    if (slug && theme) { path = `commanders/${slug}/${theme}`; shape = (j) => ({ cards: themeCards(j) }); }
  } else if (op === 'byTheme') {
    if (theme) { path = `tags/${theme}`; shape = (j) => ({ commanders: topCommanders(j) }); }
  } else if (op === 'byCard') {
    const slug = card && cardSlug(card);
    if (slug) { path = `cards/${slug}`; shape = (j) => ({ commanders: topCommanders(j) }); }
  }
  if (!path) return { miss: true };
  return (await buildPage(op, path, shape)) || { miss: true };
}

// Guided Deck Builder: Scryfall data. Card info is cached per front-face key (scry:<key>, 1 day);
// only uncached names hit the network. Flag lists are cached whole (scry:flags, 7 days, served
// stale when a refresh fails) and go over the wire as arrays.

async function cardInfo(names) {
  const info = {};
  const missing = [];
  for (const name of (names || [])) {
    const key = frontFace(name);
    const cached = await getEntry(`scry:${key}`);
    // An entry cached before a field was kept is refetched once: eur/tix (non-USD prices aren't
    // "unknown"), cmc/oracle (the Karsten land formula).
    if (!isFreshTtl(cached, SCRY_INFO_TTL_MS) || (!cached.data.notFound && !('eur' in cached.data && 'oracle' in cached.data))) missing.push(name);
    else if (!cached.data.notFound) info[key] = cached.data; // negative entries stay absent
  }
  if (missing.length) {
    const { info: found, notFound } = await fetchCardLookup(missing);
    for (const [key, card] of Object.entries(found)) {
      info[key] = card;
      await setEntry(`scry:${key}`, card);
    }
    for (const key of notFound) await setEntry(`scry:${key}`, { notFound: true });
  }
  return info;
}

async function flagLists() {
  const key = 'scry:flags';
  const entry = await dedupe(key, async () => {
    const cached = await getEntry(key);
    if (isFreshTtl(cached, SCRY_FLAGS_TTL_MS)) return cached;
    const sets = await fetchFlagSets();
    // Stale-on-error: an expired copy beats none (empty lists would lift the bracket limits).
    if (!sets) return cached && cached.data ? cached : null;
    return setEntry(key, {
      gameChangers: [...sets.gameChangers],
      extraTurns: [...sets.extraTurns],
      massLandDenial: [...sets.massLandDenial],
    });
  });
  return entry && entry.data ? entry.data : { miss: true };
}

async function getCardData({ op, q, names }) {
  if (op === 'search') return { commanders: q && String(q).trim() ? await searchCommanders(String(q).trim()) : [] };
  if (op === 'info') return { info: await cardInfo(names) };
  if (op === 'flags') return flagLists();
  return { miss: true };
}

const HANDLERS = { getDeck, getUserDecks, importDeck, getEnrichment, getRecs, getBuildData, getCardData };

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = msg && HANDLERS[msg.type];
  if (!handler) return false;
  handler(msg)
    .then((res) => sendResponse(res))
    .catch((err) => sendResponse({ error: String(err && err.message ? err.message : err) }));
  return true; // keep the channel open for the async response
});
