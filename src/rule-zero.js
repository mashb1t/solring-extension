// Builds a copy-to-clipboard, plain-text pre-game "Rule Zero" summary of a deck.
// Pure logic — no DOM, no chrome. Reads a Solring DeckFields object defensively:
// every field is optional, and a missing field drops its line/segment rather than
// printing "undefined".

import { csRatingGrade } from './ratings.js';
import { humanizeLabel } from './labels.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Most-severe-first ordering for anti-patterns (stable within a level).
const SEVERITY_RANK = { major: 3, notable: 2, minor: 1 };

export function buildRuleZeroText(fields, title) {
  const f = fields || {};
  const lines = [];

  // Line 1: "<title> — <commander>"
  const head = [title, f.commander].filter((s) => typeof s === 'string' && s.length);
  if (head.length) lines.push(head.join(' — '));

  // Line 2: Power · Bracket · Tier · archetype
  const l2 = [];
  if (isNum(f.power)) l2.push(`Power ${Number(f.power).toFixed(1)}/10`);
  if (isNum(f.bracketRealistic)) {
    let b = `Bracket ${f.bracketRealistic}`;
    if (isNum(f.bracketBaseline)) b += ` (baseline ${f.bracketBaseline})`;
    l2.push(b);
  }
  if (isNum(f.commanderTier)) l2.push(`Tier T${f.commanderTier}`);
  if (typeof f.archetype === 'string' && f.archetype.length) l2.push(humanizeLabel(f.archetype));
  if (l2.length) lines.push(l2.join(' · '));

  // Line 3: Salt grade [personality] · Combos count [pieces]
  const l3 = [];
  if (isNum(f.salt)) {
    let salt = `Salt: ${csRatingGrade(f.salt, 'saltRating')}`;
    if (f.saltPersonality && typeof f.saltPersonality.intensity === 'string' && f.saltPersonality.intensity.length) {
      salt += ` (${f.saltPersonality.intensity})`;
    }
    l3.push(salt);
  }
  if (Array.isArray(f.combos)) {
    let combos = `Combos: ${f.combos.length}`;
    if (f.combos.length && f.combos[0] && Array.isArray(f.combos[0].pieces) && f.combos[0].pieces.length) {
      combos += ` (${f.combos[0].pieces.map((p) => (typeof p === 'string' ? p : p.name)).join(' + ')})`;
    }
    l3.push(combos);
  }
  if (l3.length) lines.push(l3.join(' · '));

  // Line 4: anti-patterns, most severe first — only if present.
  const anti = f.powerProfile && Array.isArray(f.powerProfile.antiPatterns) ? f.powerProfile.antiPatterns : [];
  if (anti.length) {
    const ordered = anti
      .map((ap, i) => ({ ap, i }))
      .sort((a, b) => (SEVERITY_RANK[b.ap.severity] || 0) - (SEVERITY_RANK[a.ap.severity] || 0) || a.i - b.i)
      .map(({ ap }) => `${ap.label} (${ap.severity})`);
    lines.push(`Watch for: ${ordered.join(', ')}`);
  }

  // Footer: attribution + CommanderSalt link.
  let footer = 'via Solring';
  if (typeof f.deckId === 'string' && f.deckId.length) {
    footer += ` · commandersalt.com/details/deck/${f.deckId}`;
  }
  lines.push(footer);

  return lines.join('\n');
}
