// Read-only JSON viewer: a collapsible tree (first two levels open) with copy and expand/collapse all.

import { h, toast } from '../dom.js';

export function jsonView(value) {
  const tree = h('div.json', node(value, null, 0));
  const setAll = (open) => tree.querySelectorAll('details').forEach((d) => { d.open = open; });
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(value, null, 2)); toast('JSON copied'); }
    catch { toast('Copy is not available here'); }
  };
  return h('div.json-view',
    h('div.json-tools',
      h('button.btn.ghost.xs', { type: 'button', on: { click: () => setAll(true) } }, 'Expand all'),
      h('button.btn.ghost.xs', { type: 'button', on: { click: () => setAll(false) } }, 'Collapse all'),
      h('button.btn.ghost.xs', { type: 'button', on: { click: copy } }, 'Copy')),
    tree);
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
