// Background service worker, the only code that contacts api.commandersalt.com.
// Routes content-script messages, applies stale-while-revalidate caching, and
// de-dupes in-flight requests. Errors are returned as { error }, never thrown
// into the message channel.

import { getDeckById, searchByAuthor, importByUrl } from './api.js';
import { extractDeck, extractHit, isStub } from './extract.js';
import { getEntry, setEntry, isFresh, isFreshTtl, dedupe, SCHEMA_VERSION, ENRICH_TTL_MS } from './cache.js';
import { commanderSlug, inclusionByName, stockMeter, commanderPopularity, fetchEdhrec } from './sources/edhrec.js';

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
async function getDeck({ md5, allowFetch = true, maxAgeMs = 0 }) {
  const key = `deck:${md5}`;
  const entry = await getEntry(key);
  const fresh = entry && entry.v === SCHEMA_VERSION && (!maxAgeMs || Date.now() - entry.fetchedAt < maxAgeMs);
  if (entry && fresh) return { fields: entry.data, cached: true, fetchedAt: entry.fetchedAt };
  if (allowFetch) return fetchAndCacheDeck(md5); // cold miss or stale, so GET and cache
  if (entry) return { fields: entry.data, cached: true, stale: true, fetchedAt: entry.fetchedAt };
  return { miss: true };
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
  return { fields, fetchedAt };
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

async function getEnrichment({ source, md5 }) {
  if (source === 'edhrec') return edhrecEnrichment(md5);
  return { error: `unknown enrichment source: ${source}` };
}

const HANDLERS = { getDeck, getUserDecks, importDeck, getEnrichment };

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = msg && HANDLERS[msg.type];
  if (!handler) return false;
  handler(msg)
    .then((res) => sendResponse(res))
    .catch((err) => sendResponse({ error: String(err && err.message ? err.message : err) }));
  return true; // keep the channel open for the async response
});
