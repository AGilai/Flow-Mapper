// Delivery grid: event type down the side, destination across the top. Each cell says what happens to
// that event type there (handled, filtered out, arrives with no handler, nobody reads) and why.
// A problem cell is tinted. See docs/UI-GUIDE.md §4.

import { h } from '../dom.js';
import { channelLink, eventLink, serviceLink } from '../views/inventory-links.js';
import { showAll } from './show-all.js';

const LABEL = { handled: 'Handled', 'no-handler': 'Arrives, no handler', filtered: 'Filtered out', 'no-consumer': 'No reader' };

function cell(c) {
  const kind = c.status === 'handled' && !c.uncertain ? 'ok' : c.status === 'filtered' || c.status === 'no-consumer' ? 'skip' : 'warn';
  const mark = kind === 'ok' ? '✓' : kind === 'skip' ? '–' : '!';
  return h('td', { class: kind === 'warn' ? 'cell-warn' : '' },
    h('div.st', { class: kind },
      h('span.ic', { 'aria-hidden': 'true' }, mark),
      h('span.what',
        h('b', LABEL[c.status] + (c.status === 'handled' && c.uncertain ? ', if the filter is right' : '')),
        c.handler ? h('span.mono.handler', c.handler) : null,
        c.why ? h('small', c.why) : null)));
}

/** grid: a channel flow's `grid`. Shows `limit` event types, then a "show all" control. */
export function deliveryGrid(grid, { limit = 8 } = {}) {
  const head = h('thead', h('tr', h('th', 'Event type'), grid.destinations.map((d) => h('th',
    d.consumer ? serviceLink(d.consumer.service) : h('span.muted', 'No reader'),
    d.queue ? h('span.dest-q', channelLink(d.queue.key, d.queue.name)) : null))));
  const body = (rows) => h('table.matrix', head, h('tbody', rows.map((r) => h('tr',
    h('th', eventLink(r.type), h('span.xs', `from ${r.producers.join(', ') || 'unknown'}`)), r.cells.map(cell)))));
  return showAll(grid.rows, limit, (rows) => h('div.matrix-wrap', body(rows)), 'event types');
}
