// Maps CommanderSalt per-card stat flags to human-friendly tag labels.
// Flags not listed pass through unchanged (e.g. "burn", "stax", "ramp").

export const TAG_LABELS = {
  boardWipes: 'boardwipe',
  costReduction: 'cost↓',
  counterspell: 'counter',
  fastmana: 'fast mana',
  landsmatter: 'lands matter',
  manafixing: 'mana fixing',
  multipliers: 'multiplier',
  otherControl: 'control',
  plusOnePlusOneCounters: '+1/+1 counters',
  spotRemoval: 'removal',
};

export function prettifyTag(flag) {
  return Object.prototype.hasOwnProperty.call(TAG_LABELS, flag) ? TAG_LABELS[flag] : flag;
}

// Bracket-relevant per-card flags (details.brackets.categories) to labels.
export const BRACKET_FLAG_LABELS = {
  gameChangers: 'Game Changer',
  cedhStaples: 'cEDH staple',
  massLandDenial: 'Mass Land Denial',
  extraTurns: 'Extra Turns',
  earlyGameInfiniteCombos: 'Early-game combo',
  restock: 'Restock',
};

// Salt-scoring category labels (details.salt.scoring). Power categories reuse TAG_LABELS.
const STAT_LABELS = {
  cedhMetashare: 'CEDH',
  edhrec: 'EDHREC',
  payTheOne: 'pay the 1?',
  groupSlug: 'group slug',
  boardwipes: 'boardwipe',
  cantGainLife: 'no lifegain',
  infiniteCombos: 'combos',
  cardPrice: 'price',
  manabase: 'manabase',
};

/** Label a power/salt scoring category for the per-card Stats detail. */
export function prettifyStat(cat) {
  if (Object.prototype.hasOwnProperty.call(STAT_LABELS, cat)) return STAT_LABELS[cat];
  return prettifyTag(cat);
}

// Compound tokens that neither camelCase-splitting nor title-casing can recover
// (all-caps run-ons, or ones needing punctuation). Keyed by the token lowercased with
// all non-alphanumerics stripped, so "PLUSONEPLUSONECOUNTERS" and "plusOnePlusOne" both hit.
const COMPOUND_LABELS = {
  plusoneplusonecounters: '+1/+1 Counters',
  groupslug: 'Group Slug',
  grouphug: 'Group Hug',
  landsmatter: 'Lands Matter',
  landdestruction: 'Land Destruction',
  aristocrats: 'Aristocrats',
  superfriends: 'Superfriends',
  voltron: 'Voltron',
};

/** A scorer id or enum token → readable words. Order: known compound → all-caps token
    (title-case the whole run) → camelCase/snake/kebab (split on boundaries). Used for
    scorer signal ids, suggestion reasons, and archetype tokens. */
export function humanizeId(id) {
  const raw = String(id).trim();
  if (!raw) return raw;
  const norm = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (Object.prototype.hasOwnProperty.call(COMPOUND_LABELS, norm)) return COMPOUND_LABELS[norm];
  // A single all-caps run ("MIDRANGE", "COMBO"): title-case the whole word — the
  // camelCase splitter would otherwise explode it letter by letter.
  if (/^[A-Z0-9]+$/.test(raw)) return raw.charAt(0) + raw.slice(1).toLowerCase();
  const s = raw.replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A display label that may join tokens with " / " (archetype strings like
    "MIDRANGE / PLUSONEPLUSONECOUNTERS"). Humanizes each token, preserving the separator. */
export function humanizeLabel(str) {
  if (str == null) return str;
  return String(str).split('/').map((t) => humanizeId(t)).join(' / ');
}

/** Humanize a value only when it looks like a camelCase/all-caps identifier
    ("winconInconsistency" → "wincon inconsistency"); pass normal text/numbers through. */
export function humanizeValueMaybe(v) {
  if (typeof v === 'string' && /^[A-Za-z]+$/.test(v) && /[A-Z]/.test(v)) return humanizeId(v).toLowerCase();
  return v;
}
