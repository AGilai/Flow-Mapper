// Frame 35: the schema card at the bottom of a data-store pane marks the fields the OPEN call(s) use (F filter, P projection, U update, S sort) and can show
// only those. `queryMarks()` is the small state the call cards and the schema card share: each card says which fields it has while it is open.

import { h } from '../dom.js';
import { usedLetters } from '../../core/query-card.js';

let onlyUsed = false; // "Only this call's fields": per session, off by default

export function queryMarks() {
  const open = new Map(), subs = new Set();
  const tell = () => subs.forEach((f) => f());
  return {
    /** A call card opened (fields) or closed (null). `id`: the card. */
    set(id, fields) { if (fields?.length) open.set(id, fields); else open.delete(id); tell(); },
    has: () => open.size > 0,
    letters: () => usedLetters([...open.values()]),
    watch(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

/** Marks the rows of a schema table (rows carry `title` = the field path) and adds the toggle. `view`: the schemaView element; `qm`: queryMarks(); `many`: wording ("this call's" / "the open calls'"). */
export function markSchema(view, qm) {
  const rows = [...view.querySelectorAll('table.schema-table tbody tr[title]')];
  if (!rows.length) return view;
  const box = h('input', { type: 'checkbox', checked: onlyUsed, 'data-qa': 'schema-only-used', on: { change: () => { onlyUsed = box.checked; paint(); } } });
  const note = h('div.qc-sch-note', h('label', box, " Only this call's fields"), h('span', ' · marks follow the open call'));
  const paint = () => {
    const used = qm.letters(), on = used.size > 0, keep = new Set();
    for (const p of used.keys()) { const parts = p.split('.'); for (let i = 1; i <= parts.length; i++) keep.add(parts.slice(0, i).join('.')); }
    for (const tr of rows) {
      const path = tr.getAttribute('title'), ls = used.get(path), td = tr.querySelector('td.schema-field');
      tr.classList.toggle('qc-used', !!ls);
      td?.querySelector(':scope > .qc-rl')?.remove();
      if (ls) td?.querySelector('code.key')?.after(h('span.qc-rl', { title: 'used by the open call' }, ls.map((l) => h('i', l))));
      tr.hidden = onlyUsed && on && !keep.has(path);
    }
    note.hidden = !on;
  };
  (rows[0].closest('.json-view') ?? view).after(note);
  qm.watch(paint); paint();
  return view;
}
