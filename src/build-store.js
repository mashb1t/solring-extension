// Per-deck Guided Builder state (chosen playstyle + rules) and the one-shot "pending build"
// handoff from Moxfield's New-deck dialog to the new deck's first load. Stored under `build:*`
// in chrome.storage.local via cache.js prefs.

import { getPref, setPref } from './cache.js';
import { RULES_DEFAULT } from './build-rules.js';

const PENDING_KEY = 'build:pending';
const PENDING_MAX_AGE_MS = 10 * 60 * 1000;

// Serialize read-modify-write (same idea as prefs.js): chrome.storage.local has no atomic
// update, so chain each op onto the previous one. A failed op must not wedge later ones.
let chain = Promise.resolve();
function enqueue(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

const deckKey = (publicId) => `build:${publicId}`;

export async function getDeckBuild(publicId) {
  const stored = (await getPref(deckKey(publicId), null)) || {};
  return {
    theme: stored.theme ?? null,
    rules: { ...RULES_DEFAULT, ...(stored.rules || {}) },
  };
}

/** Shallow-merge `patch` into the stored build; `patch.rules` is merged into stored rules. */
export function setDeckBuild(publicId, patch) {
  return enqueue(async () => {
    const stored = (await getPref(deckKey(publicId), null)) || {};
    const next = { ...stored, ...patch };
    if (patch && patch.rules) next.rules = { ...(stored.rules || {}), ...patch.rules };
    await setPref(deckKey(publicId), next);
  });
}

export function setPendingBuild({ commanders, theme }) {
  return enqueue(() => setPref(PENDING_KEY, { commanders, theme, at: Date.now() }));
}

/** Read the pending build WITHOUT consuming it (so a deck page can check the commander first). */
export async function peekPendingBuild() {
  const p = await getPref(PENDING_KEY, null);
  return p && Date.now() - p.at < PENDING_MAX_AGE_MS ? { commanders: p.commanders, theme: p.theme } : null;
}

/** Consume the pending build once. Null if absent or stale (a stale entry is removed too). */
export function takePendingBuild() {
  return enqueue(async () => {
    const p = await getPref(PENDING_KEY, null);
    if (!p) return null;
    await chrome.storage.local.remove(PENDING_KEY);
    if (!(Date.now() - p.at < PENDING_MAX_AGE_MS)) return null;
    return { commanders: p.commanders, theme: p.theme };
  });
}
