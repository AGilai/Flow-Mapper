// Delivery grid: event type down the side, destination across the top. Each cell says what happens to
// that event type there (handled, filtered out, arrives with no handler, nobody reads, possible) and why.
// A problem cell is tinted. When everything is handled it collapses to one line. See docs/UI-GUIDE.md §4.

import { h } from '../dom.js';
import { channelLink, eventLink, serviceLink } from '../views/inventory-links.js';
import { showAll } from './show-all.js';

const LABEL = { handled: 'Handled', 'no-handler': 'Arrives, no handler', filtered: 'Filtered out', 'no-consumer': 'No reader' };

function cell(c) {
  const kind = c.possible ? 'maybe' : c.status === 'handled' && !c.uncertain ? 'ok' : c.status === 'filtered' || c.status === 'no-consumer' ? 'skip' : 'warn';
  const mark = { ok: '✓', skip: '–', warn: '!', maybe: '?' }[kind];
  const title = c.possible ? 'Possible' : LABEL[c.status] + (c.status === 'handled' && c.uncertain ? ', if the filter is right' : '');
  const why = c.possible
    ? ({ handled: 'If the publisher sends it.', 'no-handler': 'If sent, it would arrive with no handler.', filtered: 'If sent, it would be filtered out.', 'no-consumer': '' })[c.status]
    : c.why;
  return h('td', { class: kind === 'warn' ? 'cell-warn' : '' },
    h('div.st', { class: kind },
      h('span.ic', { 'aria-hidden': 'true' }, mark),
      h('span.what',
        h('b', title),
        c.handler ? h('span.mono.handler', c.handler) : null,
        why ? h('small', why) : null)));
}

const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** grid: a channel flow's `grid`. Shows `limit` event types, then a "show all" control. */
export function deliveryGrid(grid, { limit = 8 } = {}) {
  const dests = grid.destinations;
  const head = h('thead', h('tr', h('th', 'Event type'), dests.map((d) => h('th',
    d.consumer ? serviceLink(d.consumer.service) : h('span.muted', 'No reader'),
    d.queue ? h('span.dest-q', channelLink(d.queue.key, d.queue.name)) : null))));
  const body = (rows) => h('table.matrix', { class: dests.length <= 2 ? 'narrow' : '' }, head, h('tbody', rows.map((r) => h('tr',
    h('th', eventLink(r.type), h('span.xs', `from ${r.producers.join(', ') || 'unknown'}`)), r.cells.map(cell)))));
  const full = showAll(grid.rows, limit, (rows, control) => h('div', h('div.matrix-wrap', body(rows)), control), 'event types');

  const allHandled = grid.rows.length > 1 && dests.length && grid.rows.every((r) => r.cells.every((c) => c.status === 'handled' && !c.uncertain && !c.possible));
  if (!allHandled) return full;
  const consumers = [...new Set(dests.map((d) => d.consumer?.service))];
  const handlers = [...new Set(dests.map((d) => d.consumer?.handler))];
  const sentence = `All ${grid.rows.length} event types are handled by ${list(consumers)}${dests.length === 1 && handlers.length === 1 ? ' in ' : ''}`;
  const wrap = h('div.matrix-collapsed');
  const draw = (open) => wrap.replaceChildren(open ? full : h('p.matrix-line', sentence, dests.length === 1 ? h('span.mono', handlers[0]) : null, '.'),
    h('button.btn.ghost.show-more', { type: 'button', on: { click: () => draw(!open) } }, open ? 'Show less' : 'Show all event types'));
  draw(false);
  return wrap;
}
