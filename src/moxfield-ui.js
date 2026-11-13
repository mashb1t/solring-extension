import { frontFace } from './sources/scryfall.js';

// One bulk-edit line: "<qty>[x] <name>[ (SET) num][ *F*][ #tag…]".
// Returns { qty, key } or null for anything that isn't a card line (blank, section header, comment).
const LINE_RE = /^(\s*)(\d+)(x?\s+)(.+)$/;
function parseLine(line) {
  const m = LINE_RE.exec(line.replace(/\r$/, ''));
  if (!m) return null;
  let name = m[4];
  name = name.replace(/\s+\([A-Za-z0-9]{2,8}\)(\s+\S+)?(\s+\*[A-Za-z]+\*)*(\s+#.*)?\s*$/, '');
  name = name.replace(/(\s+\*[A-Za-z]+\*)+(\s+#.*)?\s*$/, '').replace(/\s+#.*$/, '').trim();
  if (!name) return null;
  return { qty: Number(m[2]), key: frontFace(name) };
}

// Pure text transform over Moxfield's Bulk Edit text. Removes lines whose front-face name is in
// `remove` (case-insensitive); for each `add`, bumps the first matching line's quantity or appends
// "<qty> <name>". Every other line is preserved byte-for-byte (incl. CR, set codes, foil marks).
export function editBulkText(text, { add = [], remove = [] } = {}) {
  const src = String(text ?? '');
  const removeKeys = new Set((remove || []).map(frontFace));
  const adds = new Map();
  for (const a of add || []) {
    if (!a || !a.name) continue;
    const k = frontFace(a.name);
    const q = Math.max(0, Math.floor(Number(a.qty) || 0)) || 1;
    const prev = adds.get(k);
    adds.set(k, { name: prev ? prev.name : a.name, qty: (prev ? prev.qty : 0) + q });
  }
  if (!removeKeys.size && !adds.size) return src;

  const out = [];
  for (const line of src === '' ? [] : src.split('\n')) {
    const p = parseLine(line);
    if (p && removeKeys.has(p.key)) continue;
    if (p && adds.has(p.key)) {
      const extra = adds.get(p.key).qty;
      adds.delete(p.key);
      out.push(line.replace(/^(\s*)\d+/, (_, ws) => `${ws}${p.qty + extra}`));
      continue;
    }
    out.push(line);
  }
  const appended = [...adds.values()].map((a) => `${a.qty} ${a.name}`);
  if (appended.length) {
    // Keep a trailing newline (if the text had one) after the appended lines.
    const trailing = out.length && out[out.length - 1].replace(/\r$/, '') === '' ? out.pop() : null;
    out.push(...appended);
    if (trailing !== null) out.push(trailing);
  }
  return out.join('\n');
}
