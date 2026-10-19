// Channel page: a topic, queue, exchange or event bus. Identity, the one-sentence verdict with its
// callouts, the flow lanes (publisher, topic, filter, queue, consumer), the delivery grid, then reference.

import { h } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { href } from '../router.js';
import { pageHead } from '../components/page.js';
import { jsonView } from '../components/json-view.js';
import { titled } from '../components/object-icon.js';
import { summary } from '../components/summary.js';
import { deliveryGrid } from '../components/delivery-grid.js';
import { VERIFIED } from '../components/declaration.js';
import { transportOf } from '../components/flow-lanes.js';
import { codeLink, box } from './detail-parts.js';
import { flowBlock } from './channel-flow.js';
import { chip } from '../format.js';

const KIND = { 'sns-topic': 'SNS topic', 'sqs-queue': 'SQS queue', 'amqp-exchange': 'RabbitMQ exchange', 'amqp-queue': 'RabbitMQ queue', 'eventbridge-bus': 'EventBridge bus' };

const section = (title, hint, ...body) => h('section.flow-section', h('header', h('h2', title), hint ? h('span.hint', hint) : null), ...body);

/** Provenance on one line: the bind key, who defined it and whether live AWS agrees. */
function meta(v) {
  const at = v.definedAt;
  const where = at?.url ? codeLink(`${(at.file ?? 'source').split('/').pop()}${at.line ? ':' + at.line : ''}`, at) : null;
  return h('span.meta',
    h('span.key', v.key),
    at ? h('span', 'Defined by ', h('b', v.definedBy), where ? [' in ', where] : null) : h('span', 'Declared by ', v.declaredBy.join(', ')),
    v.provenance?.verified ? h('span', { class: `verified-${v.provenance.verified}` }, VERIFIED[v.provenance.verified]) : null);
}

export async function render({ main, params }) {
  const v = await api.channel(state.env, params.key);
  const flow = flowBlock(v);
  const grid = v.flow.grid;
  const isQueue = v.flow.layout === 'inbound';
  main.append(
    pageHead(h('span.title-row', titled('channel', v.kind, v.name), chip(transportOf(v.kind), KIND[v.kind] ?? v.kind)), meta(v),
      h('a.btn', { href: href('/system', { channels: 1, sel: `ch:${v.key}` }) }, 'Show on map'),
      h('a.btn', { href: href('/inventory', { type: 'channel' }) }, 'All topics and queues')),
    h('div.content', h('div.flow-page',
      summary(v.flow.summary, { reveal: () => flow.reveal() }),
      section('How events flow', 'From the publisher to the consumer, left to right.', flow),
      grid.rows.length && grid.destinations.length
        ? section('Where each event type ends up', isQueue ? 'Which of the event types sent here this queue\'s consumers handle.' : 'The filter is applied first, then whether the consumer has a handler.', deliveryGrid(grid))
        : null,
      Object.keys(v.details).length ? box('Details', null, jsonView(v.details)) : null)));
}
