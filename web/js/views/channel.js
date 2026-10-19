// Channel page: a topic, queue, exchange or event bus. Publishers, what feeds it, its subscriptions or
// rules with their event filters, consumers, the event types passing through, and problems.

import { h } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { href } from '../router.js';
import { pageHead } from '../components/page.js';
import { jsonView } from '../components/json-view.js';
import { box, empty, fig, problems } from './detail-parts.js';
import { channelLink, eventLink, serviceLink } from './inventory-links.js';

const KIND = { 'sns-topic': 'SNS topic', 'sqs-queue': 'SQS queue', 'amqp-exchange': 'RabbitMQ exchange', 'amqp-queue': 'RabbitMQ queue', 'eventbridge-bus': 'EventBridge bus' };

export async function render({ main, params }) {
  const v = await api.channel(state.env, params.key);
  const isBus = v.kind === 'eventbridge-bus';
  const events = (xs) => (xs.length ? xs.map((e) => h('span.ep-producer', eventLink(e))) : null);
  const pubs = [
    ...v.publishers.map((p) => h('div.use', h('div.use-head', h('b', serviceLink(p.service)), h('span.key.muted', p.egress)), p.events.length ? h('div.ep-producers', events(p.events)) : null)),
    ...v.feeds.map((k) => h('div.use', h('div.use-head', h('span.small.muted', 'fed by'), channelLink(k)))),
  ];

  main.append(
    pageHead(v.name, `${KIND[v.kind] ?? v.kind} · ${v.key}`,
      h('a.btn', { href: href('/system', { channels: 1, sel: `ch:${v.key}` }) }, 'Show on map'),
      h('a.btn', { href: href('/inventory', { type: 'channel' }) }, 'All topics and queues')),
    h('div.content', h('div.page-grid',
      h('div.figures', fig(v.publishers.length, 'Publishers'), fig(v.subscriptions.length, isBus ? 'Rules' : 'Subscriptions'),
        fig(v.consumers.length, 'Consumers'), fig(v.events.length, 'Event types'), fig(v.problems.length, 'Problems', v.problems.length > 0)),
      problems(v.problems),
      h('div.two-col',
        h('div.stack', { style: { gap: 'var(--s4)' } },
          box('Published by', pubs.length, pubs.length ? pubs : empty('Nothing publishes here.')),
          box(isBus ? 'Rules' : 'Subscriptions', v.subscriptions.length, v.subscriptions.length ? v.subscriptions.map((s) => h('div.use',
            h('div.use-head', s.toChannel ? channelLink(s.to) : h('span.key', s.to),
              s.events === '*' ? h('span.pill', 'all events') : null, s.conflict ? h('span.pill.warn', 'conflict') : null, h('span.grow'), h('span.xs.muted', `declared by ${s.service}`)),
            s.events === '*' ? null : h('div.ep-producers', s.events.map((e) => h('span.ep-producer', h('span.key', e))))))
            : empty(isBus ? 'No rules.' : 'No subscriptions.')),
          box('Consumed by', v.consumers.length, v.consumers.length ? v.consumers.map((c) => h('div.use',
            h('div.use-head', h('b', serviceLink(c.service)), h('span.key.muted', c.ingress), h('span.xs.muted', `handler ${c.handler}`)),
            c.events.length ? h('div.ep-producers', events(c.events.filter((e) => !e.includes('*'))), c.events.filter((e) => e.includes('*')).map((e) => h('span.ep-producer', h('span.key', e)))) : null))
            : empty('Nothing consumes it directly.'))),
        h('div.stack', { style: { gap: 'var(--s4)' } },
          box('Event types passing through', v.events.length, v.events.length ? h('div.list', v.events.map((e) => h('div.list-item',
            eventLink(e.type), h('span.grow.truncate.xs.muted', `${e.producers.join(', ')} → ${e.consumers.join(', ')}`),
            e.unhandled ? h('span.pill.bad', 'unhandled') : null))) : empty('No typed events pass through.')),
          h('p.xs.muted', `Declared by ${v.declaredBy.join(', ')}`),
          Object.keys(v.details).length ? box('Details', null, jsonView(v.details)) : null)))));
}
