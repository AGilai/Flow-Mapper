// Field rows of a DTO / event message / store schema with their marks: the rows of the current content (schemaRows) plus a row for each
// removed field (the server marks it `removed` under `<item>#<path>`; the field is not in the content any more). Pure: no DOM, no core imports.

const nameOf = (path) => path.replace(/\[\]$/, '').split('.').pop().replace(/\[\]$/, '');
const depthOf = (path) => path.replace(/\[\]/g, '').split('.').length - 1;
const parentOf = (path) => { const i = path.replace(/\[\]$/, '').lastIndexOf('.'); return i < 0 ? '' : path.slice(0, i).replace(/\[\]$/, ''); };
const inside = (path, parent) => path === parent || path.startsWith(`${parent}.`) || path.startsWith(`${parent}[]`);

/** rows: [{path, name, depth, type, required, ...}] of the current content; fm: Map<path, {mark, was?}>. Returns rows with `mark` (info or null). */
export function mergeRows(rows, fm) {
  const known = new Set(rows.map((r) => r.path));
  const out = rows.map((r) => ({ ...r, mark: fm.get(r.path) ?? null }));
  for (const [path, info] of fm) {
    if (info.mark !== 'removed' || known.has(path)) continue;
    const parent = parentOf(path);
    let at = out.length;
    if (parent) for (let i = out.length - 1; i >= 0; i--) if (inside(out[i].path, parent)) { at = i + 1; break; }
    out.splice(at, 0, { path, name: nameOf(path), depth: depthOf(path), type: '', required: false, mark: info, removed: true });
  }
  return out;
}

/** Rows for example JSON (no schema): one per field of `fields` (Map<path, {type, required}> as core/diff/fields.fieldsOf returns), in path order. */
export function rowsOfFields(fields) {
  return [...fields].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, f]) => ({ path, name: nameOf(path), depth: depthOf(path), type: f.type, required: !!f.required }));
}

/** "1 new, 1 changed, 1 removed" for the head of a field table (counts of the marks on fields of one item). */
export function fieldSentence(fm) {
  const n = { new: 0, changed: 0, removed: 0 };
  for (const m of fm.values()) if (m.mark in n) n[m.mark]++;
  return ['new', 'changed', 'removed'].filter((k) => n[k]).map((k) => `${n[k]} ${k}`).join(', ');
}
