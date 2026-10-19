// Field table for a JSON Schema: one row per field (indented when nested) with its type, whether it is
// required, and its description. The rows come from core/json-schema.ts.

import { h } from '../dom.js';
import { schemaRows } from '../../core/json-schema.js';

const MAX_ENUM = 8;

export function schemaTable(schema) {
  const rows = schemaRows(schema);
  const title = typeof schema.title === 'string' ? schema.title : null;
  if (!rows.length) return h('div.schema-empty', 'This schema declares no fields.');
  return h('div.schema-view',
    title || schema.description ? h('p.schema-title', title ?? schema.description) : null,
    h('table.grid.schema-table',
      h('thead', h('tr', h('th', 'Field'), h('th', 'Type'), h('th', 'Required'))),
      h('tbody', rows.map(row))));
}

function row(r) {
  const values = r.enum ? (r.enum.length > MAX_ENUM ? [...r.enum.slice(0, MAX_ENUM), `+${r.enum.length - MAX_ENUM} more`] : r.enum).map((v) => (typeof v === 'string' && !v.startsWith('+') ? v : JSON.stringify(v))).join(', ') : null;
  return h('tr', { title: r.path },
    h('td.schema-field', { style: { paddingLeft: `calc(var(--s3) + ${r.depth * 16}px)` } },
      h('code.key', r.name),
      r.description ? h('div.schema-desc', r.description) : null,
      values ? h('div.schema-desc', `One of: ${values}`) : null),
    h('td.schema-type',
      h('code.key', r.type),
      r.format ? h('div.schema-desc', r.format) : null,
      r.ref ? h('div.schema-desc', { title: `References ${r.ref}` }, `Defined as ${r.ref}`) : null),
    h('td', r.required ? h('span.schema-req', 'Required') : h('span.muted', 'Optional')));
}
