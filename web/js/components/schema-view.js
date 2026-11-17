// #124: a data store's schema as a DDL table (Field | Type | Required, descriptions and enums under the field), its indexes as their own small table,
// then "Source & notes" for everything that is not DDL (doc, incomplete, $comment ...). Raw JSON stays behind the toggle of json-view.js.
// JSON Schema and the manual {fields, indexes} shape both read here (core/schema-ddl.ts); a shape it cannot read warns and falls back to the raw tree.

import { h } from '../dom.js';
import { ddlOf } from '../../core/schema-ddl.js';
import { jsonView } from './json-view.js';

const text = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

/** One value of the notes block: a scalar as text, an object as key / value lines, a list as items. */
function noteValue(v) {
  if (v && typeof v === 'object') {
    const entries = Array.isArray(v) ? v.map((x, i) => [String(i + 1), x]) : Object.entries(v);
    return h('dl.schema-kv', entries.flatMap(([k, x]) => [h('dt', k), h('dd', typeof x === 'object' && x !== null ? h('code.key', JSON.stringify(x)) : text(x))]));
  }
  return h('span', text(v));
}

export const indexTable = (indexes) => h('table.grid.schema-table.schema-idx', { 'aria-label': 'Indexes' },
  h('thead', h('tr', h('th', 'Index'), h('th', 'Fields'), h('th', 'Notes'))),
  h('tbody', indexes.map((x) => h('tr', h('td', x.name ? h('code.key', x.name) : h('span.muted', '—')), h('td', h('code.key', x.keys)),
    h('td', x.unique ? h('b', 'unique') : null, x.unique && x.notes ? ', ' : null, x.notes || (x.unique ? null : h('span.muted', '—')))))));

export const notesBlock = (extra) => h('div.schema-notes', { 'data-qa': 'schema-notes' }, h('h4', 'Source & notes'),
  h('dl.schema-kv.top', extra.flatMap(([k, v]) => [h('dt', k), h('dd', noteValue(v))])));

/** schemaView(content, anchor, marks) -> the element of a store schema. */
export function schemaView(content, anchor = null, marks) {
  const d = ddlOf(content);
  const warn = d.warnings.length ? h('div.schema-warn', { role: 'note', 'data-qa': 'schema-warn' }, h('b', d.kind === 'unknown' ? 'This schema is not DDL, so it is shown as JSON.' : 'Check this schema.'),
    h('ul', d.warnings.map((w) => h('li', w)))) : null;
  const view = d.schema ? jsonView(d.schema, anchor, marks, content) : jsonView(content, anchor, marks);
  return h('div.schema-pane', warn, view, d.indexes.length ? h('div.schema-block', h('h4', 'Indexes'), indexTable(d.indexes)) : null, d.extra.length ? notesBlock(d.extra) : null);
}
