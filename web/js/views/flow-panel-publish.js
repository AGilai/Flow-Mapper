// Side panel for the shared trunk of a fan-out publish (0.19.1): the publish itself (event type, topic or exchange, routing key)
// and the list of its deliveries. Each delivery opens the panel of its own arrow. Same style as the message panel (flow-panel.js).

import { h } from '../dom.js';
import { chip } from '../format.js';
import { eventLink } from './inventory-links.js';
import { chName, chType } from './flow-chain.js';

const brk = (t) => String(t).split(/(?<=[.\-_/:{}])/).flatMap((x, i) => (i ? [h('wbr'), x] : [x]));
const kv = (k, v) => (v == null || v === '' ? [] : [h('dt', k), h('dd', v)]);

/** Returns [head, ...content] for panel.open(). `open(delivery)` shows that delivery's own panel. */
export function publishPanel(pub, open, env = null) {
  const ex = pub.exchange, topicKind = ex ? 'Exchange' : chType(pub.topic) === 'eventbridge' ? 'Bus' : 'Topic';
  const topic = ex ?? chName(pub.topic);
  const head = h('div.ep-title', chip(chType(pub.topic)), h('span.ep-target', 'Publish, fans out'));
  const sub = h('div.ep-sub', h('span.key', topic), pub.event ? eventLink(pub.event, env) : null);
  const n = pub.deliveries.length;
  return [h('div.ep-head', head, sub),
    h('dl.kv', ...kv(pub.event ? 'Event type' : 'Event', pub.event ?? pub.label), ...kv(topicKind, h('span.key', brk(topic))), ...kv('Routing key', pub.routingKey), ...kv('Deliveries', `${n} ${n === 1 ? 'queue' : 'queues'}`)),
    h('section.ep-card', h('header', h('h3', 'Deliveries'), h('span.ep-meta', 'click one to open it')),
      h('div.pub-list', pub.deliveries.map((d) => h('button.ep-link.pub-row', { type: 'button', title: `Open the delivery to ${chName(d.queue)}`, on: { click: () => open(d) } },
        h('span.ep-link-text', h('b', brk(chName(d.queue))),
          d.filter ? h('span.xs.muted', d.filter) : h('span.xs.muted', 'no filter: every message passes'),
          h('span.xs.muted', d.consumers.length ? d.consumers.map((c) => `${c.service}${c.fn ? ` · ${c.fn}` : ''}`).join(', ') : 'no consumer harvested')),
        h('span.pub-go', { 'aria-hidden': 'true' }, '›'))))),
  ];
}
