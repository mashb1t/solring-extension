// Idempotent DOM-injection helpers shared by all render modules. Everything is
// guarded so a repeated router pass (SPA re-render) never duplicates nodes, and
// nothing thrown here is allowed to bubble into Moxfield's page.

/** Build an element. props: {class, text, html, title, attrs:{}, on:{}, style}. */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text != null) node.textContent = props.text;
  if (props.html != null) node.innerHTML = props.html;
  if (props.title) node.title = props.title;
  if (props.style) node.setAttribute('style', props.style);
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) if (v != null) node.setAttribute(k, v);
  if (props.on) for (const [k, v] of Object.entries(props.on)) node.addEventListener(k, v);
  for (const c of [].concat(children)) if (c != null) node.append(c);
  return node;
}

/** Returns true once per (node, key); marks the node so repeated calls no-op. */
export function claim(node, key) {
  const set = (node.dataset.solring || '').split(' ').filter(Boolean);
  if (set.includes(key)) return false;
  set.push(key);
  node.dataset.solring = set.join(' ');
  return true;
}

/** Remove all injected roots carrying [data-solring-root]. */
export function teardown(root = document) {
  root.querySelectorAll('[data-solring-root]').forEach((n) => n.remove());
}

/** Detect Moxfield's active theme. This build exposes no data-bs-theme, so the
    reliable signal is the body's background luminance; attr/media are hints. */
export function isDark() {
  const t = document.documentElement.getAttribute('data-bs-theme')
    || document.body.getAttribute('data-bs-theme');
  if (t) return t === 'dark';
  if (document.documentElement.classList.contains('theme-dark')) return true;
  const bg = getComputedStyle(document.body).backgroundColor;
  const m = bg && bg.match(/\d+(\.\d+)?/g);
  if (m && m.length >= 3) {
    const [r, g, b] = m.map(Number);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
  }
  if (window.matchMedia) return window.matchMedia('(prefers-color-scheme: dark)').matches;
  return false;
}

// CommanderSalt grades run A–D only (no E/F), HIGH is bad. The color tier is
// just the grade letter (a–d); CSS colors a=red (worst) … d=green (best).
export function tierFromGrade(grade) {
  const letter = (grade.trim()[0] || '').toLowerCase();
  return ['a', 'b', 'c', 'd'].includes(letter) ? letter : 'c';
}

/** Run fn, swallowing+logging any error so Moxfield's page is never broken. */
export function guard(label, fn) {
  try {
    return fn();
  } catch (err) {
    console.warn(`[solring] ${label} failed:`, err);
    return undefined;
  }
}
