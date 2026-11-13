// Pure helpers for the commander + playstyle picker (render-picker.js). No DOM, no chrome.*;
// unit-tested in test/picker-logic.test.js.

import { frontFace } from './sources/scryfall.js';

export const GROUP_MAX = 12;

/** Free-text query → EDHREC tag slug guess: lowercase, runs of non-alphanumerics → '-', trimmed. */
export function slugifyQuery(q) {
  return String(q ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "group hug" → "Group Hug" (display label for a theme typed by the user). */
export function titleCase(q) {
  return String(q ?? '').trim().replace(/\s+/g, ' ').replace(/(^|[\s/-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

const listOf = (res) => (res && !res.miss && !res.error && Array.isArray(res.commanders) ? res.commanders : []);

/**
 * Merge the "Name or theme" lookups into display groups. Theme matches (EDHREC tag page) come
 * first when the tag lookup hit, then Scryfall name matches. A commander already listed in an
 * earlier group is dropped from later ones (front-face match). Each group capped at `max`.
 * Empty groups are omitted.
 * @param {{byTheme?:object, byName?:object, byCard?:object, label?:string, max?:number}} p
 *   byTheme/byCard: `{commanders:[{name, decks}]}` | `{miss}`; byName: `{commanders:[{name, colorIdentity, image}]}`.
 * @returns {{title:string, items:{name:string, decks:number|null, colorIdentity:string[]|null, image:string|null}[]}[]}
 */
export function groupResults({ byTheme, byName, byCard, label = '', max = GROUP_MAX } = {}) {
  const seen = new Set();
  const groups = [];
  const add = (title, list) => {
    const items = [];
    for (const c of list) {
      if (!c || !c.name || items.length >= max) continue;
      const key = frontFace(c.name);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        name: c.name,
        decks: Number.isFinite(c.decks) ? c.decks : null,
        colorIdentity: Array.isArray(c.colorIdentity) ? c.colorIdentity : null,
        image: c.image || null,
      });
    }
    if (items.length) groups.push({ title, items });
  };
  const shown = titleCase(label);
  if (byCard !== undefined) add(`Commanders · build around “${shown}”`, listOf(byCard));
  add(`Commanders · theme “${shown}”`, listOf(byTheme));
  add('Commanders · by name', listOf(byName));
  return groups;
}

/** Names in `groups` still missing art or colour identity (need a Scryfall info batch). */
export function namesNeedingInfo(groups) {
  return (groups || []).flatMap((g) => g.items).filter((i) => !i.image || !i.colorIdentity).map((i) => i.name);
}

/** Fill image/colorIdentity from a `getCardData({op:'info'})` map keyed by front face. Returns new groups. */
export function applyInfo(groups, info) {
  const map = info || {};
  return (groups || []).map((g) => ({
    ...g,
    items: g.items.map((i) => {
      const c = map[frontFace(i.name)];
      if (!c) return i;
      return { ...i, image: i.image || c.image || null, colorIdentity: i.colorIdentity || c.colorIdentity || null };
    }),
  }));
}

/** Deck name for the New-deck dialog: "{commander} – {theme}", or just the commander. */
export function deckName(commander, themeName) {
  return themeName ? `${commander} – ${themeName}` : String(commander);
}
