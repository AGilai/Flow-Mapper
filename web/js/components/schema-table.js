// Field table for a JSON Schema: one row per field (indented when nested) with its type, whether it is
// required, and its description. The rows come from core/json-schema.ts, or from `opts.rows` (field-diff.js:
// the same rows with their status marks: New / Changed / Removed with a 3px edge, "was ..." under the type).

import { h } from '../dom.js';
import { schemaRows } from '../../core/json-schema.js';
import { markBadge, markClass, wasText } from './status-mark.js';

const MAX_ENUM = 8;
const ROW = { new: 'isnew', changed: 'ischg', removed: 'isrm' };

/** schemaTable(schema, { rows?, store? }). `store`: the marks store, for the wording of a Removed badge. */
export function schemaTable(schema, { rows = null, store = null } = {}) {
  rows ??= schemaRows(schema);
  const title = typeof schema.title === 'string' ? schema.title : null;
  if (!rows.length) return h('div.schema-empty', 'This schema declares no fields.');
  return h('div.schema-view',
    title || schema.description ? h('p.schema-title', title ?? schema.description) : null,
    h('table.grid.schema-table',
      h('thead', h('tr', h('th', 'Field'), h('th', 'Type'), h('th', 'Required'))),
      h('tbody', rows.map((r) => row(r, store)))));
}

function row(r, store) {
  const values = r.enum ? (r.enum.length > MAX_ENUM ? [...r.enum.slice(0, MAX_ENUM), `+${r.enum.length - MAX_ENUM} more`] : r.enum).map((v) => (typeof v === 'string' && !v.startsWith('+') ? v : JSON.stringify(v))).join(', ') : null;
  const m = r.mark;
  return h('tr', { title: r.path, class: m ? ROW[m.mark] : '', 'data-mark': m ? markClass(m) : null },
    h('td.schema-field', { style: { paddingLeft: `calc(var(--s3) + ${r.depth * 16}px)` } },
      h('code.key', r.name), m ? [' ', markBadge(m, { store })] : null,
      r.description ? h('div.schema-desc', r.description) : null,
      r.refDescription ? h('div.schema-desc', r.refDescription) : null,
      values ? h('div.schema-desc', `One of: ${values}`) : null),
    h('td.schema-type',
      r.type ? h('code.key', r.type) : h('span.muted', '—'),
      m && wasText(m) && m.mark === 'changed' ? h('span.fd-was', wasText(m)) : null,
      r.format ? h('div.schema-desc', r.format) : null,
      r.ref ? h('div.schema-desc', { title: `References ${r.ref}` }, `Defined as ${r.ref}`) : null),
    h('td', r.removed ? h('span.muted', '') : r.required ? h('span.schema-req', 'Required') : h('span.muted', 'Optional')));
}
