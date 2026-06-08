// CommanderSalt per-card stat-flag vocabulary → human-friendly tag labels.
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

// Bracket-relevant per-card flags (details.brackets.categories) → labels.
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
  cedhMetashare: 'cEDH meta',
  edhrec: 'EDHREC',
  cardPrice: 'price',
  manabase: 'manabase',
};

/** Label a power/salt scoring category for the per-card Stats detail. */
export function prettifyStat(cat) {
  if (Object.prototype.hasOwnProperty.call(STAT_LABELS, cat)) return STAT_LABELS[cat];
  return prettifyTag(cat);
}
