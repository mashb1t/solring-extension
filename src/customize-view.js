// Inject Saltiness, Tags, and Stats checkboxes into Moxfield's Customize View
// "Include Extra Data" group. The modal mounts on demand, so we watch for it.
// Injection is idempotent. Toggles apply immediately (our global prefs are
// independent of Moxfield's own Save/Cancel).

import { el, registerDisposable } from './dom.js';
import { getCardPrefs, setCardPrefs } from './prefs.js';

const TOGGLES = [
  ['power', 'Power'],
  ['saltValue', 'Saltiness'],
  ['synergy', 'Synergy'],
  ['tags', 'Tags'],
  ['edhrec', 'EDHREC %'],
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

export async function injectInto(group) {
  // Claim the group SYNCHRONOUSLY before the await: the modal-mount observer fires
  // tryInject several times inside the getCardPrefs() await window, so a querySelector
  // sentinel checked before awaiting lets every call through and injects duplicates.
  if (group.dataset.solringCv || group.querySelector('.solring-cv')) return;
  group.dataset.solringCv = '1';
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
  // Router drains this on nav so the modal watcher doesn't outlive the deck page.
  registerDisposable(() => obs.disconnect());
}
