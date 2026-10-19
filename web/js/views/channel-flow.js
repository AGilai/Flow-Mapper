// The lane block of a channel page. A topic, bus or exchange fans out: publisher, topic, subscription
// filter, queue, consumer. A queue is fed: topic, subscription filter, this queue, consumer.
// Beyond 8 rows the lanes collapse behind "Show all". See docs/UI-GUIDE.md §2.

import { h } from '../dom.js';
import { flowLanes, filterCell, transportOf } from '../components/flow-lanes.js';
import { channelNode, consumerNode, publisherNode } from '../components/flow-nodes.js';
import { declaration } from '../components/declaration.js';
import { showAll } from '../components/show-all.js';
import { channelLink } from './inventory-links.js';

const ROW_LIMIT = 8;
const NOUN = { 'sns-topic': 'Topic', 'eventbridge-bus': 'Event bus', 'amqp-exchange': 'Exchange' };
const TLABEL = { sns: 'SNS', sqs: 'SQS', eventbridge: 'EventBridge', amqp: 'RabbitMQ' };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Returns an element with `.reveal()` that expands collapsed rows. */
export function flowBlock(v) {
  return v.flow.layout === 'fanout' ? fanout(v) : inbound(v);
}

function fanout(v) {
  const t = transportOf(v.kind);
  const isBus = v.kind === 'eventbridge-bus';
  const rows = v.flow.rows;
  const queues = rows.every((r) => /queue/.test(r.to.kind));
  const widths = ['minmax(160px, 0.9fr)', '28px', 'minmax(150px, 0.8fr)', '36px', 'minmax(280px, 1.3fr)', 'minmax(220px, 1.3fr)', '28px', 'minmax(240px, 1.4fr)'];
  const heads = ['Publisher', '', NOUN[v.kind] ?? 'Channel', '', isBus ? 'Rule' : 'Subscription filter', queues ? 'Queue' : 'Target', '', 'Consumer and handler'];
  const publisher = () => h('div.lane-stack',
    v.publishers.length ? publisherNode(v.publishers) : h('div.lane-node.empty', 'No harvested service publishes here yet.'),
    v.feeds.map((k) => h('div.lane-node.chan', { 'data-t': t }, h('div.who', 'Fed by'), channelLink(k))));
  const draw = (shown) => {
    const n = Math.max(shown.length, 1);
    const lanes = flowLanes(rows.length ? heads.map((head, i) => ({ head, width: widths[i] })) : heads.slice(0, 3).map((head, i) => ({ head, width: ['minmax(170px, 360px)', '48px', 'minmax(160px, 260px)'][i] })), {
      legend: rows.length ? [{ t, text: `${TLABEL[t] ?? 'Channel'} publish and fan-out` }, { t: transportOf(rows[0].to.kind), text: `${TLABEL[transportOf(rows[0].to.kind)] ?? 'Queue'} deliver and poll` }, ...(rows.some((r) => !r.filter.agree) ? [{ t, dash: true, text: 'Uncertain: declarations disagree' }] : [])] : [],
    });
    lanes.put(publisher(), 0, 0, n);
    lanes.arrow(1, 0, t, { span: n });
    lanes.put(channelNode({ key: v.key, name: v.name, kind: v.kind, known: true }, { here: true, sub: rows.length ? plural(rows.length, queues ? 'queue' : 'target') : 'no subscriptions' }), 2, 0, n);
    shown.forEach((row, i) => {
      const dash = !row.filter.agree;
      if (i === 0) lanes.fan(3, 0, n, t, dash);
      lanes.put(filterCell(declaration(row.filter), { id: row.id, t, dash }), 4, i);
      lanes.put(channelNode(row.to, { sub: row.to.eventTypes ? plural(row.to.eventTypes, 'event type') : null }), 5, i);
      lanes.arrow(6, i, transportOf(row.to.kind));
      lanes.put(consumerNode(row.consumers), 7, i);
    });
    return lanes.el;
  };
  return showAll(rows, ROW_LIMIT, draw, isBus ? 'rules' : 'subscriptions');
}

function inbound(v) {
  const rows = v.flow.rows;
  const here = { key: v.key, name: v.name, kind: v.kind, known: true };
  const qt = transportOf(v.kind);
  const topics = rows.every((r) => !r.from || r.from.kind === 'sns-topic');
  const widths = ['minmax(210px, 0.9fr)', 'minmax(300px, 1.4fr)', '24px', '24px', 'minmax(200px, 1fr)', '28px', 'minmax(240px, 1.5fr)'];
  const heads = [topics ? 'Topic' : 'Source', 'Subscription filter', '', '', 'This queue', '', 'Consumer and handler'];
  const draw = (shown) => {
    const n = Math.max(shown.length, 1);
    if (!rows.length) {
      const lanes = flowLanes([{ head: 'This queue', width: widths[4] }, { head: '', width: widths[5] }, { head: 'Consumer and handler', width: widths[6] }]);
      lanes.put(channelNode(here, { here: true }), 0, 0);
      lanes.arrow(1, 0, qt);
      lanes.put(consumerNode(v.flow.consumers), 2, 0);
      return lanes.el;
    }
    const lanes = flowLanes(heads.map((head, i) => ({ head, width: widths[i] })),
      { legend: [{ t: 'sns', text: 'Topic fan-out' }, { t: qt, text: `${TLABEL[qt] ?? 'Queue'} deliver and poll` }, ...(rows.some((r) => r.filter && !r.filter.agree) ? [{ t: 'sns', dash: true, text: 'Uncertain: declarations disagree' }] : [])] });
    shown.forEach((row, i) => {
      const t = row.from ? transportOf(row.from.kind) : 'async';
      const dash = !!row.filter && !row.filter.agree;
      lanes.put(row.from ? channelNode(row.from) : publisherNode(row.direct), 0, i);
      const box = row.filter ? declaration(row.filter) : h('div.decl', h('div.who', 'Sends straight to the queue, no subscription filter'));
      lanes.put(filterCell(box, { id: row.id, t, dash, tip: false }), 1, i);
    });
    lanes.merge(2, 0, n, shown.map((r) => (r.from ? transportOf(r.from.kind) : 'async')), shown.map((r) => !!r.filter && !r.filter.agree));
    lanes.arrow(3, 0, qt, { span: n });
    lanes.put(channelNode(here, { here: true }), 4, 0, n);
    lanes.arrow(5, 0, qt, { span: n });
    lanes.put(consumerNode(v.flow.consumers), 6, 0, n);
    return lanes.el;
  };
  return showAll(rows, ROW_LIMIT, draw, 'upstream sources');
}
