// Inject an always-shown "CommanderSalt" link into Moxfield's deck links row
// (next to Advanced / EDHRecs / Tips). Anchored off the "Advanced" link, which
// is present regardless of login state. Marked data-solring-root so the router's
// teardown removes it on navigation (re-injected per deck with the right md5).

import { el } from './dom.js';

const CS_URL = (md5) => `https://commandersalt.com/details/deck/${md5}`;

function findAnchor() {
  return [...document.querySelectorAll('a, button')]
    .find((e) => /^(EDHRec|EDHRecs|Advanced)$/i.test((e.textContent || '').trim()));
}

export function installCommanderSaltLink(md5) {
  const tryInject = () => {
    if (document.querySelector('.solring-cs-link')) return true;
    const anchor = findAnchor();
    if (!anchor) return false;
    const link = el('a', {
      class: `${anchor.className} solring-cs-link`,
      text: 'CommanderSalt',
      attrs: { href: CS_URL(md5), target: '_blank', rel: 'noopener', 'data-solring-root': '' },
    });
    const sep = el('span', { class: 'solring-cs-sep', text: ' · ', attrs: { 'data-solring-root': '' } });
    anchor.insertAdjacentElement('afterend', link);
    link.insertAdjacentElement('beforebegin', sep); // "EDHRecs · CommanderSalt"
    return true;
  };
  if (tryInject()) return null;
  const obs = new MutationObserver(() => { if (tryInject()) obs.disconnect(); });
  obs.observe(document.body, { childList: true, subtree: true });
  return obs;
}
