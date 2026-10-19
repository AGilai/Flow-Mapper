// Flow lanes: one grid column per hop, upstream on the left, a header over each column and connectors
// in the transport colour of the hop. Callers place nodes by (column, row); rows start at 0.
// Connectors: arrow, fan (one to many, drawn from the left) and merge (many to one).
// A dashed connector means the hop is uncertain. See docs/UI-GUIDE.md §2.

import { h } from '../dom.js';

const TRANSPORT = { 'sns-topic': 'sns', 'sqs-queue': 'sqs', 'eventbridge-bus': 'eventbridge', 'amqp-exchange': 'amqp', 'amqp-queue': 'amqp' };
export const transportOf = (kind) => TRANSPORT[kind] ?? 'async';

/** cols: [{ head, width }]; width is a CSS track size, head '' for connector columns. */
export function flowLanes(cols, { legend = [] } = {}) {
  const grid = h('div.lane-grid', { style: { gridTemplateColumns: cols.map((c) => c.width).join(' ') } });
  cols.forEach((c, i) => grid.append(h('div.lane-head', { style: { gridColumn: String(i + 1), gridRow: '1' } }, c.head)));
  const place = (el, col, row, span = 1) => {
    el.style.gridColumn = String(col + 1);
    el.style.gridRow = `${row + 2} / span ${span}`;
    grid.append(el);
    return el;
  };
  const line = (cls, t, dash) => h('div', { class: `lane-conn ${cls}${dash ? ' dash' : ''}`, 'data-t': t }, cls.startsWith('fan') ? h('i') : null);
  return {
    el: h('div.lanes', grid, legend.length ? h('div.lane-legend', legend.map((l) => h('span', { class: l.dash ? 'dash' : '', 'data-t': l.t }, l.text))) : null),
    put: place,
    arrow: (col, row, t, { span = 1, dash = false } = {}) => place(line('arrow', t, dash), col, row, span),
    /** One upstream node to `n` rows: a trunk with a branch and an arrowhead per row. */
    fan: (col, row, n, t, dash = false) => {
      for (let i = 0; i < n; i++) place(line(n === 1 ? 'arrow' : `fan ${i === 0 ? 'first' : i === n - 1 ? 'last' : 'mid'}`, t, dash), col, row + i);
    },
    /** `n` rows into one node: branches join a trunk; put an arrow in the next column. */
    merge: (col, row, n, ts, dashes = []) => {
      for (let i = 0; i < n; i++) place(line(n === 1 ? 'plain' : `merge ${i === 0 ? 'first' : i === n - 1 ? 'last' : 'mid'}`, ts[i], dashes[i]), col, row + i);
    },
  };
}

/** A box in the filter column, with a connector tail to the next column. */
export function filterCell(box, { id, t, dash = false, tip = true } = {}) {
  return h('div.lane-filter', { id, 'data-t': t, class: dash ? 'dash' : '' }, box, h('span.tail'), tip ? h('i.tip') : null);
}
