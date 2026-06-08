// Inject Salt Value / Tags / Stats checkboxes into Moxfield's
// Customize View → "Include Extra Data" group. The modal mounts on demand, so we
// watch for it; injection is idempotent. Toggles apply immediately (our global
// prefs are independent of Moxfield's own Save/Cancel).

import { el } from './dom.js';
import { getCardPrefs, setCardPrefs } from './prefs.js';

const TOGGLES = [
  ['power', 'Power'],
  ['saltValue', 'Salt Value'],
  ['tags', 'Tags'],
  ['stats', 'Stats'],
  ['combos', 'Combos'],
];

// Replicates Moxfield's Include-Extra-Data checkbox markup.
function checkbox(id, label, checked, onChange) {
  const input = el('input', {
    class: 'form-check-input me-2',
    attrs: { type: 'checkbox', id: `solring-${id}` },
  });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'radio-wrapper me-2 mb-2 solring-cv', attrs: { for: `solring-${id}` } }, [
    el('div', { class: 'form-check' }, [input, el('div', { class: 'form-check-label', text: label })]),
  ]);
}

async function injectInto(group) {
  if (group.querySelector('.solring-cv')) return; // already injected
  const prefs = await getCardPrefs();
  for (const [key, label] of TOGGLES) {
    group.append(checkbox(key, label, !!prefs[key], (val) => { setCardPrefs({ [key]: val }); }));
  }
}

function findExtraGroup(root) {
  const mana = root.querySelector('#include-mana');
  const lbl = mana && mana.closest('label');
  return lbl ? lbl.parentElement : null; // the "Include Extra Data" div.mb-3
}

/** Start watching for the Customize View modal and inject the toggles when it opens. */
export function installCustomizeViewToggles() {
  const tryInject = () => {
    const group = findExtraGroup(document);
    if (group) injectInto(group);
  };
  tryInject(); // in case it's already open
  const obs = new MutationObserver(tryInject);
  obs.observe(document.body, { childList: true, subtree: true });
  return obs;
}
