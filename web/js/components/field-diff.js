// Field-level marks for the DTO, message and schema views: the head sentence ("1 new, 1 changed, 1 removed"), the compare-with
// note, and the rows (current content + removed fields) for schema-table.js. Reads the marks the page was drawn with (marks-store).

import { h } from '../dom.js';
import { fieldsOf } from '../../core/diff/fields.js';
import { isJsonSchema, schemaRows } from '../../core/json-schema.js';
import { marksNow } from '../design/marks-store.js';
import { mergeRows, rowsOfFields, fieldSentence } from './field-merge.js';

/** The anchor of a DTO slot / message / schema (ing, status '' = none). */
export const dtoAnchor = (service, role, status, ingress) => `dto:${service}/${role}/${status || '-'}/${ingress}`;
export const eventAnchor = (type) => `evt:${type}`;
export const schemaAnchor = (source, key) => `schema:${source}/${key}`;

/**
 * fieldDiff(content, anchor) -> null (not a design / no marks loaded) or { head, rows }. `rows` only when a field of this item is marked:
 * then the view is the marked table. `head` is the sentence, or "No field changed since the baseline." for an unmarked existing item.
 */
export function fieldDiff(content, anchor) {
  const marks = marksNow();
  if (!anchor || !marks.baselineAt) return null; // not a design environment (or no marks loaded)
  const fm = marks.fieldMarks(anchor), item = marks.markOf(anchor);
  if (item?.mark === 'new') return null; // a new item: its fields carry no marks
  const src = marks.source ?? 'the source', since = marks.against === 'source' ? `compared with ${src} now` : 'since the baseline';
  if (!fm.size) return { head: h('p.fd-empty', `No field changed ${since}.`), rows: null };
  const base = isJsonSchema(content) ? schemaRows(content) : rowsOfFields(fieldsOf(content));
  const rows = mergeRows(base, fm);
  return { rows, store: marks, head: h('div.fd-head', h('span.fd-sentence', fieldSentence(fm)), h('span.muted.xs', since)) };
}
