// The fields a data-store step touches (filter, projection, update, sort): one chip per field, grouped
// by role. A field the code uses but the schema lacks (`inDdl: false`) is flagged.

import { h } from '../dom.js';

const ROLE = { filter: 'filter', projection: 'project', update: 'update', sort: 'sort' };

export const fieldText = (f) => `${f.path}${f.operator ? ` ${f.operator}` : ''}`;

export function stepFields(fields) {
  if (!fields?.length) return null;
  return h('div.step-fields', ['filter', 'projection', 'update', 'sort'].map((role) => {
    const list = fields.filter((f) => f.role === role);
    return list.length ? h('span.step-field-group', h('span.xs.muted', ROLE[role]),
      list.map((f) => h('span.pill.field', { class: f.inDdl === false ? 'not-in-ddl' : '',
        title: [f.inDdl === false ? 'Not in the collection schema' : null, f.ddlRef ? `schema: ${f.ddlRef}` : null, f.flag].filter(Boolean).join(' · ') || null },
        f.inDdl === false ? '! ' : '', fieldText(f)))) : null;
  }));
}
