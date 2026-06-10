// Solring options page. Reads/writes the prefs:options store directly (this is an
// extension page, so chrome.storage + the src modules are available); open Moxfield
// tabs react via prefs.js onPrefChange('options'). Cache size/clear use cache.js.

import { getOptions, setOptions } from './src/prefs.js';
import { cachedBytes, clearCached } from './src/cache.js';

const $ = (id) => document.getElementById(id);

// Picker fallbacks shown when a color is unset (null = "use the themed default").
const COLORS = [
  { id: 'powerColor', def: '#8b5cf6', get: (o) => o.powerColor, set: (v) => setOptions({ powerColor: v }) },
  { id: 'saltColor', def: '#8b5cf6', get: (o) => o.saltColor, set: (v) => setOptions({ saltColor: v }) },
  { id: 'ratingA', def: '#b00020', get: (o) => o.ratingColors.a, set: (v) => setOptions({ ratingColors: { a: v } }) },
  { id: 'ratingB', def: '#d2691e', get: (o) => o.ratingColors.b, set: (v) => setOptions({ ratingColors: { b: v } }) },
  { id: 'ratingC', def: '#b8860b', get: (o) => o.ratingColors.c, set: (v) => setOptions({ ratingColors: { c: v } }) },
  { id: 'ratingD', def: '#1a7f37', get: (o) => o.ratingColors.d, set: (v) => setOptions({ ratingColors: { d: v } }) },
];

async function render() {
  const o = await getOptions();
  $('autoFetch').checked = o.autoFetch;
  $('cardPanelModal').checked = o.cardPanelModal;
  $('cardPanelSidebar').checked = o.cardPanelSidebar;
  $('powerThreshold').value = o.powerThreshold;
  $('saltThreshold').value = o.saltThreshold;
  $('cacheLifetimeDays').value = String(o.cacheLifetimeDays);
  $('deckPanelDefault').value = o.deckPanelDefault;
  for (const c of COLORS) {
    const v = c.get(o);
    $(c.id).value = v || c.def;
    $(`${c.id}-hex`).textContent = v || 'default';
  }
}

async function refreshCacheSize() {
  const { bytes, count } = await cachedBytes();
  const MB = 1024 * 1024;
  const QUOTA_MB = 10; // chrome.storage.local quota on Chrome ≥114 (older builds cap at 5 MB); the API doesn't expose it, so it's a constant
  const size = bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
  $('cacheSize').textContent = `${size} / ${QUOTA_MB} MB · ${count} cached ${count === 1 ? 'deck' : 'decks'}`;
}

function bind() {
  const onCheck = (id, key) => { $(id).addEventListener('change', () => setOptions({ [key]: $(id).checked })); };
  onCheck('autoFetch', 'autoFetch');
  onCheck('cardPanelModal', 'cardPanelModal');
  onCheck('cardPanelSidebar', 'cardPanelSidebar');

  const onNum = (id, key) => {
    $(id).addEventListener('change', () => {
      const v = parseFloat($(id).value);
      if (Number.isFinite(v)) setOptions({ [key]: v });
    });
  };
  onNum('powerThreshold', 'powerThreshold');
  onNum('saltThreshold', 'saltThreshold');

  $('cacheLifetimeDays').addEventListener('change', () => setOptions({ cacheLifetimeDays: Number($('cacheLifetimeDays').value) }));
  $('deckPanelDefault').addEventListener('change', () => setOptions({ deckPanelDefault: $('deckPanelDefault').value }));

  for (const c of COLORS) {
    const input = $(c.id);
    const hex = $(`${c.id}-hex`);
    input.addEventListener('input', () => { hex.textContent = input.value; }); // live preview while dragging
    input.addEventListener('change', () => c.set(input.value));
    document.querySelector(`.reset[data-for="${c.id}"]`).addEventListener('click', async () => {
      await c.set(null);
      render();
    });
  }

  $('clearCache').addEventListener('click', async () => {
    await clearCached();
    refreshCacheSize();
  });
}

bind();
render();
refreshCacheSize();
