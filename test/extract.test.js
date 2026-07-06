import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractDeck, extractHit, isStub, topThreats } from '../src/extract.js';

const deck = JSON.parse(readFileSync(new URL('../fixtures/deck_ojer.json', import.meta.url)));
const search = JSON.parse(readFileSync(new URL('../fixtures/search_mashb1t.json', import.meta.url)));

test('extractDeck pulls the displayed metrics', () => {
  const d = extractDeck(deck);
  assert.equal(d.deckId, '9bc8a6c2106583c1fd66e0492a3a5a26');
  assert.equal(Math.round(d.power * 10) / 10, 5.9);
  assert.equal(d.bracketRealistic, 3); // csBracket
  assert.equal(d.commanderTier, 4); // T4
  assert.equal(d.threat, 394.9);
  assert.equal(d.interaction, 197);
  assert.equal(d.wincons, 347.8); // comboRating
  assert.equal(d.synergy, 1787.3);
  assert.equal(d.salt, 130.5928003116271);
  assert.equal(d.archetype, 'MIDRANGE / COMBO');
  assert.equal(d.commander, 'Ojer Axonil, Deepest Might // Temple of Power');
  assert.equal(d.combosCount, 1); // deck-level Spellbook combo count (5th row-2 tile)
  assert.equal(d.powerScoreTotal, 789.8); // scoring.total — basis for per-card % + avg
  assert.equal(d.analyzedAt, 1780256803317); // ingestDate — for edit-detection re-analysis
});

test('extractDeck keeps all commanders for partner slugs', () => {
  const d = extractDeck(deck);
  assert.deepEqual(d.commanders, ['Ojer Axonil, Deepest Might // Temple of Power']);
});

test('extractDeck drops deck value; keeps both brackets (baseline only for the delta arrow)', () => {
  const d = extractDeck(deck);
  assert.equal(d.value, undefined);
  assert.equal(d.bracketRealistic, 3); // csBracket — the displayed number
  assert.equal(d.bracketBaseline, 3); // wotcBracket — drives the up/down arrow
});

test('extractDeck builds a per-card map (salt + prettified tags)', () => {
  const d = extractDeck(deck);
  const ojer = d.cards['ojer axonil, deepest might'];
  assert.equal(ojer.salt, 0);
  assert.deepEqual([...ojer.tags].sort(), ['burn', 'multiplier']);
  assert.equal(d.cards['gleeful arsonist'].salt, 5.5);
  assert.ok(d.cards['gleeful arsonist'].tags.includes('recursion'));
  assert.ok(d.cards['gleeful arsonist'].tags.includes('groupslug'));
});

test('extractDeck enriches cards with bracket flags + power/salt breakdowns', () => {
  const d = extractDeck(deck);
  const jw = d.cards["jeska's will"];
  assert.ok(jw, "expected Jeska's Will in the card map");
  assert.deepEqual([...jw.flags].sort(), ['Game Changer', 'cEDH staple']);
  const powerCats = jw.power.map((x) => x.cat);
  assert.ok(powerCats.includes('draw') && powerCats.includes('fastmana'), `power cats: ${powerCats}`);
  assert.ok(jw.saltBreakdown.length > 0);
  assert.ok(!jw.saltBreakdown.some((x) => x.cat === 'cardPrice'), 'cardPrice excluded from salt');
  assert.ok(jw.power.every((x) => typeof x.score === 'number'));
  // powerTotal = sum across every (deduped) category, so it's at least the top contributor.
  assert.equal(typeof jw.powerTotal, 'number');
  assert.ok(jw.powerTotal >= Math.max(...jw.power.map((x) => x.score)), `powerTotal ${jw.powerTotal}`);
});

test('extractDeck shapes the deck combo list for display', () => {
  const d = extractDeck(deck);
  assert.equal(d.combos.length, 1);
  const c = d.combos[0];
  assert.ok(c.pieces.includes('Pyrohemia'), `pieces: ${c.pieces}`);
  assert.equal(c.score, 25);
  assert.equal(Math.round(c.complexity * 100), 46); // bias.final
  assert.equal(c.extraMana, 1);
  assert.ok(c.categories.includes('infinite-damage'));
  assert.ok(c.needsBoard);
  assert.ok(c.prerequisites.length >= 1);
  assert.ok(c.steps.length >= 1 && c.steps.some((s) => s.payMana));
  assert.ok(c.produces.length >= 1);
  assert.ok(/commanderspellbook\.com/.test(c.spellbookUri));
});

test('extractDeck attaches synergy combos (anchors + score) to cards that have them', () => {
  const d = extractDeck(deck);
  const withCombos = Object.values(d.cards).filter((c) => c.combos && c.combos.anchors && c.combos.anchors.length > 0);
  assert.ok(withCombos.length > 0, 'expected at least one card with synergy combos');
  // synergy score = Σ conditionScoring.total (CommanderSalt's per-card anchor score)
  assert.ok(withCombos.every((c) => typeof c.combos.score === 'number'), 'every combo carries a numeric score');
  assert.ok(withCombos.some((c) => c.combos.score > 0), 'at least one card has a positive synergy score');
  const anchors = withCombos[0].combos.anchors;
  assert.ok(Array.isArray(anchors) && anchors.length > 0);
  // each anchor is { name, image } — image is the deck print, upgraded to the full card
  assert.ok(anchors.every((a) => typeof a.name === 'string' && a.name.length));
  const withImg = anchors.find((a) => a.image);
  assert.ok(withImg, 'expected at least one anchor with an image');
  assert.ok(withImg.image.includes('/normal/') && !withImg.image.includes('/border_crop/'));
});

test('extractDeck surfaces bracket coaching (rating + cards + profile lists)', () => {
  const d = extractDeck(deck);
  const bp = d.bracketProfile;
  assert.equal(typeof bp.rating, 'number'); // continuous bracket score behind the integer
  for (const k of ['rationale', 'soften', 'harden', 'ruleZero']) assert.ok(Array.isArray(bp[k]), `${k} is a list`);
  assert.ok(bp.rationale.length > 0 && bp.rationale[0].id, 'rationale entries carry an id');
  // category chips now carry the actual card names, not just a count
  const gc = d.bracketCategories.find((c) => c.key === 'gameChangers');
  assert.ok(gc && Array.isArray(gc.cards) && gc.cards.length === gc.count, 'gameChangers lists its cards');
  assert.ok(gc.cards.every((c) => c && typeof c.name === 'string' && c.name.length), 'cards are { name, image } with resolved names');
});

test('extractDeck surfaces power score drivers (boosts/penalties/anti-patterns)', () => {
  const d = extractDeck(deck);
  const pp = d.powerProfile;
  for (const k of ['boosts', 'penalties', 'antiPatterns', 'improve']) assert.ok(Array.isArray(pp[k]), `${k} is a list`);
  // boosts/penalties drop the "none" entries → only id+severity pairs remain
  assert.ok(pp.boosts.every((b) => b.id && b.severity && b.severity !== 'none'), 'boosts are non-none id/severity');
  assert.ok(pp.antiPatterns.every((a) => typeof a.label === 'string' && a.label.length), 'anti-patterns carry a server label');
});

test('extractDeck builds a power fingerprint with a derived tutor count', () => {
  const d = extractDeck(deck);
  const fp = d.powerFingerprint;
  assert.equal(typeof fp.tutors, 'number'); // count from scoring.tutors.list (no dedicated field)
  for (const k of ['ramp', 'creatures']) assert.ok(fp[k] == null || typeof fp[k] === 'number');
  if (fp.permanentRatio != null) assert.ok(fp.permanentRatio >= 0 && fp.permanentRatio <= 1);
});

test('synergy anchors carry an image (for the hover preview / link)', () => {
  const d = extractDeck(deck);
  if (d.synergyAnchors.length) {
    assert.ok(d.synergyAnchors.every((a) => typeof a.name === 'string' && a.name.length), 'anchors have names');
    assert.ok(d.synergyAnchors.some((a) => a.image), 'at least one anchor carries an image');
  }
});

test('extractDeck surfaces a wincon profile (paths + combo consistency)', () => {
  const d = extractDeck(deck);
  const wp = d.winconProfile;
  assert.ok(Array.isArray(wp.paths), 'paths is a list');
  assert.ok(wp.combos && typeof wp.combos === 'object', 'combo metrics present');
  // redundancy is a 0–1 fraction when present
  if (wp.combos.redundancy != null) assert.ok(wp.combos.redundancy >= 0 && wp.combos.redundancy <= 1);
});

test('power breakdown de-duplicates wincon_X into X (no doubles)', () => {
  const d = extractDeck(deck);
  const c = d.cards['agate instigator']; // appears in both `burn` and `wincon_burn`
  assert.ok(c, 'expected Agate Instigator in the card map');
  const cats = c.power.map((x) => x.cat);
  assert.ok(cats.includes('burn'));
  assert.ok(!cats.some((x) => x.startsWith('wincon')), `no wincon_ cats: ${cats}`);
  assert.equal(cats.filter((x) => x === 'burn').length, 1, 'burn appears once');
});

test('extractHit pulls per-row metrics from a search hit', () => {
  const h = extractHit(search.hits.find((x) => /ojer/i.test(x.title)));
  assert.equal(h.deckId, '9bc8a6c2106583c1fd66e0492a3a5a26');
  assert.equal(Math.round(h.power * 10) / 10, 5.9);
  assert.equal(h.salt, 130.5928003116271);
  assert.equal(h.archetypeMajor, 'MIDRANGE');
  assert.equal(h.isPrivate, false);
});

test('isStub detects unanalyzable payloads', () => {
  assert.equal(isStub(deck), false);
  assert.equal(isStub({ name: null, _cardCount: 0 }), true);
  assert.equal(isStub({ name: 'x', _cardCount: 0 }), true);
  assert.equal(isStub({}), true);
});

test('countDeckCombos tolerates non-string combo card ids', () => {
  // A malformed API combo (null / numeric entries in cards[]) must not crash extraction.
  const p = structuredClone(deck);
  p.details.combos.list[0].cards = [null, 123, 'pyrohemia'];
  assert.doesNotThrow(() => extractDeck(p));
});

test('extractDeck surfaces the new Phase-2 metric fields', () => {
  const d = extractDeck(deck);
  // 2.1 salt personality
  assert.equal(d.saltPersonality.headline, 'Punisher');
  assert.equal(d.saltPersonality.intensity, 'moderate');
  // 2.2/2.3/2.4 fingerprint additions
  assert.equal(d.powerFingerprint.cardAdvantage.draw, 'dense');
  assert.equal(d.powerFingerprint.resourceDenial.stax, 'light');
  assert.equal(d.powerFingerprint.graveyard.engagement, 'none');
  // 2.5 commander centricity
  assert.equal(d.synergyCentricity, 'detached');
  // 2.6 anti-pattern penalty (applied in this fixture)
  assert.ok(d.antiPatternPenalty && typeof d.antiPatternPenalty.cap === 'number');
  // 2.8 top threats: sorted desc by power contribution, capped, names present
  assert.ok(Array.isArray(d.threatTop) && d.threatTop.length > 0 && d.threatTop.length <= 8);
  assert.ok(typeof d.threatTop[0].name === 'string' && d.threatTop[0].score >= (d.threatTop[d.threatTop.length - 1].score));
});

test('topThreats orders by powerTotal desc and caps', () => {
  const cards = { a: { name: 'A', powerTotal: 3 }, b: { name: 'B', powerTotal: 10 }, c: { name: 'C', powerTotal: 0 } };
  const top = topThreats(cards);
  assert.deepEqual(top.map((t) => t.name), ['B', 'A']); // C dropped (0), B before A
});
