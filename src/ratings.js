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
