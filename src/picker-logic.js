// Pure helpers for the commander + playstyle picker (render-picker.js). No DOM, no chrome.*;
// unit-tested in test/picker-logic.test.js.

import { frontFace } from './sources/scryfall.js';

export const GROUP_MAX = 12;

// Short built-in explanations for common EDHREC playstyle slugs: EDHREC's own tag descriptions are
// mostly empty, so the ⓘ popover falls back to these, then to THEME_HELP_FALLBACK.
export const THEME_HELP_FALLBACK = "Playstyle from EDHREC's theme lists.";
export const THEME_HELP = {
  'group-hug': 'Helps every player: extra cards, mana and lands for the table, so nobody wants to attack you. Usually wins late through a combo or the table running out of cards.',
  'pillow-fort': 'Makes attacking you expensive or pointless (taxes, fog effects, blockers) while you build toward a win.',
  stax: 'Taxes and locks that slow every player down, while your deck is built to keep working under them.',
  control: 'Counters, removal and card advantage to answer threats, then win late with a few finishers.',
  combo: 'Assembles two or three cards that win on the spot or produce infinite value, with tutors and protection to find them.',
  voltron: 'Suits up one creature (usually the commander) with equipment and auras to win through commander damage.',
  aristocrats: 'Sacrifices creatures for value: death triggers drain opponents, draw cards or make more bodies.',
  tokens: 'Makes lots of creature tokens, then pumps them or uses them as sacrifice fodder.',
  spellslinger: 'Casts many instants and sorceries and gets rewarded for each one (copies, triggers, tokens).',
  cantrips: 'Cheap spells that replace themselves with a card, fuelling spell-count triggers.',
  'card-draw': 'Draws far more cards than the table and turns that card advantage into a win.',
  wheels: 'Everyone discards their hand and draws a new one, punishing opponents for drawing or emptying their hands.',
  midrange: 'Efficient creatures and interaction; flexible, neither all-in aggro nor slow control.',
  aggro: 'Fast, cheap threats that attack early and often before opponents set up.',
  ramp: 'Extra lands and mana early to cast big spells ahead of the curve.',
  landfall: 'Plays extra lands each turn and gets a trigger (tokens, damage, counters) every time a land enters.',
  lifegain: 'Gains life often and turns each gain into counters, cards, tokens or drain.',
  'plus-1-plus-1-counters': 'Spreads and multiplies +1/+1 counters to grow a board of large creatures.',
  counters: 'Puts and moves counters around (+1/+1, charge, loyalty) and doubles them.',
  proliferate: 'Adds one more of each counter that is already out: poison, loyalty, +1/+1 and more.',
  reanimator: 'Puts big creatures into the graveyard and brings them back cheaply.',
  'self-mill': 'Fills your own graveyard on purpose to fuel recursion and graveyard payoffs.',
  mill: "Wins by emptying opponents' libraries.",
  blink: 'Exiles and returns your creatures to reuse their enters-the-battlefield effects.',
  artifacts: 'Many artifacts with payoffs that care about casting or controlling them.',
  enchantress: 'Many enchantments; draws a card or gets value each time one is cast.',
  sacrifice: 'Sacrifices permanents as a resource for value or to drain opponents.',
  treasure: 'Makes Treasure tokens for ramp, then cashes them in for value.',
  equipment: 'Equipment-heavy: cheap equips and creatures that care about being equipped.',
  auras: 'Enchants creatures with auras and gets rewarded for each one.',
  graveyard: 'Uses the graveyard as a second hand: recursion, flashback, escape.',
  storm: 'Chains many spells in one turn and finishes with a storm count payoff.',
  burn: 'Direct damage to players and creatures as the main plan.',
  politics: 'Deals, votes and gifts that shape what the table does.',
  chaos: 'Random, swingy effects that shake up every game.',
  'big-mana': 'Generates huge amounts of mana for X spells and giant threats.',
  'extra-turns': 'Takes extra turns, often chaining them into a win.',
  infect: 'Wins through poison counters (infect, toxic, proliferate).',
  tribal: 'Built around one creature type and its lords and payoffs.',
  typal: 'Built around one creature type and its lords and payoffs.',
};

/** ⓘ popover text for a playstyle: EDHREC's description, else the built-in text, else the fallback. */
export function themeHelp(slug, description) {
  const d = typeof description === 'string' ? description.trim() : '';
  if (d) return d;
  return THEME_HELP[String(slug || '').toLowerCase()] || THEME_HELP_FALLBACK;
}

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
