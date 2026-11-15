// TCGplayer land formula for a 99-card Commander deck (Frank Karsten, "How Many Lands Do You Need in
// Your Deck? An Updated Analysis", TCGplayer). Pure logic, no DOM:
//
//   lands = 31.42 + 3.13 × average mana value of the spells − 0.28 × cheap draw/ramp spells
//
// counting land/spell MDFCs partially (non-mythic 0.38, mythic 0.74 of a land), so MDFCs already in
// the deck cover part of the result. The classification rules below are the article's, verbatim,
// over Scryfall's lowercase Oracle text (all faces joined; the front face decides MV / land / creature).
// Cards are shaped Scryfall info (sources/scryfall.js shapeCards): { cmc, oracle, frontType,
// typeLine, layout, rarity }, optionally with a `qty`.

/** TCGplayer article the formula comes from (linked from the options page and the builder). */
export const LAND_FORMULA_URL = 'https://www.tcgplayer.com/content/article/How-Many-Lands-Do-You-Need-in-Your-Deck-An-Updated-Analysis/cd1c1a24-d439-4a8e-b369-b936edb0b38a/';
export const LAND_FORMULA_TEXT = 'lands = 31.42 + 3.13 × average mana value of your spells − 0.28 × cheap card draw / mana ramp spells';

export const FIXED_LANDS = 36;
const BASE = 31.42;
const PER_MV = 3.13;
const PER_CHEAP = 0.28;
const MDFC_LAND = 0.38;
const MDFC_LAND_MYTHIC = 0.74;

const DRAW = ['draw a card', 'draw two cards', 'draw three cards', 'draws cards', 'draws two cards', 'draws three cards'];
const DRAW_NOT = ['{4}', 'blood token', 'investigate'];

const front = (c) => String((c && (c.frontType || c.typeLine)) || '').split(' // ')[0];
const isLandType = (t) => /\bland\b/i.test(t);
const qtyOf = (c) => Math.max(1, (c && c.qty) || 1);

/** A land/spell modal DFC: a nonland front with a land face (Valki-style spell//spell MDFCs aren't). */
export function isMdfcLand(c) {
  if (!c || c.layout !== 'modal_dfc') return false;
  const faces = String(c.typeLine || '').split(' // ');
  return !isLandType(front(c)) && faces.slice(1).some(isLandType);
}

// "Any spell that cycles for one mana": a cycling cost of exactly one mana symbol (generic 1, a
// colour, colourless, hybrid or Phyrexian), not followed by another symbol. Any MV (the article's
// clause has no MV gate). {X}{1}{U}, {2} and "Cycling—Pay 2 life" don't count.
const ONE_MANA = /^(1|[wubrgc]|[wubrg]\/[wubrgp])$/;
function cyclesForOne(text) {
  for (const m of text.matchAll(/\b[a-z]*cycling \{([^}]+)\}(?!\{)/g)) if (ONE_MANA.test(m[1])) return true;
  return false;
}

/**
 * 'draw' | 'ramp' | null per the article. Lands and land/spell MDFCs (they already count as partial
 * lands; the article's examples exclude Tangled Florahedron) are never cheap spells. A card without
 * a numeric cmc or Oracle text has no data and is null.
 */
export function classifyCheap(card) {
  if (!card || typeof card.oracle !== 'string' || typeof card.cmc !== 'number' || !Number.isFinite(card.cmc)) return null;
  const ft = front(card);
  if (isLandType(ft) || isMdfcLand(card)) return null;
  const t = card.oracle.toLowerCase();
  const has = (s) => t.includes(s);
  const creature = /\bcreature\b/i.test(ft);
  const cheap = card.cmc <= 2;
  if (cheap) {
    if (DRAW.some(has) && !DRAW_NOT.some(has) && (!creature || (has('when') && has('enters')))) return 'draw';
    if (!creature && has('look') && has('library') && has('put') && has('your hand') && !has('pay ') && !has('pays')) return 'draw';
  }
  if (cyclesForOne(t)) return 'draw';
  if (!cheap) return null;
  if (has('add ') && !has('add its ability') && !has('add a lore counter') && !(creature && has('dies'))) return 'ramp';
  if (has('search') && has('your library') && (has('land') || has('basic')) && !has('sacrifice')) return 'ramp';
  if (has('enchanted land is tapped') && has('adds an additional')) return 'ramp';
  if (has('put a creature card with') && has('from your hand onto the battlefield')) return 'ramp';
  return null;
}

/**
 * Split the 99 (mainboard, commanders excluded) into the formula's inputs. `cards`:
 * [{ info, qty, isLand }] where info is the Scryfall shape (may be missing) and isLand the deck's own
 * front-face flag (the fallback when info is missing). MDFCs land in both lists (nonland for the
 * average, partial land for the credit).
 */
export function splitCards(cards) {
  const nonlands = []; const mdfcs = [];
  for (const c of cards || []) {
    if (!c) continue;
    const info = c.info || null;
    const qty = qtyOf(c);
    const land = info && front(info) ? isLandType(front(info)) : !!c.isLand;
    if (land) continue;
    nonlands.push({ ...(info || {}), qty });
    if (info && isMdfcLand(info)) mdfcs.push({ rarity: info.rarity, qty });
  }
  return { nonlands, mdfcs };
}

/**
 * { target, avgMv, cheap, raw, mdfcCredit, counted } — target is the whole number of real lands
 * (raw − MDFC credit, rounded once); null (with avgMv null) when no nonland card has a cmc.
 * Cards missing a cmc drop out of the average.
 */
export function landTarget({ nonlands = [], mdfcs = [] } = {}) {
  let mvSum = 0; let counted = 0; let cheap = 0;
  for (const c of nonlands) {
    const q = qtyOf(c);
    if (typeof c.cmc === 'number' && Number.isFinite(c.cmc)) { mvSum += c.cmc * q; counted += q; }
    if (classifyCheap(c)) cheap += q;
  }
  const mdfcCredit = mdfcs.reduce((s, m) => s + (m && m.rarity === 'mythic' ? MDFC_LAND_MYTHIC : MDFC_LAND) * qtyOf(m), 0);
  if (!counted) return { target: null, avgMv: null, cheap, raw: null, mdfcCredit, counted };
  const avgMv = mvSum / counted;
  const raw = BASE + PER_MV * avgMv - PER_CHEAP * cheap;
  return { target: Math.max(0, Math.round(raw - mdfcCredit)), avgMv, cheap, raw, mdfcCredit, counted };
}

const r2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
const r1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

/** "TCGplayer formula: 31.42 + 3.13 × 3.05 − 0.28 × 6 = 39.3 → 39" (− "0.38 MDFC" before the arrow when any). */
export function landBasis(r) {
  if (!r || r.target == null) return `TCGplayer formula: no mana values yet, using ${FIXED_LANDS}`;
  const credit = r.mdfcCredit > 0 ? ` − ${r2(r.mdfcCredit)} MDFC` : '';
  return `TCGplayer formula: ${BASE} + ${PER_MV} × ${r2(r.avgMv)} − ${PER_CHEAP} × ${r.cheap} = ${r1(r.raw)}${credit} → ${r.target}`;
}
