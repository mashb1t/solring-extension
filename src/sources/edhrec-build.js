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

// A tag page's `description` → plain text for the picker's playstyle ⓘ popover: HTML tags dropped,
// common entities decoded, whitespace collapsed, capped at ~300 chars on a word boundary ('…').
// '' when the page has none (EDHREC currently leaves most tag descriptions empty).
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…' };
export const THEME_DESC_MAX = 300;
export function themeDescription(json) {
  const raw = json && typeof json.description === 'string' ? json.description : '';
  let t = raw.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e) => {
      const k = e.toLowerCase();
      if (k in ENTITIES) return ENTITIES[k];
      if (k[0] === '#') { const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '; }
      return m;
    })
    .replace(/\s+/g, ' ').trim();
  if (t.length > THEME_DESC_MAX) {
    const cut = t.slice(0, THEME_DESC_MAX - 1);
    const sp = cut.lastIndexOf(' ');
    t = `${(sp > THEME_DESC_MAX * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–—-]+$/, '')}…`;
  }
  return t;
}
