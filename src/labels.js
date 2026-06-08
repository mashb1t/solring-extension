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
