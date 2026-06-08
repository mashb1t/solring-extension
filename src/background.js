// Background service worker: the only code that contacts api.commandersalt.com.
// Routes content-script messages, applies stale-while-revalidate caching, and
// de-dupes in-flight requests. Errors are returned as { error }, never thrown
// into the message channel.

import { getDeckById, searchByAuthor, importByUrl } from './api.js';
import { extractDeck, extractHit, isStub } from './extract.js';
import { getEntry, setEntry, isFresh, dedupe } from './cache.js';

async function fetchAndCacheDeck(md5) {
  const key = `deck:${md5}`;
  return dedupe(key, async () => {
    const raw = await getDeckById(md5);
    if (isStub(raw)) return { stub: true };
    const fields = extractDeck(raw);
    await setEntry(key, fields);
    return { fields };
  });
}

async function getDeck({ md5 }) {
  const key = `deck:${md5}`;
  const entry = await getEntry(key);
  if (entry) {
    if (!isFresh(entry)) fetchAndCacheDeck(md5).catch(() => {}); // revalidate in background
    return { fields: entry.data, cached: true };
  }
  return fetchAndCacheDeck(md5);
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

async function importDeck({ canonicalUrl, md5 }) {
  const raw = await importByUrl(canonicalUrl); // single attempt, never retried
  if (isStub(raw)) return { unanalyzable: true };
  const fields = extractDeck(raw);
  if (md5) await setEntry(`deck:${md5}`, fields);
  return { fields };
}

const HANDLERS = { getDeck, getUserDecks, importDeck };

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = msg && HANDLERS[msg.type];
  if (!handler) return false;
  handler(msg)
    .then((res) => sendResponse(res))
    .catch((err) => sendResponse({ error: String(err && err.message ? err.message : err) }));
  return true; // keep the channel open for the async response
});
