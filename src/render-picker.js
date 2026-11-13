// Guided Deck Builder entry point: a commander + playstyle picker injected into Moxfield's own UI.
//
// 1. "Create New Deck" dialog (opened from many routes): a "✨ Find with Solring" link under
//    Moxfield's Commander typeahead expands an inline picker between the Format/Commander row and
//    "Advanced options" (the modal widens while it's open). "Use" fills Moxfield's Name +
//    Commander (prefillNewDeck — never clicks Create) and saves a one-shot pending build that the
//    new deck's first load consumes (Task 10). The user clicks Moxfield's Create.
// 2. Deck view of a commander-less Commander deck: Moxfield shows an `.alert` with an
//    `a.alert-link` "Pick a Commander". The same link + picker sit there; "Use" sets the commander
//    through Moxfield's own Change Commander dialog (setCommanderViaBulk) and stores the theme.
//
// LIVE-VERIFY 2026-11-13 (Brave, Moxfield "Version 2026.11.13.2"): New-deck `.modal-body` holds
// `input#name[data-testid=deck-settings-page-name]`, a `.row` with Format + Commander columns (the
// Commander column's `.mb-3` is `text-nowrap`), then `details.details` "Advanced options". The
// Change Commander modal reuses the commander typeahead but has no name input, so it is skipped.
// Moxfield exposes no data-bs-theme; colours come from the --bs-* / --solring-* tokens.
//
// Fail-silent: every lookup is caught; stale responses are dropped by a sequence counter and a
// `node.isConnected` check. No innerHTML: all third-party text goes in via el()/textContent.

import { el, registerDisposable } from './dom.js';
import { getOptions } from './prefs.js';
import { getCardData, getBuildData } from './messaging.js';
import { setPendingBuild, setDeckBuild } from './build-store.js';
import { prefillNewDeck, setCommanderViaBulk } from './moxfield-ui.js';
import { parseDeckId } from './moxfield.js';
import { slugifyQuery, groupResults, namesNeedingInfo, applyInfo, deckName } from './picker-logic.js';

const DEBOUNCE_MS = 250;
const decks = (n) => `${Number(n || 0).toLocaleString('en-US')} decks`;
const MIN_QUERY = 2;
const LINK_LABEL = '✨ Find with Solring';
const CLOSE_LABEL = '✕ Close Solring picker';
const WIDE = 'solring-picker-wide';

let observer = null;
let rafId = 0;

const txt = (n) => (n && n.textContent ? n.textContent.replace(/\s+/g, ' ').trim() : '');
const btn = (props, children) => el('button', { ...props, attrs: { type: 'button', ...(props.attrs || {}) } }, children);

export function teardownPicker() {
  if (observer) { observer.disconnect(); observer = null; }
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  document.querySelectorAll('.solring-picker').forEach((n) => n.remove());
  document.querySelectorAll(`.${WIDE}`).forEach((n) => n.classList.remove(WIDE));
}

// `waitFor` is accepted for symmetry with the other installers; the picker self-detects via its observer.
export async function installPicker(_ctx = {}) {
  if (observer) return;
  const opts = await getOptions().catch(() => ({}));
  if (opts.sources && opts.sources.edhrec === false) return; // gated on the EDHREC source
  if (observer) return;
  observer = new MutationObserver((records) => {
    // Our own re-renders must not re-trigger a scan.
    if (records.every((r) => r.target.closest && r.target.closest('.solring-picker'))) return;
    if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; scan(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  registerDisposable(teardownPicker);
  scan();
}

function scan() {
  try {
    // New-deck dialog: a visible modal with Moxfield's deck-name input + commander typeahead.
    for (const modal of document.querySelectorAll('.modal.show')) {
      const name = modal.querySelector('input[data-testid="deck-settings-page-name"]');
      const cmd = modal.querySelector('input[data-testid="commander-search-input"]');
      if (name && cmd && !modal.querySelector('.solring-picker')) injectDialog(modal, cmd);
    }
    // Deck view, commander-less: the "Pick a Commander" alert.
    if (parseDeckId(location.href)) {
      const pick = [...document.querySelectorAll('.alert a.alert-link')].find((a) => /^pick a commander$/i.test(txt(a)));
      const alert = pick && pick.closest('.alert');
      if (alert && !alert.querySelector('.solring-picker')) injectAlert(alert);
    }
    // A deck-view panel whose alert is gone (commander set elsewhere) goes too.
    document.querySelectorAll('.solring-picker-panel[data-solring-anchor="alert"]').forEach((p) => {
      const prev = p.previousElementSibling;
      if (!prev || !prev.classList.contains('alert') || !prev.querySelector('.solring-picker')) p.remove();
    });
  } catch (e) {
    console.warn('[solring] picker scan failed', e);
  }
}

// ---------------------------------------------------------------------------------------------
// Entry points

function injectDialog(modal, cmdInput) {
  const body = modal.querySelector('.modal-body');
  const col = cmdInput.closest('.mb-3') || cmdInput.parentElement;
  if (!body || !col) return;
  const dialog = modal.querySelector('.modal-dialog');
  const link = btn({ class: 'solring-picker-link', text: LINK_LABEL });
  const msg = el('div', { class: 'solring-picker-msg', attrs: { role: 'status', hidden: '' } });
  const entry = el('div', { class: 'solring-picker solring-picker-entry' }, [link, msg]);
  col.append(entry);

  const picker = buildPicker({
    anchor: 'dialog',
    hint: "Fills Moxfield's Commander + Name; you still click Create.",
    onUse: async ({ commander, theme }) => {
      const ok = await prefillNewDeck({ name: deckName(commander, theme && theme.name), commander });
      await setPendingBuild({ commanders: [commander], theme: theme ? theme.slug : null }).catch(() => {});
      if (!entry.isConnected) return true;
      chosen = theme ? `✨ Playstyle: ${theme.name} · change` : '✨ No playstyle · change';
      setOpen(false);
      showMsg(msg, ok ? '' : "Couldn't fill Moxfield's Commander field — type it in, your playstyle is saved");
      return true;
    },
  });
  const details = body.querySelector('details');
  if (details && details.parentElement === body) body.insertBefore(picker.root, details);
  else body.append(picker.root);

  let chosen = null;
  const setOpen = (open) => {
    picker.setOpen(open);
    if (dialog) dialog.classList.toggle(WIDE, open);
    link.textContent = open ? CLOSE_LABEL : (chosen || LINK_LABEL);
    link.setAttribute('aria-expanded', String(open));
    if (open) showMsg(msg, '');
  };
  link.addEventListener('click', (e) => { e.preventDefault(); setOpen(!picker.isOpen()); });
  setOpen(false);
}

function injectAlert(alert) {
  const link = btn({ class: 'solring-picker-link solring-picker-link-inline', text: LINK_LABEL });
  const entry = el('span', { class: 'solring-picker solring-picker-entry' }, [link]);
  alert.append(entry);
  const msg = el('div', { class: 'solring-picker-msg', attrs: { role: 'status', hidden: '' } });

  const picker = buildPicker({
    anchor: 'alert',
    hint: "Sets the commander through Moxfield's Change Commander dialog.",
    onUse: async ({ commander, theme }) => {
      const publicId = parseDeckId(location.href);
      const res = await setCommanderViaBulk([commander]);
      if (res && res.ok) {
        if (publicId) await setDeckBuild(publicId, { theme: theme ? theme.slug : null }).catch(() => {});
        picker.root.remove();
        entry.remove();
        return true;
      }
      showMsg(msg, res && res.reason === 'not-editable'
        ? 'Open the deck logged in as its owner to set a commander'
        : "Couldn't set the commander through Moxfield — use “Pick a Commander”");
      return false;
    },
  });
  picker.root.append(msg);
  alert.insertAdjacentElement('afterend', picker.root);
  const setOpen = (open) => {
    picker.setOpen(open);
    link.textContent = open ? CLOSE_LABEL : LINK_LABEL;
    link.setAttribute('aria-expanded', String(open));
  };
  link.addEventListener('click', (e) => { e.preventDefault(); setOpen(!picker.isOpen()); });
  setOpen(false);
}

function showMsg(node, text) {
  node.textContent = text || '';
  if (text) node.removeAttribute('hidden'); else node.setAttribute('hidden', '');
}

// ---------------------------------------------------------------------------------------------
// The picker panel itself (shared by both entry points).

function buildPicker({ anchor, hint, onUse }) {
  let mode = 'name';
  let groups = [];
  let selected = null; // { name, image, colorIdentity, decks }
  let themes = null; // null = loading, [] = none
  let theme = null; // { slug, name, decks }
  let seq = 0;
  let themeSeq = 0;
  let timer = null;
  let busy = false;

  const modeName = btn({ class: 'solring-picker-mode', text: 'Name or theme' });
  const modeCard = btn({ class: 'solring-picker-mode', text: 'Build around a card' });
  const input = el('input', {
    class: 'form-control solring-picker-q',
    attrs: { type: 'search', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Find a commander' },
  });
  const left = el('div', { class: 'solring-picker-col solring-picker-cmds', attrs: { role: 'listbox', 'aria-label': 'Commanders' } });
  const right = el('div', { class: 'solring-picker-col solring-picker-plays' });
  const use = btn({ class: 'btn btn-primary btn-sm solring-picker-use', text: 'Use', attrs: { disabled: '' } });
  const root = el('div', { class: 'solring-picker solring-picker-panel', attrs: { 'data-solring-anchor': anchor, hidden: '' } }, [
    el('div', { class: 'solring-picker-head' }, [
      el('strong', { text: 'Find a commander' }),
      el('span', { class: 'solring-picker-modes', attrs: { role: 'group', 'aria-label': 'Search mode' } }, [modeName, modeCard]),
    ]),
    input,
    el('div', { class: 'solring-picker-cols' }, [left, right]),
    el('div', { class: 'solring-picker-foot' }, [el('span', { text: hint }), use]),
  ]);

  const setMode = (m) => {
    mode = m;
    modeName.classList.toggle('solring-on', m === 'name');
    modeCard.classList.toggle('solring-on', m === 'card');
    modeName.setAttribute('aria-pressed', String(m === 'name'));
    modeCard.setAttribute('aria-pressed', String(m === 'card'));
    input.placeholder = m === 'name'
      ? 'Commander name or a theme (Group Hug, Spellslinger…)'
      : 'A card to build around (Howling Mine…)';
    search();
  };
  modeName.addEventListener('click', () => setMode('name'));
  modeCard.addEventListener('click', () => setMode('card'));
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, DEBOUNCE_MS); });
  // Never let Enter submit Moxfield's form (it would create the deck).
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); clearTimeout(timer); search(); } });
  use.addEventListener('click', async () => {
    if (!selected || busy) return;
    busy = true;
    use.setAttribute('disabled', '');
    try { await onUse({ commander: selected.name, theme }); } catch { /* fail-silent */ }
    busy = false;
    if (root.isConnected) renderUse();
  });

  async function search() {
    const q = input.value.trim();
    const my = ++seq;
    if (q.length < MIN_QUERY) { groups = []; select(null); renderLeft(q ? '' : 'Type a commander, a theme, or a card.'); return; }
    renderLeft('Searching…');
    let next;
    if (mode === 'card') {
      const byCard = await getBuildData({ op: 'byCard', card: q }).catch(() => null);
      next = groupResults({ byCard: byCard || { miss: true }, label: q });
    } else {
      const slug = slugifyQuery(q);
      const [byName, byTheme] = await Promise.all([
        getCardData({ op: 'search', q }).catch(() => null),
        slug ? getBuildData({ op: 'byTheme', theme: slug }).catch(() => null) : null,
      ]);
      next = groupResults({ byName, byTheme, label: q });
    }
    if (my !== seq || !root.isConnected) return;
    groups = next;
    const keep = selected && groups.some((g) => g.items.some((i) => i.name === selected.name));
    renderLeft(groups.length ? '' : (mode === 'card' ? 'No commanders found for that card on EDHREC.' : 'No commanders found.'));
    if (!keep) select(groups.length ? groups[0].items[0] : null);
    // EDHREC-only rows lack art + colours: one Scryfall info batch for the visible names.
    const need = namesNeedingInfo(groups);
    if (!need.length) return;
    const res = await getCardData({ op: 'info', names: need }).catch(() => null);
    if (my !== seq || !root.isConnected || !res || !res.info) return;
    groups = applyInfo(groups, res.info);
    renderLeft('');
  }

  function select(item) {
    selected = item;
    theme = null;
    themes = item ? null : [];
    renderLeft(null);
    renderRight();
    renderUse();
    if (!item) return;
    const my = ++themeSeq;
    getBuildData({ op: 'themes', commanders: [item.name] }).catch(() => null).then((res) => {
      if (my !== themeSeq || !root.isConnected) return;
      themes = res && Array.isArray(res.themes) ? res.themes.filter((t) => t && t.slug) : [];
      theme = themes[0] || null;
      renderRight();
      renderUse();
    });
  }

  function renderLeft(status) {
    if (status === null) { // selection change only
      left.querySelectorAll('.solring-picker-cmd').forEach((n) => {
        const on = !!selected && n.dataset.name === selected.name;
        n.classList.toggle('solring-on', on);
        n.setAttribute('aria-selected', String(on));
      });
      return;
    }
    const kids = [];
    if (status) kids.push(el('div', { class: 'solring-picker-empty', text: status }));
    for (const g of groups) {
      kids.push(el('div', { class: 'solring-picker-colh', text: g.title }));
      for (const item of g.items) kids.push(cmdRow(item));
    }
    left.replaceChildren(...kids);
  }

  function cmdRow(item) {
    const on = !!selected && selected.name === item.name;
    const art = item.image
      ? el('img', { class: 'solring-picker-art', attrs: { src: item.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' } })
      : el('span', { class: 'solring-picker-art' });
    const meta = el('div', { class: 'solring-picker-meta' }, [
      pips(item.colorIdentity),
      item.decks != null ? el('span', { text: decks(item.decks) }) : null,
    ]);
    return el('div', {
      class: `solring-picker-cmd${on ? ' solring-on' : ''}`,
      attrs: { role: 'option', tabindex: '0', 'aria-selected': String(on), 'data-name': item.name },
      on: {
        click: () => select(item),
        keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(item); } },
      },
    }, [art, el('div', { class: 'solring-picker-cmdtext' }, [el('div', { class: 'solring-picker-name', text: item.name }), meta])]);
  }

  function renderRight() {
    const kids = [];
    if (!selected) {
      kids.push(el('div', { class: 'solring-picker-colh', text: 'Playstyles' }));
      kids.push(el('div', { class: 'solring-picker-empty', text: 'Pick a commander to see its playstyles.' }));
    } else {
      kids.push(el('div', { class: 'solring-picker-colh', text: `Playstyles · ${selected.name}` }));
      if (themes === null) kids.push(el('div', { class: 'solring-picker-empty', text: 'Loading playstyles…' }));
      else if (!themes.length) kids.push(el('div', { class: 'solring-picker-empty', text: 'No playstyles on EDHREC yet' }));
      else {
        const max = Math.max(1, ...themes.map((t) => t.decks || 0));
        for (const t of themes.slice(0, 12)) {
          const on = theme && theme.slug === t.slug;
          const fill = el('i');
          fill.style.width = `${Math.round(((t.decks || 0) / max) * 100)}%`;
          kids.push(btn({
            class: `solring-picker-play${on ? ' solring-on' : ''}`,
            attrs: { 'aria-pressed': String(!!on) },
            on: { click: () => { theme = t; renderRight(); renderUse(); } },
          }, [
            el('span', { class: 'solring-picker-playtext' }, [
              el('span', { text: t.name || t.slug }),
              el('span', { class: 'solring-picker-bar' }, [fill]),
            ]),
            el('small', { text: decks(t.decks) }),
          ]));
        }
      }
    }
    right.replaceChildren(...kids);
  }

  function renderUse() {
    if (!selected) { use.textContent = 'Use'; use.setAttribute('disabled', ''); return; }
    use.textContent = theme ? `Use ${selected.name} · ${theme.name}` : `Use ${selected.name}`;
    if (busy || themes === null) use.setAttribute('disabled', ''); else use.removeAttribute('disabled');
  }

  setMode('name');
  return {
    root,
    isOpen: () => !root.hasAttribute('hidden'),
    setOpen: (open) => {
      if (open) { root.removeAttribute('hidden'); input.focus(); } else root.setAttribute('hidden', '');
    },
  };
}

// Colour identity pips: Moxfield's own mana-symbol font classes when the page has them loaded,
// else small neutral lettered circles.
let manaFont = null;
function hasManaFont() {
  if (manaFont !== null) return manaFont;
  try {
    const probe = el('span', { class: 'mana mana-w', attrs: { 'aria-hidden': 'true' } });
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    document.body.append(probe);
    const content = getComputedStyle(probe, '::before').content;
    probe.remove();
    manaFont = !!content && content !== 'none' && content !== 'normal' && content !== '""';
  } catch { manaFont = false; }
  return manaFont;
}

function pips(ci) {
  if (!Array.isArray(ci)) return null;
  const colors = ci.length ? ci : ['C'];
  const font = hasManaFont();
  return el('span', { class: 'solring-picker-pips', attrs: { 'aria-label': `Colour identity ${colors.join('')}` } }, colors.map((c) => {
    const k = String(c).toLowerCase();
    return font
      ? el('span', { class: `mana mana-${k} mana-cost mana-shadow solring-picker-pip`, attrs: { 'aria-hidden': 'true' } })
      : el('span', { class: 'solring-picker-pip solring-picker-pip-plain', text: String(c).toUpperCase(), attrs: { 'aria-hidden': 'true' } });
  }));
}
