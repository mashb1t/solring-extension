// EDHREC data for the Guided Deck Builder. Worker-only (imported by the background service
// worker). json.edhrec.com serves ACAO:* so no host_permissions; GETs must be SIMPLE requests
// (no custom headers) or EDHREC's CORS preflight answers 403.

import { commanderSlug } from './edhrec.js';

const frontFace = (name) => String(name).split(' // ')[0].toLowerCase().trim();

const cardlistsOf = (json) => (
  (json && json.container && json.container.json_dict && json.container.json_dict.cardlists) || []
);

// GET https://json.edhrec.com/pages/<path>.json. null on any failure (fail-silent).
export async function fetchEdhrecPage(path) {
  let r;
  try { r = await fetch(`https://json.edhrec.com/pages/${path}.json`); }
  catch { return null; }
  if (!r.ok) return null;
  const json = await r.json().catch(() => null);
  return json && typeof json === 'object' ? json : null;
}

// A commander page's playstyle tags (panels.taglinks), most-played first.
export function themesOf(json) {
  const links = (json && json.panels && json.panels.taglinks) || [];
  return links
    .filter((t) => t && t.slug)
    .map((t) => ({ slug: t.slug, name: t.value, decks: t.count || 0 }))
    .sort((a, b) => b.decks - a.decks);
}

// Flatten a commander+theme page's cardlists (minus "New Cards": recency, not staple-ness),
// one entry per front face keeping the highest synergy.
export function themeCards(json) {
  const byFace = new Map();
  for (const list of cardlistsOf(json)) {
    if (!list || list.header === 'New Cards') continue;
    for (const c of (list.cardviews || [])) {
      if (!c || !c.name) continue;
      const key = frontFace(c.name);
      const synergy = Number.isFinite(c.synergy) ? c.synergy : 0;
      const prev = byFace.get(key);
      if (prev && prev.synergy >= synergy) continue;
      const decks = c.num_decks != null ? c.num_decks : c.inclusion;
      const inclusionPct = c.potential_decks > 0 ? Math.round((decks / c.potential_decks) * 100) : 0;
      byFace.set(key, { name: c.name, synergy, inclusionPct, list: list.header });
    }
  }
  return [...byFace.values()];
}

// The "Top Commanders" list of a tag page or a card page.
export function topCommanders(json) {
  const list = cardlistsOf(json).find((l) => l && l.header === 'Top Commanders');
  return ((list && list.cardviews) || [])
    .filter((c) => c && c.name)
    .map((c) => ({ name: c.name, decks: c.num_decks || 0 }));
}

// Single card name → EDHREC page slug (same normalization as commanders).
export const cardSlug = (name) => commanderSlug([name]);

