// CommanderSalt report-card grading — ported 1:1 from their client-side bundle
// (reverse-engineered in the Solring prototype's ratings.js).
//   pct  = min(value / CEILING[field], 1) * 100
//   grade = fixed 12-step ladder (floor "D–", there is NO "F")
// Verified against the live page for deck 9bc8a6c…:
//   Saltiness 130.6/300 → C+   Interaction 197/400 → B–
//   Wincons  347.8/300 → A+    Synergy   1787.3/2500 → B+

// field → ceiling ("high")
export const CS_RATING_HIGH = {
  saltRating: 300,
  interactionRating: 400,
  comboRating: 300, // "Wincons"
  powerLevelRating: 10,
  synergyRating: 2500,
  threatRating: 500,
};

// pct → letter; first threshold the pct is BELOW wins. Minus sign is U+2013.
const GRADE_LADDER = [
  [2, 'D–'], [5, 'D'], [15, 'D+'], [25, 'C–'], [35, 'C'], [45, 'C+'],
  [55, 'B–'], [65, 'B'], [75, 'B+'], [85, 'A–'], [95, 'A'], [Infinity, 'A+'],
];

export function csRatingPct(value, field) {
  const high = CS_RATING_HIGH[field];
  const v = parseFloat(value);
  if (!high || !isFinite(v)) return 0;
  return v >= high ? 100 : (v / high) * 100;
}

export function csGradeFromPct(pct) {
  for (let i = 0; i < GRADE_LADDER.length; i += 1) {
    if (pct < GRADE_LADDER[i][0]) return GRADE_LADDER[i][1];
  }
  return 'A+';
}

export function csRatingGrade(value, field) {
  return csGradeFromPct(csRatingPct(value, field));
}

// ---- per-card ranking: which cards to color, and how ----
// Saltiness and power are colored differently because the metrics differ in kind:
//   • per-card salt is roughly intrinsic and bimodal (a cluster ~5–9, a gap at 3–5,
//     and the bulk near 0) → a flat cutoff travels across decks.
//   • per-card power is deck-relative and unbounded (a card's share of the deck's
//     total) → the cutoff is a multiple of the deck average.
// Tier 'a' is the red flag in both cases (the extension's worst/most-extreme color).

// Per-card saltiness on the A–D ramp (high = bad). 'a' (>=5) is the salty cluster.
export function saltTier(salt) {
  if (typeof salt !== 'number') return null;
  if (salt >= 5) return 'a';
  if (salt >= 3) return 'b';
  if (salt >= 1.5) return 'c';
  return 'd';
}

// Power contribution is flagged ('a', red) only when it exceeds this multiple of
// the deck's average per-card power.
export const POWER_MARK_MULTIPLE = 2;

// Per-card power tier: 'a' (red) when the card contributes more than 2× the deck
// average, otherwise null (no highlight — low power is never "bad").
export function powerTier(powerTotal, avgPower) {
  if (typeof powerTotal !== 'number' || !(avgPower > 0)) return null;
  return powerTotal > avgPower * POWER_MARK_MULTIPLE ? 'a' : null;
}

// Deck's average per-card power, from the authoritative scoring.total when present
// (extracted as powerScoreTotal), else summing the per-card contributions.
export function deckAvgPower(cards, powerScoreTotal) {
  const ids = Object.keys(cards || {});
  if (!ids.length) return 0;
  let sum = 0;
  for (const k of ids) sum += cards[k].powerTotal || 0;
  return (powerScoreTotal || sum) / ids.length;
}

// ---- per-card "marks" (which cards to highlight) — thresholds configurable ----
// A mark is decoupled from the A–D grade ramp: power/salt get their own threshold
// + color, applied to the decklist columns and the modal/sidebar tiles. Defaults
// below; the options panel overrides the threshold per call.
export const SALT_MARK_THRESHOLD = 5; // mark saltiness at/above this (absolute)

// Power is a standout when it exceeds `multiple`× the deck's average per-card power.
export function powerMark(powerTotal, avgPower, multiple = POWER_MARK_MULTIPLE) {
  return typeof powerTotal === 'number' && avgPower > 0 && powerTotal > avgPower * multiple;
}

// Saltiness is a standout at/above the threshold.
export function saltMark(salt, threshold = SALT_MARK_THRESHOLD) {
  return typeof salt === 'number' && salt >= threshold;
}
