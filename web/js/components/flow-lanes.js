// Flow lanes: one grid column per hop, upstream on the left, a header over each column and connectors
// in the transport colour of the hop. Callers place nodes by (column, row); rows start at 0.
// Connectors: arrow, fan (one to many, drawn from the left) and merge (many to one, with an arrow).
// A dashed connector means the hop is uncertain. When the lanes are wider than the page they scroll,
// with a fade on the right edge and a hint. See docs/UI-GUIDE.md §2.

import { h } from '../dom.js';

const TRANSPORT = { 'sns-topic': 'sns', 'sqs-queue': 'sqs', 'eventbridge-bus': 'eventbridge', 'amqp-exchange': 'amqp', 'amqp-queue': 'amqp' };
export const transportOf = (kind) => TRANSPORT[kind] ?? 'async';

/** One connector cell: cls is arrow, fan first|mid|last, merge first|mid|last or plain. */
export const connector = (cls, t, dash) => h('div', { class: `lane-conn ${cls}${dash ? ' dash' : ''}`, 'data-t': t }, cls.startsWith('fan') ? h('i') : null);

/**
 * cols: [{ head, width }]; width is a CSS track size, head '' for connector columns.
 * `footer` sits directly under the last row (above the legend); `hint` is shown while the lanes scroll.
 */
export function flowLanes(cols, { legend = [], footer = null, hint = 'Scroll to see the rest of the flow', hintSeen = null } = {}) {
  const grid = h('div.lane-grid', { style: { gridTemplateColumns: cols.map((c) => c.width).join(' ') } });
  const scroller = h('div.lane-scroll', grid);
  const hintEl = h('p.lane-hint', hint);
  const el = h('div.lanes', scroller, hintEl, footer, legend.length ? h('div.lane-legend', legend.map((l) => h('span', { class: l.dash ? 'dash' : '', 'data-t': l.t }, l.text))) : null);
  cols.forEach((c, i) => grid.append(h('div.lane-head', { style: { gridColumn: String(i + 1), gridRow: '1' } }, c.head)));
  // Scrolling is only switched on when needed: an overflow container would stop the sticky nodes sticking.
  const check = () => {
    const wide = scroller.scrollWidth > scroller.clientWidth + 4;
    el.classList.toggle('scrolls', wide);
    // Once the page's own channel is in view, the hint names only what is still off-screen.
    const here = grid.querySelector('.lane-node.here');
    if (hintSeen && here) hintEl.textContent = here.getBoundingClientRect().right <= scroller.getBoundingClientRect().right + 1 ? hintSeen : hint;
    el.classList.toggle('at-end', !wide || scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4);
  };
  scroller.addEventListener('scroll', check, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(check).observe(scroller);

  const place = (node, col, row, span = 1, { sticky = false } = {}) => {
    node.style.gridColumn = String(col + 1);
    node.style.gridRow = `${row + 2} / span ${span}`;
    if (sticky) node.classList.add('lane-sticky');
    grid.append(node);
    return node;
  };
  const line = connector;
  return {
    el,
    put: place,
    /** `top`: stay level with a sticky node instead of the middle of the span. `half`: starts at the middle of its column (after a merge). */
    arrow: (col, row, t, { span = 1, dash = false, top = false, half = false } = {}) =>
      place(line(`arrow${top ? ' top' : ''}${half ? ' half' : ''}`, t, dash), col, row, span),
    /** One upstream node to `n` rows: a trunk with a branch and an arrowhead per row. */
    fan: (col, row, n, t, dash = false) => {
      for (let i = 0; i < n; i++) place(line(n === 1 ? 'arrow' : `fan ${i === 0 ? 'first' : i === n - 1 ? 'last' : 'mid'}`, t, dash), col, row + i);
    },
    /** `n` rows into one node: branches join a trunk in the middle of the column; add a `half` arrow over the same column. */
    merge: (col, row, n, ts, dashes = []) => {
      for (let i = 0; i < n; i++) place(line(`merge ${i === 0 ? 'first' : i === n - 1 ? 'last' : 'mid'}`, ts[i], dashes[i]), col, row + i);
    },
  };
}

/** A box in the filter column, with a connector tail to the next column. */
export function filterCell(box, { id, t, dash = false, tip = true } = {}) {
  return h('div.lane-filter', { id, 'data-t': t, class: dash ? 'dash' : '' }, box, h('span.tail'), tip ? h('i.tip') : null);
}

/** A filter that lets everything through needs no box: a small label sits on the connector. */
export function filterLabelCell(label, { id, t, title, tip = true } = {}) {
  return h('div.lane-filter.thin', { id, 'data-t': t, title }, h('span.thin-mid', h('span.all-chip', label)), tip ? h('i.tip') : null);
}
