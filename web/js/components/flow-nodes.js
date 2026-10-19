// The boxes that sit in flow lanes: a publishing service, a topic or queue, a consuming service.

import { h } from '../dom.js';
import { channelLink, serviceLink } from '../views/inventory-links.js';
import { eventChips } from './event-chips.js';
import { transportOf } from './flow-lanes.js';

const KIND_LABEL = { 'sns-topic': 'SNS topic', 'sqs-queue': 'SQS queue', 'amqp-exchange': 'Exchange', 'amqp-queue': 'AMQP queue', 'eventbridge-bus': 'Event bus' };

/** A service that publishes into the channel, with the event types it sends. */
export function publisherNode(pubs) {
  return h('div.lane-node.svc', pubs.map((p) => h('div.node-block',
    h('div.nm', serviceLink(p.service)),
    h('div.sub-id', p.egress),
    p.events.length ? eventChips(p.events, { limit: 3 }) : h('div.who', 'event types not listed'))));
}

/** A topic, queue or bus. `sub` is a short plain line under the name; `here` marks the page's own channel. */
export function channelNode(n, { sub, here = false } = {}) {
  return h('div.lane-node.chan', { 'data-t': transportOf(n.kind), class: here ? 'here' : '' },
    h('div.nm', here || !n.known ? n.name : channelLink(n.key, n.name)),
    h('div.who', here ? sub : [KIND_LABEL[n.kind] ?? 'Channel', sub ? `, ${sub}` : '']));
}

/** A service that reads from a queue: its endpoint and handler, and which event types it handles. */
export function consumerNode(cs, { placeholder } = {}) {
  if (!cs.length) return h('div.lane-node.empty', placeholder ?? 'No harvested service reads this queue.');
  return h('div.lane-node.svc', cs.map((c) => h('div.node-block',
    h('div.nm', serviceLink(c.service)),
    h('div.sub-id', c.ingress, h('span.muted', ' calls '), c.handler),
    h('div.handles', h('span.muted', 'handles'),
      c.handles.all ? h('span.all-chip', 'all events') : eventChips(c.handles.types, { limit: 3 })))));
}
