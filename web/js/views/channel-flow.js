// The lane block of a channel page. A topic, bus or exchange fans out: publisher, topic, subscription
// filter, queue, consumer. A queue is fed: source, subscription filter, this queue, consumer.
// Beyond 8 rows the lanes collapse behind "Show all"; beyond 4 rows the shared nodes stay in view
// while scrolling. See docs/UI-GUIDE.md §2.

import { h } from '../dom.js';
import { flowLanes, filterCell, filterLabelCell, transportOf } from '../components/flow-lanes.js';
import { channelNode, consumerNode, publisherNode } from '../components/flow-nodes.js';
import { declaration } from '../components/declaration.js';
import { showAll } from '../components/show-all.js';
import { channelLink } from './inventory-links.js';

const ROW_LIMIT = 8;
const STICKY_ROWS = 4;
const NOUN = { 'sns-topic': 'Topic', 'eventbridge-bus': 'Event bus', 'amqp-exchange': 'Exchange' };
const LEGEND = { sns: 'SNS publish and fan-out', eventbridge: 'EventBridge publish and rules', amqp: 'RabbitMQ publish and routing', sqs: 'SQS deliver and poll' };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One legend entry per transport that is drawn, plus the dashed one when a hop is uncertain. */
const legendFor = (ts, uncertainT) => [
  ...[...new Set(ts)].filter((t) => LEGEND[t]).map((t) => ({ t, text: LEGEND[t] })),
  ...(uncertainT ? [{ t: uncertainT, dash: true, text: 'Uncertain: declarations disagree' }] : []),
];

/** The filter column of a row: a label on the connector when everything passes, else the declaration. */
function filterFor(row, t, { tip }) {
  const f = row.filter;
  if (!f) return filterLabelCell('sent directly', { id: row.id, t, tip, title: 'Publishers send straight to the queue, with no subscription filter' });
  if (f.agree && f.events === '*') return filterLabelCell('all events', { id: row.id, t, tip, title: `Declared by ${f.declarations.map((d) => d.service).join(', ')}` });
  return filterCell(declaration(f), { id: row.id, t, dash: !f.agree, tip });
}

/** Returns an element with `.reveal()` that expands collapsed rows. */
export function flowBlock(v) {
  return v.flow.layout === 'fanout' ? fanout(v) : inbound(v);
}

function fanout(v) {
  const t = transportOf(v.kind);
  const isBus = v.kind === 'eventbridge-bus';
  const rows = v.flow.rows;
  const queues = rows.every((r) => /queue/.test(r.to.kind));
  const widths = ['minmax(150px, 0.8fr)', '24px', 'minmax(120px, 0.6fr)', '28px', 'minmax(190px, 0.9fr)', 'minmax(150px, 1.2fr)', '24px', 'minmax(170px, 1.2fr)'];
  const heads = ['Publisher', '', NOUN[v.kind] ?? 'Channel', '', isBus ? 'Rule' : 'Subscription filter', queues ? 'Queue' : 'Target', '', 'Consumer and handler'];
  const publisher = () => h('div.lane-stack',
    v.publishers.length ? publisherNode(v.publishers) : h('div.lane-node.empty', 'No harvested service publishes here. The publisher\'s harvester may be missing.'),
    v.feeds.map((k) => h('div.lane-node.chan', { 'data-t': t }, h('div.who', 'Fed by'), channelLink(k))));
  const draw = (shown, control) => {
    const n = Math.max(shown.length, 1);
    const sticky = shown.length > STICKY_ROWS;
    const cols = rows.length ? heads.map((head, i) => ({ head, width: widths[i] })) : heads.slice(0, 3).map((head, i) => ({ head, width: ['minmax(170px, 360px)', '48px', 'minmax(160px, 260px)'][i] }));
    const lanes = flowLanes(cols, {
      footer: control,
      hint: 'Scroll to see queues and consumers',
      legend: legendFor([t, ...rows.map((r) => transportOf(r.to.kind))], rows.some((r) => !r.filter.agree) ? t : null),
    });
    lanes.put(publisher(), 0, 0, n, { sticky });
    lanes.arrow(1, 0, t, { span: n, top: sticky });
    lanes.put(channelNode({ key: v.key, name: v.name, kind: v.kind, known: true }, { here: true, sub: rows.length ? plural(rows.length, queues ? 'queue' : 'target') : 'no subscriptions' }), 2, 0, n, { sticky });
    shown.forEach((row, i) => {
      if (i === 0) lanes.fan(3, 0, n, t, !row.filter.agree);
      lanes.put(filterFor(row, t, { tip: true }), 4, i);
      lanes.put(channelNode(row.to), 5, i);
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
  const widths = ['minmax(130px, 0.8fr)', '28px', 'minmax(190px, 0.9fr)', '40px', 'minmax(160px, 1.2fr)', '24px', 'minmax(180px, 1.2fr)'];
  const heads = [topics ? 'Topic' : 'Source', '', 'Subscription filter', '', 'This queue', '', 'Consumer and handler'];
  const draw = (shown, control) => {
    const n = Math.max(shown.length, 1);
    if (!rows.length) {
      const lanes = flowLanes([{ head: 'This queue', width: 'minmax(160px, 280px)' }, { head: '', width: '48px' }, { head: 'Consumer and handler', width: 'minmax(180px, 360px)' }]);
      lanes.put(channelNode(here, { here: true }), 0, 0);
      lanes.arrow(1, 0, qt);
      lanes.put(consumerNode(v.flow.consumers), 2, 0);
      return lanes.el;
    }
    const sticky = shown.length > STICKY_ROWS;
    const ts = shown.map((r) => (r.from ? transportOf(r.from.kind) : 'async'));
    const joinT = new Set(ts).size === 1 ? ts[0] : 'async';
    const lanes = flowLanes(heads.map((head, i) => ({ head, width: widths[i] })), {
      footer: control,
      hint: 'Scroll to see the queue and its consumers',
      legend: legendFor([...ts, qt], rows.some((r) => r.filter && !r.filter.agree) ? 'sns' : null),
    });
    shown.forEach((row, i) => {
      lanes.put(row.from ? channelNode(row.from) : publisherNode(row.direct), 0, i);
      lanes.arrow(1, i, ts[i]);
      lanes.put(filterFor(row, ts[i], { tip: false }), 2, i);
    });
    if (n === 1) lanes.arrow(3, 0, joinT, { dash: !!shown[0].filter && !shown[0].filter.agree });
    else {
      lanes.merge(3, 0, n, ts, shown.map((r) => !!r.filter && !r.filter.agree));
      lanes.arrow(3, 0, joinT, { span: n, half: true, top: sticky });
    }
    lanes.put(channelNode(here, { here: true }), 4, 0, n, { sticky });
    lanes.arrow(5, 0, qt, { span: n, top: sticky });
    lanes.put(consumerNode(v.flow.consumers), 6, 0, n, { sticky });
    return lanes.el;
  };
  return showAll(rows, ROW_LIMIT, draw, 'upstream sources');
}
