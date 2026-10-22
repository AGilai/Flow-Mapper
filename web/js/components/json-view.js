// Read-only JSON viewer: a collapsible tree (first two levels open) with copy and expand/collapse all.
// A JSON Schema opens as a field table instead, with a toggle to the raw JSON.

import { h, toast } from '../dom.js';
import { isJsonSchema } from '../../core/json-schema.js';
import { schemaTable } from './schema-table.js';
import { fieldDiff } from './field-diff.js';

/** `anchor`: the item's anchor in a design environment (dto:, evt:, schema:): its fields then show their New / Changed / Removed marks. */
export function jsonView(value, anchor = null, marks) { // marks: the marks of the item's environment (default: the page's)
  const diff = fieldDiff(value, anchor, marks);
  const tree = h('div.json', node(value, null, 0));
  const setAll = (open) => tree.querySelectorAll('details').forEach((d) => { d.open = open; });
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(value, null, 2)); toast('JSON copied'); }
    catch { toast('Copy is not available here'); }
  };
  const btn = (label, click) => h('button.btn.ghost.xs', { type: 'button', on: { click } }, label);
  const treeTools = [btn('Expand all', () => setAll(true)), btn('Collapse all', () => setAll(false))];
  if (!isJsonSchema(value) && !diff?.rows) return h('div.json-view', diff?.head, h('div.json-tools', treeTools, btn('Copy', copy)), tree);

  // A JSON Schema reads best as a field table; the raw JSON stays one click away.
  const fields = schemaTable(value, diff?.rows ? { rows: diff.rows, store: diff.store } : {});
  const modes = [['fields', 'Fields', fields], ['raw', 'Raw JSON', tree]];
  const seg = h('div.seg.xs', { role: 'group', 'aria-label': 'View' });
  const treeBox = h('span.json-tree-tools', treeTools);
  const show = (m) => {
    modes.forEach(([k, , el]) => { el.hidden = k !== m; });
    treeBox.hidden = m !== 'raw';
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  };
  seg.append(...modes.map(([k, label]) => h('button', { type: 'button', 'data-mode': k, on: { click: () => show(k) } }, label)));
  const view = h('div.json-view', diff?.head, h('div.json-tools', seg, h('span.spacer'), treeBox, btn('Copy', copy)), fields, tree);
  show('fields');
  return view;
}

function node(v, label, depth) {
  if (v === null || typeof v !== 'object') return h('div.json-row', label, scalar(v));
  const arr = Array.isArray(v);
  const entries = arr ? v.map((x, i) => [i, x]) : Object.entries(v);
  const [open, close] = arr ? ['[', ']'] : ['{', '}'];
  if (!entries.length) return h('div.json-row', label, h('span.json-p', open + close));
  return h('details.json-node', { open: depth < 2 },
    h('summary', label, h('span.json-p', open), h('span.json-count', `${entries.length} ${arr ? (entries.length === 1 ? 'item' : 'items') : (entries.length === 1 ? 'key' : 'keys')}`)),
    h('div.json-children', entries.map(([k, x]) => node(x, arr ? h('span.json-i', `${k}: `) : h('span.json-k', `${k}: `), depth + 1))),
    h('div.json-p', close));
}

function scalar(v) {
  if (typeof v === 'string') return h('span.json-s', JSON.stringify(v));
  if (typeof v === 'number') return h('span.json-n', String(v));
  return h('span.json-b', String(v));
}
