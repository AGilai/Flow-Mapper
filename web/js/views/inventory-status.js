// Inventory of a design environment: the All · New · Changed · Unchanged filter (counts are the rows) and the "What changed" column.
// Rows are inventory items; the anchor of one is svc:<name> (service), ch:<bind key> (channel), evt:<type> (event type); other kinds carry no mark.

import { h } from '../dom.js';
import { wasText } from '../components/status-mark.js';

/** The anchor that carries an inventory item's mark, or null. */
export function anchorOfItem(x) {
  if (x.type === 'service') return `svc:${x.id}`;
  if (x.type === 'channel') return `ch:${x.id}`;
  if (x.type === 'event') return `evt:${x.id}`;
  return null;
}

/** 'new' | 'changed' | 'removed' | 'unchanged' (an item with no mark, or no anchor). */
export const statusOf = (x, marks) => marks.markOf(anchorOfItem(x) ?? '')?.mark ?? 'unchanged';

export const STATUS = [['', 'All'], ['new', 'New'], ['changed', 'Changed'], ['unchanged', 'Unchanged']];

/** Counts for the filter, from the same rows the table shows: { '': n, new, changed, unchanged }. */
export function statusCounts(rows, marks) {
  const c = { '': rows.length, new: 0, changed: 0, unchanged: 0 };
  for (const x of rows) { const s = statusOf(x, marks); if (s in c) c[s]++; else c.unchanged++; }
  return c;
}

export const filterByStatus = (rows, status, marks) => (status ? rows.filter((x) => statusOf(x, marks) === status) : rows);

/** The seg: buttons with counts. `onPick(value)`; returns { el, update(rows, value) }. */
export function statusFilter(value, onPick) {
  const buttons = STATUS.map(([v, label]) => {
    const n = h('span.mk-count');
    const b = h('button', { type: 'button', 'data-status': v || 'all', on: { click: () => onPick(v) } }, label, n);
    return { v, b, n, label };
  });
  const el = h('div.seg', { role: 'group', 'aria-label': 'Status' }, buttons.map((x) => x.b));
  const update = (rows, current, marks) => {
    const c = statusCounts(rows, marks);
    for (const x of buttons) { x.n.textContent = String(c[x.v]); x.b.setAttribute('aria-pressed', String(x.v === current)); }
  };
  return { el, update };
}

/** The "What changed" column: the words of the mark (`+1 endpoint`, `was string`) for changed rows. The badge itself sits by the name (status next to its subject). */
export function whatColumn(marks) {
  return { key: 'what', label: 'What changed', sort: (x) => ({ new: 0, changed: 1, removed: 2 })[statusOf(x, marks)] ?? 3,
    render: (x) => {
      const info = marks.markOf(anchorOfItem(x) ?? '');
      if (!info) return null;
      return wasText(info) ? h('span.mk-what', wasText(info)) : null;
    } };
}
