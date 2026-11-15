// Cuts tab view state (recommendations.js). Pure. The tabs are clickable before the deck read +
// recs POST finish, so `cuts` is null while loading: an early click shows "Loading cuts…" and the
// grid renders when the data lands (if the Cuts tab is still active). [] is a real (empty) result.

/** → 'none' | 'loading' | 'render' for the Cuts view. */
export function cutsViewAction({ active, cuts, rendered }) {
  if (!active || rendered) return 'none';
  return Array.isArray(cuts) ? 'render' : 'loading';
}

/** The "We found N recommended cuts" count: shown cuts minus the ones removed since (flagged `removed`). */
export function cutsCount(cuts) {
  return Array.isArray(cuts) ? cuts.filter((c) => c && !c.removed).length : 0;
}
