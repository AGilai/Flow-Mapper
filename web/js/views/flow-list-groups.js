// A collapsible checkbox group above the entry-point list (Subsystem, then Component). The header is a button (aria-expanded) with the applied summary;
// expanded: "Select all · Deselect all" and one checkbox per row in a fieldset with a legend. Open or closed is remembered per viewer (try/catch).
// Selection model: a Set, or null for "all" (flow-list-filter.js).

import { h, fill } from '../dom.js';
import { summaryText } from './flow-list-filter.js';

const key = (id) => `fm:flows-group:${id}`;
const readOpen = (id) => { try { return localStorage.getItem(key(id)) === '1'; } catch { return false; } };
const writeOpen = (id, v) => { try { localStorage.setItem(key(id), v ? '1' : '0'); } catch { /* storage unavailable */ } };

/**
 * createGroup({ id, title, onChange(sel|null) }) -> { el, update({ rows: [{key,label,count}], sel }) }
 * `rows` are the options now visible (the Component group follows the Subsystem choice).
 */
export function createGroup({ id, title, onChange }) {
  let open = readOpen(id), rows = [], sel = null, focusKey = null; // focusKey: the box just toggled keeps focus across the redraw
  const sum = h('span.fg-sum'), caret = h('span.fg-caret', { 'aria-hidden': 'true' }, '▸');
  const head = h('button.fg-head', { type: 'button', 'aria-expanded': String(open), 'aria-controls': `fg-${id}`, 'data-qa': `group-${id}`,
    on: { click: () => { open = !open; writeOpen(id, open); paint(); } } }, caret, h('span.fg-t', title), sum);
  const body = h('div.fg-body', { id: `fg-${id}`, hidden: !open });
  const el = h('div.fg', { 'data-group': id }, head, body);
  const effective = () => new Set(sel ?? rows.map((r) => r.key));
  const set = (next) => onChange(rows.every((r) => next.has(r.key)) ? null : next);

  function paint() {
    head.setAttribute('aria-expanded', String(open)); caret.textContent = open ? '▾' : '▸'; body.hidden = !open;
    sum.textContent = summaryText(sel, rows);
    if (!open) { body.replaceChildren(); return; }
    const on = effective();
    const draw = () => fill(body, h('fieldset.fg-set', h('legend.sr-only', `${title}: choose which to show`),
      h('div.fg-acts', h('button.linkish', { type: 'button', 'data-qa': `${id}-all`, on: { click: () => onChange(null) } }, 'Select all'), ' · ', h('button.linkish', { type: 'button', 'data-qa': `${id}-none`, on: { click: () => onChange(new Set()) } }, 'Deselect all')),
      rows.length ? rows.map((r) => h('label.fg-row', h('input', { type: 'checkbox', checked: on.has(r.key), 'data-key': r.key, on: { change: (e) => { focusKey = r.key; const n = effective(); if (e.target.checked) n.add(r.key); else n.delete(r.key); set(n); } } }),
        h('span.fg-l', r.label), h('span.fg-n', String(r.count)))) : h('p.xs.muted', 'Nothing to choose.')));
    draw();
    if (focusKey != null) { [...body.querySelectorAll('input[data-key]')].find((i) => i.dataset.key === focusKey)?.focus(); focusKey = null; }
  }
  return { el, update(next) { rows = next.rows; sel = next.sel; paint(); } };
}
