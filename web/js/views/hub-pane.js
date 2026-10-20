// The info pane of the compact channel views: opens on a click of an edge, a queue or a consumer, and
// squeezes the page. Subscription details with the declarations (and code links), what reaches the
// consumer under each declaration, the consumer card, and the way on to the queue or the full view.
// Returns [head, ...content] for panel.open().

import { h } from '../dom.js';
import { href } from '../router.js';
import { declarationOutcomes } from '../../core/hub.js';
import { declaration } from '../components/declaration.js';
import { eventChips } from '../components/event-chips.js';
import { channelPath, serviceLink } from './inventory-links.js';
import { plural } from './hub-parts.js';

const head = (title, sub) => h('div.grow', h('div.who', sub), h('h3.mono-title', title));
const actions = (...btns) => h('div.panel-actions', btns.filter(Boolean));

/** One column per declaration: how many of the topic's event types end in each outcome. */
function reachTable(flow, row) {
  const outs = declarationOutcomes(flow, row);
  if (!outs.length || !row.consumers.length) return null;
  const total = flow.grid.rows.filter((r) => !r.possible).length;
  const rows = [['Handled', 'handled', ''], ['Arrives, no handler', 'noHandler', 'bad'], ['Filtered out', 'filtered', '']];
  const bad = outs.flatMap((o) => o.noHandler);
  const first = outs.find((o) => o.noHandler.length);
  return h('section.stack', h('h3', 'What reaches the consumer'),
    h('p.small.muted', `Of the ${plural(total, 'event type')} this ${flow.layout === 'fanout' ? 'topic' : 'queue'} carries${outs.length > 1 ? ', depending on whose filter is right' : ''}.`),
    h('table.reach', h('thead', h('tr', h('th'), outs.map((o) => h('th', o.service)))),
      h('tbody', rows.map(([label, k, cls]) => h('tr', h('th', label), outs.map((o) => h('td', { class: cls && o[k].length ? cls : (o[k].length ? '' : 'zero') }, String(o[k].length))))))),
    first ? h('details.reach-list', h('summary', `Show the ${plural(first.noHandler.length, 'event type')} that arrive with no handler`), eventChips(first.noHandler, { limit: 50 })) : null,
    outs.length > 1 && bad.length ? h('p.small.muted', `Ask ${outs.map((o) => o.service).join(' or ')} which filter is meant.`) : null);
}

export function consumerCard(c) {
  return h('section.hub-card', h('h4', serviceLink(c.service)),
    h('div.mono.small.muted', `${c.ingress} calls ${c.handler}`),
    h('div.handles', h('span.muted', 'handles'), c.handles.all ? h('span.all-chip', 'all events') : eventChips(c.handles.types, { limit: 3 })));
}

/** A subscription: an edge on the topic page or the queue page. */
export function edgePane(v, row) {
  const flow = v.flow;
  const to = row.to.name, from = row.from?.name ?? row.direct.map((p) => p.service).join(', ');
  const topic = flow.layout === 'fanout';
  const consumer = row.consumers[0] ?? (topic ? null : flow.consumers[0]);
  return [
    head(topic ? [from, h('span.muted', ' to '), consumer?.service ?? to] : [from, h('span.muted', ' to '), to], topic ? 'Subscription' : 'Source'),
    row.filter ? h('section.stack', h('h3', 'Subscription'), declaration(row.filter)) : h('p.small.muted', 'Publishers send straight to the queue, with no subscription filter.'),
    topic ? reachTable(flow, row) : null,
    consumer ? h('section.stack', h('h3', 'Consumer'), consumerCard(consumer)) : h('p.small.muted', 'No harvested service reads this queue.'),
    actions(h('a.btn.primary', { href: href(channelPath(row.to.key)) }, 'Open the queue'),
      h('a.btn', { href: href(channelPath(v.key), { view: 'full' }) }, 'Show in full view')),
  ];
}

/** A consumer on the queue page, with how the event types arriving here end up. */
export function consumerPane(v, o) {
  const c = o.consumer;
  return [
    head(c.service, 'Consumer of ' + v.name),
    consumerCard(c),
    h('p.small', o.handled ? `${plural(o.handled, 'event type')} handled` : 'Nothing handled yet', o.noHandler ? [', ', h('b.bad-text', `${o.noHandler} arrive with no handler`)] : null, o.possible ? `, ${o.possible} only possible` : null, '.'),
    actions(h('a.btn', { href: href(channelPath(v.key), { view: 'full' }) }, 'Show in full view')),
  ];
}
