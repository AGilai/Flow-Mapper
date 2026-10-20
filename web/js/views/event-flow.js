// The lane block of an event page: producer, topic, queue, consumer, left to right. Producers that feed the same
// topic or queue share one block (a bracket into one topic, queue and consumer node, 8 shown then "N more
// producers"). One producer node per
// service (its call sites merge), one consumer node per service (its ingresses and queues merge, with a
// bracket). A direct send passes through the topic column as a labelled line; a possible producer has a
// dashed edge with a tooltip. Collapsed rows sit inside their fan. See docs/UI-GUIDE.md §2.

import { h } from '../dom.js';
import { flowLanes, connector, transportOf } from '../components/flow-lanes.js';
import { channelNode } from '../components/flow-nodes.js';
import { consumerNode, producerNode } from '../components/event-nodes.js';
import { prepare, collapse, ROW_LIMIT } from './event-slots.js';

const STICKY = { sns: '--t-sns', sqs: '--t-sqs', eventbridge: '--t-eb', amqp: '--t-amqp', async: '--t-res' };
const LEGEND = { sns: 'SNS publish and fan-out', eventbridge: 'EventBridge publish and rules', amqp: 'RabbitMQ publish and routing', sqs: 'SQS send and deliver' };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const tipFor = (block, type) => {
  const cands = [...new Set(block.group.callSites.filter((c) => c.possible).flatMap((c) => c.candidates))];
  return h('span.tip-pop', `${block.group.producer} chooses the event type at runtime. `,
    cands.length > 1 ? ['This is one of ', `${cands.length} candidates: `, cands.map((c, i) => [i ? ', ' : '', h('code', { class: c === type ? 'hl' : '' }, c)])]
      : 'It may send this type.');
};

/** `open(kind, service, el)` is called when a service node is clicked. The result has `.reveal()`. */
export function eventFlowBlock(flow, { type, open }) {
  const box = h('div.show-all');
  let expanded = false;
  const bs = prepare(flow);

  const draw = () => {
    const info = collapse(bs, expanded);
    const hasTopic = bs.some((b) => b.unresolved.length || b.targets.some((t) => t.target.topic));
    const C = hasTopic ? { prod: 0, c1: 1, topic: 2, c2: 3, queue: 4, c3: 5, cons: 6 } : { prod: 0, c1: 1, queue: 2, c3: 3, cons: 4 };
    const widths = ['minmax(110px, 1fr)', '26px', ...(hasTopic ? ['minmax(96px, 0.8fr)', '30px'] : []), 'minmax(130px, 1.05fr)', '30px', 'minmax(236px, 1.45fr)'];
    const heads = ['Producer', '', ...(hasTopic ? ['Topic', ''] : []), 'Queue', '', 'Consumer · handler · outcome'];
    const queues = bs.some((b) => b.targets.some((t) => t.shown.length || t.hidden));
    const unresolved = bs.some((b) => b.unresolved.length);
    const used = new Set([...(queues ? ['sqs'] : []), ...bs.flatMap((b) => b.targets.flatMap((t) => (t.target.topic ? [transportOf(t.target.topic.kind)] : [])))]);
    const dashed = bs.some((b) => b.anyPossible);
    const legend = [...used].filter((t) => LEGEND[t]).map((t) => ({ t, text: LEGEND[t] }));
    if (dashed) legend.push({ t: [...used].find((t) => t !== 'sqs') ?? 'sqs', dash: true, text: 'Possible: the type is chosen at runtime' });
    if (unresolved) legend.push({ t: 'async', dash: true, text: 'Target not resolved' });
    const unfedBlock = bs.some((b) => !b.group);
    const footer = [
      expanded && (info.total > ROW_LIMIT || info.producers) ? h('button.btn.ghost.show-more', { type: 'button', on: { click: () => { expanded = false; render(); } } }, 'Show fewer') : null,
      unfedBlock ? h('p.lane-foot', 'Topics and queues still come from the consumers\' subscriptions. Outcome lines are hidden: nothing is delivered.') : null,
    ].filter(Boolean);
    const lanes = flowLanes(widths.map((width, i) => ({ head: heads[i], width })), { hint: 'Scroll to see the consumers and their outcome', legend, footer: footer.length ? footer : null });
    let r = 0;

    bs.forEach((b, bi) => {
      if (bi) { lanes.put(h('div.lane-gap'), 0, r++, 1).style.gridColumn = '1 / -1'; }
      const start = r;
      const slots = [];
      for (const t of b.targets) {
        t.first = slots.length;
        t.shown.forEach((row) => slots.push({ t, row }));
        if (t.hidden) slots.push({ t, stub: t.hidden });
        if (!t.rows.length) slots.push({ t, none: true });
        t.n = slots.length - t.first;
      }
      b.unresolved.forEach((u) => slots.push({ u }));
      if (!slots.length) slots.push({ none: true });
      const unfed = !b.group;
      // Several producers into one topic or queue: a node each, joined by a bracket into the one node after them.
      const merged = b.groups.length > 1;
      const items = merged ? [...b.producers.map((g) => ({ g })), ...(b.producersHidden ? [{ more: b.producersHidden }] : [])] : [];
      const height = Math.max(slots.length, items.length);
      const who = b.groups.filter((g) => g.drawnPossible).map((g) => g.producer);
      const producerName = who.length > 2 ? `any of ${who.length} producers` : who.length ? who.join(' or ') : b.group?.producer;

      // Producer, and one branch per direct send, per topic and per unresolved call site.
      const branches = [];
      if (merged) {
        const t0 = b.targets[0].target;
        const tt = t0.topic ? transportOf(t0.topic.kind) : 'sqs';
        items.forEach((it, i) => {
          if (it.g) {
            const pn = producerNode(it.g, () => open('producer', it.g.producer, pn), { possible: it.g.drawnPossible });
            lanes.put(pn, C.prod, start + i);
          } else {
            lanes.put(h('div.lane-stub.col', h('span', plural(it.more, 'more producer')),
              h('button.btn.ghost', { type: 'button', on: { click: () => { expanded = true; draw(); } } }, `Show all ${b.groups.length}`)), C.prod, start + i);
          }
          const c = connector(`merge ${i === 0 ? 'first' : i === items.length - 1 ? 'last' : 'mid'}`, tt, it.g?.drawnPossible);
          if (it.g?.drawnPossible) { c.classList.add('has-tip'); c.append(tipFor({ group: it.g }, type)); }
          lanes.put(c, C.c1, start + i);
        });
        lanes.arrow(C.c1, start, tt, { span: items.length, half: true });
      } else {
        const pn = producerNode(b.group, () => open('producer', b.group.producer, pn), { possible: b.targets.some((t) => t.target.possible) });
        lanes.put(pn, C.prod, start, slots.length, { sticky: true });
      }
      if (!merged) b.targets.forEach((t) => {
        const tt = t.target.topic ? transportOf(t.target.topic.kind) : 'sqs';
        if (t.target.topic) used.add(tt);
        if (t.target.topic) branches.push({ at: t.first, t: tt, dash: t.target.possible, tip: t.target.possible && !unfed });
        else for (let k = 0; k < t.n; k++) branches.push({ at: t.first + k, t: 'sqs', dash: t.target.possible, tip: t.target.possible && !unfed });
      });
      slots.forEach((s, k) => { if (s.u) branches.push({ at: k, t: 'async', dash: true, tip: false }); });
      branches.sort((x, y) => x.at - y.at);
      const trunk = b.targets.find((t) => t.target.topic);
      if (!merged) {
      branches.forEach((br, k) => {
        const cls = branches.length === 1 ? 'arrow' : `fan ${k === 0 ? 'first' : k === branches.length - 1 ? 'last' : 'mid'}`;
        const c = connector(cls, br.t, br.dash);
        if (unfed) c.classList.add('muted');
        if (br.tip) { c.classList.add('has-tip'); c.append(tipFor(b, type)); }
        if (trunk && branches.length > 1) c.style.setProperty('--trunk', `var(${STICKY[transportOf(trunk.target.topic.kind)]})`);
        lanes.put(c, C.c1, start + br.at);
        const next = branches[k + 1];
        for (let g = br.at + 1; next && g < next.at; g++) lanes.put(connector('fan mid thru', br.t), C.c1, start + g);
      });
      }

      // Topics, queues, consumers.
      b.targets.forEach((t) => {
        const topic = t.target.topic;
        const rowAt = (k) => start + t.first + k;
        if (topic) {
          const node = channelNode(topic, { sub: t.rows.length ? plural(t.rows.length, 'queue') : t.all ? 'no queue gets it' : 'no subscriptions' });
          node.classList.add('topic');
          lanes.put(node, C.topic, rowAt(0), t.n, { sticky: true });
          const ts = transportOf(topic.kind);
          for (let k = 0; k < t.n; k++) {
            const gap = k === t.n - 1 && !t.rows.length;
            if (gap) lanes.put(connector('plain muted'), C.c2, rowAt(k));
            else lanes.put(connector(t.n === 1 ? 'arrow' : `fan ${k === 0 ? 'first' : k === t.n - 1 ? 'last' : 'mid'}`, ts), C.c2, rowAt(k));
          }
        } else if (hasTopic) {
          for (let k = 0; k < t.n; k++) {
            lanes.put(h('div.lane-pass', { 'data-t': 'sqs' }, h('span', 'direct send')), C.topic, rowAt(k));
            lanes.put(connector('arrow', 'sqs'), C.c2, rowAt(k));
          }
        }
      });
      slots.forEach((s, k) => {
        const row = start + k;
        const span = (from, to, node) => { lanes.put(node, from, row, 1).style.gridColumn = `${from + 1} / ${to + 2}`; };
        if (s.row) {
          const via = s.row.via.length ? `via ${s.row.via.join(', ')}` : null;
          lanes.put(s.row.queue ? channelNode(s.row.queue, { sub: via }) : h('div.lane-pass', { 'data-t': 'sns' }, h('span', 'no queue')), C.queue, row);
        } else if (s.stub) {
          span(C.queue, C.cons, h('div.lane-stub', h('span', `${plural(s.stub, 'more queue')} from ${s.t.target.topic?.name ?? 'direct sends'}, handled`),
            h('button.btn.ghost', { type: 'button', on: { click: () => { expanded = true; draw(); } } }, `Show all ${s.t.rows.length} queues`)));
        } else if (s.none) {
          const t = s.t?.target;
          span(C.queue, C.cons, h('div.lane-node.empty', t?.topic
            ? (s.t.all ? `${s.t.all === 1 ? 'The subscription filters' : `All ${s.t.all} subscriptions filter`} it out, so nothing reads it. If a service should, add it to that service's subscription filter.` : 'Nothing subscribes to this topic yet. The subscriber\'s harvester may be missing.')
            : 'No harvested service reads it. Its consumer\'s harvester may be missing.'));
        } else if (s.u) {
          span(hasTopic ? C.topic : C.queue, hasTopic ? C.queue : C.cons, h('div.lane-node.empty', 'Target not resolved by the harvester: ', s.u.reason, '. ', s.u.at?.url ? h('a', { href: s.u.at.url, target: '_blank', rel: 'noopener noreferrer' }, 'See the call site') : null));
        }
      });
      // Consumers: one node per run of rows that reach the same service, with a bracket when it spans several.
      for (let k = 0; k < slots.length; k++) {
        const s = slots[k];
        if (!s.row) continue;
        const row = start + k;
        if (!s.row.consumer) {
          lanes.put(connector('arrow', 'sqs', true), C.c3, row);
          lanes.put(h('div.lane-node.empty', 'No harvested service reads this queue. Its consumer\'s harvester may be missing.'), C.cons, row);
          continue;
        }
        let n = 1;
        while (slots[k + n]?.row?.consumer === s.row.consumer) n++;
        const rows = slots.slice(k, k + n).map((x) => x.row);
        if (n === 1) lanes.put(connector('arrow', 'sqs'), C.c3, row);
        else {
          rows.forEach((_, i) => lanes.put(connector(`merge ${i === 0 ? 'first' : i === n - 1 ? 'last' : 'mid'}`, 'sqs'), C.c3, row + i));
          lanes.arrow(C.c3, row, 'sqs', { span: n, half: true });
        }
        const service = s.row.consumer;
        const node = consumerNode(service, rows, producerName, () => open('consumer', service, node), { outcome: !unfed });
        lanes.put(node, C.cons, row, n);
        k += n - 1;
      }
      r += height;
    });

    lanes.el.querySelector('.lane-grid').classList.add('ev');
    return lanes.el;
  };

  const render = () => box.replaceChildren(draw());
  box.reveal = () => { if (!expanded) { expanded = true; render(); } };
  render();
  return box;
}
