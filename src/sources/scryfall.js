// Scryfall data for the Guided Deck Builder. Worker-only (imported by the background service
// worker). api.scryfall.com serves ACAO:* so no host_permissions. Etiquette: requests are
// sequential and at least 100 ms apart. Fail-silent: failures yield []/{}/null, never throw.

const API = 'https://api.scryfall.com';
const BATCH = 75;
const DELAY_MS = 100;

export const frontFace = (name) => String(name).split(' // ')[0].toLowerCase().trim();
const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

const imageOf = (c) => {
  const i = c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris);
  return (i && (i.normal || i.small)) || null;
};

async function getJson(url) {
  let r;
  try { r = await fetch(url); } catch { return null; }
  if (!r.ok) return null;
  const json = await r.json().catch(() => null);
  return json && typeof json === 'object' ? json : null;
}

// Scryfall query for the picker. A single word also matches the type line, so a creature type
// ("Fairy", "Faeries") finds its commanders; plurals are singularised for t: (Scryfall types are singular).
const TYPE_ALIAS = { fairy: 'Faerie', fairies: 'Faerie', fae: 'Faerie', elves: 'Elf', dwarves: 'Dwarf', wolves: 'Wolf' };
export function commanderQuery(q) {
  const s = String(q || '').trim();
  if (!/^[a-z-]+$/i.test(s)) return `is:commander ${s}`;
  const one = TYPE_ALIAS[s.toLowerCase()] || s.replace(/([^s])s$/i, '$1');
  return `is:commander (${s} or t:${one})`;
}

// Commander picker search: first page, EDHREC-popularity order. [] on failure.
export async function searchCommanders(q) {
  const query = commanderQuery(q);
  const json = await getJson(`${API}/cards/search?q=${encodeURIComponent(query)}&order=edhrec`);
  return ((json && json.data) || []).map((c) => ({
    name: c.name,
    colorIdentity: c.color_identity || [],
    image: imageOf(c),
  }));
}

// /cards/collection response → { frontKey: {name, usd, eur, tix, gameChanger, colorIdentity, typeLine,
// frontType, cmc, oracle, layout, rarity, image} }. Prices are number|null; the builder picks one per
// the user's provider (pricing.js). cmc is Scryfall's (a DFC's front face; null when absent); oracle
// joins every face's text with "\n" (a DFC has no top-level oracle_text); frontType is the front
// face's type line (the land/creature decision for the Karsten land formula, land-formula.js).
const priceField = (c, k) => {
  const v = c.prices && c.prices[k] != null ? Number(c.prices[k]) : NaN;
  return Number.isFinite(v) ? v : null;
};

const oracleOf = (c) => (typeof c.oracle_text === 'string' ? c.oracle_text
  : (c.card_faces || []).map((f) => (f && f.oracle_text) || '').filter(Boolean).join('\n'));

export function shapeCards(json) {
  const out = {};
  for (const c of (json && Array.isArray(json.data) ? json.data : [])) {
    if (!c || !c.name) continue;
    out[frontFace(c.name)] = {
      name: c.name,
      usd: priceField(c, 'usd'),
      eur: priceField(c, 'eur'),
      tix: priceField(c, 'tix'),
      gameChanger: c.game_changer === true,
      colorIdentity: c.color_identity || [],
      typeLine: c.type_line || '',
      frontType: String((c.card_faces && c.card_faces[0] && c.card_faces[0].type_line) || c.type_line || '').split(' // ')[0],
      cmc: typeof c.cmc === 'number' && Number.isFinite(c.cmc) ? c.cmc : null,
      oracle: oracleOf(c),
      layout: c.layout || '',
      rarity: c.rarity || '',
      image: imageOf(c),
    };
  }
  return out;
}

// Pure: map one successful /cards/collection response back onto the REQUESTED names.
// Returns { info: {requestedKey: card}, notFound: [requestedKey] }. A requested name whose
// returned name differs (renamed / alt spelling) is matched by full lowercase name; names that
// resolve neither way are left out of both (unknown, so callers must not cache them).
export function resolveRequested(requested, json) {
  const shaped = shapeCards(json);
  const nf = new Set(((json && json.not_found) || []).map((i) => i && i.name && frontFace(i.name)).filter(Boolean));
  const byFull = {};
  for (const c of Object.values(shaped)) byFull[String(c.name).toLowerCase().trim()] = c;
  const info = {};
  const notFound = [];
  for (const name of requested) {
    const key = frontFace(name);
    const hit = shaped[key] || byFull[String(name).toLowerCase().trim()];
    if (hit) info[key] = hit;
    else if (nf.has(key)) notFound.push(key);
  }
  return { info, notFound };
}

// Price / Game Changer / colors for card names, in sequential batches of 75, keyed by the
// REQUESTED front-face key. Also reports `notFound` keys (Scryfall said so). A failed batch
// contributes to neither (network error, not "not found"). opts.delayMs overrides the pause.
export async function fetchCardLookup(names, { delayMs = DELAY_MS } = {}) {
  const info = {};
  const notFound = [];
  const list = [...new Set((names || []).filter(Boolean))];
  for (let i = 0; i < list.length; i += BATCH) {
    if (i > 0) await sleep(delayMs);
    const batch = list.slice(i, i + BATCH);
    let json = null;
    try {
      const r = await fetch(`${API}/cards/collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Front face only: /cards/collection misses many full "A // B" names (e.g. modal DFCs,
        // "Fire // Ice") but resolves every layout by its front-face name (LIVE-VERIFY 2026-11-15).
        body: JSON.stringify({ identifiers: batch.map((name) => ({ name: String(name).split(' // ')[0].trim() })) }),
      });
      if (r.ok) json = await r.json().catch(() => null);
    } catch { /* skip batch */ }
    if (!json) continue;
    const res = resolveRequested(batch, json);
    Object.assign(info, res.info);
    notFound.push(...res.notFound);
  }
  return { info, notFound };
}

export async function fetchCardInfo(names, opts) {
  return (await fetchCardLookup(names, opts)).info;
}

const FLAG_QUERIES = {
  gameChangers: 'is:gamechanger',
  extraTurns: 'otag:extra-turn',
  massLandDenial: 'otag:mass-land-denial',
};

// Front-face keys for every result of a search, following next_page. null if any page fails.
async function searchAllKeys(q, delayMs) {
  const keys = new Set();
  let url = `${API}/cards/search?q=${encodeURIComponent(q)}`;
  for (let pages = 0; url && pages < 20; pages++) {
    if (pages > 0) await sleep(delayMs);
    const json = await getJson(url);
    if (!json) return null;
    for (const c of (json.data || [])) if (c && c.name) keys.add(frontFace(c.name));
    url = json.has_more ? json.next_page : null;
  }
  return keys;
}

// Bracket flag lists. Returns null if any query fails, so callers never cache a partial list.
export async function fetchFlagSets({ delayMs = DELAY_MS } = {}) {
  const out = {};
  let first = true;
  for (const [name, q] of Object.entries(FLAG_QUERIES)) {
    if (!first) await sleep(delayMs);
    first = false;
    const keys = await searchAllKeys(q, delayMs);
    if (!keys) return null;
    out[name] = keys;
  }
  return out;
}
