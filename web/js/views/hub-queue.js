// Compact queue page: the sources on the left with their filter on the edge, the queue in the middle,
// its consumers on the right with their outcome. Nothing is expanded or selected until a click.
// See design/mockups/hub-views.html, frame 2.

import { h } from '../dom.js';
import { flowLanes, connector, filterCell, transportOf } from '../components/flow-lanes.js';
import { channelNode, publisherNode, wbr } from '../components/flow-nodes.js';
import { serviceLink } from './inventory-links.js';
import { consumerOutcomes, foldList, markerOf } from '../../core/hub.js';
import { badge, hubNode, markerChip, plural, pressable, stub } from './hub-parts.js';

const LIMIT = 12;
const disagrees = (r) => !!r.filter && !r.filter.agree;

export function queueCompact(v, { openEdge, openConsumer }) {
  const box = h('div.hub');
  const flow = v.flow;
  const qt = transportOf(v.kind);
  const items = [...flow.rows].sort((a, b) => +disagrees(b) - +disagrees(a) || (a.from?.name ?? '~').localeCompare(b.from?.name ?? '~'))
    .map((row) => ({ row, problem: disagrees(row) }));
  const outs = consumerOutcomes(flow);
  const readers = outs.filter((o) => o.consumer).length;
  const types = flow.grid.rows.filter((r) => !r.possible).length;
  const topics = items.every((x) => !x.row.from || x.row.from.kind === 'sns-topic');
  let unfolded = false, selected = null;

  const pick = (el, fn) => { selected?.classList.remove('selected'); selected = el; el.classList.add('selected'); fn(); };

  const draw = () => {
    const { shown, hidden } = unfolded ? { shown: items, hidden: [] } : foldList(items, LIMIT);
    const n = Math.max(shown.length + (hidden.length ? 1 : 0), 1);
    const cols = [[`${topics ? 'Topics' : 'Sources'} ${items.length}`, 'minmax(140px, 1fr)'], ['', '96px'], ['', '24px'], ['This queue', 'minmax(150px, 0.7fr)'], ['', '24px'], [`Consumers ${readers}`, 'minmax(220px, 1.4fr)']];
    const lanes = flowLanes(cols.map(([head, width]) => ({ head, width })), {
      hint: 'Scroll to see the consumers',
      legend: [{ t: qt, text: 'Deliver and poll' }, ...(items.some((x) => x.problem) ? [{ t: qt, dash: true, text: 'Uncertain: declarations disagree' }] : [])],
    });
    shown.forEach(({ row }, i) => {
      const t = row.from ? transportOf(row.from.kind) : 'async';
      const dash = disagrees(row);
      lanes.put(row.from ? channelNode(row.from) : publisherNode(row.direct), 0, i);
      const edge = filterCell(markerChip(markerOf(row.filter), () => {}), { t, dash, tip: false });
      edge.classList.add('hub-edge');
      edge.addEventListener('click', () => pick(edge, () => openEdge(row)));
      pressable(edge, () => edge.click());
      lanes.put(edge, 1, i);
      lanes.put(connector(`merge ${n === 1 || i === 0 ? 'first' : i === n - 1 ? 'last' : 'mid'}`, t, dash), 2, i);
    });
    if (hidden.length) {
      lanes.put(connector('merge last', 'async'), 2, shown.length);
      lanes.put(stub(`${plural(hidden.length, 'more source')}`, items.length, () => { unfolded = true; render(); }), 0, shown.length).style.gridColumn = '1 / 3';
    }
    lanes.arrow(2, 0, qt, { half: true });
    lanes.put(hubNode(v.name, 'SQS queue', qt, [[items.length, items.length === 1 ? 'source' : 'sources'], [types, 'event types'], [readers, readers === 1 ? 'consumer' : 'consumers']]), 3, 0);
    lanes.arrow(4, 0, qt);
    lanes.put(h('div.lane-stack', outs.map((o) => consumerNode(o))), 5, 0);
    return lanes.el;
  };

  function consumerNode(o) {
    if (!o.consumer) return h('div.lane-node.empty', 'No harvested service reads this queue. Its consumer\'s harvester may be missing.');
    const c = o.consumer;
    const el = h('div.lane-node.svc.hub-c', { class: o.noHandler ? 'bad' : '', role: 'button', tabindex: '0' },
      h('div.hub-q-head', h('div.hub-q-name', h('div.nm', serviceLink(c.service, wbr(c.service))), h('div.sub-id', wbr(c.ingress), h('span.muted', ' calls '), wbr(c.handler))),
        o.noHandler ? badge({ noHandler: o.noHandler, text: `${o.noHandler} no handler` }) : null),
      h('div.hub-counts', h('span.hub-out-t.ok', h('i', '✓'), `Handled ${o.handled}`), o.possible ? h('span.hub-out-t.maybe', h('i', '?'), `Possible ${o.possible}`) : null));
    el.addEventListener('click', (e) => { if (!e.target.closest('a')) pick(el, () => openConsumer(o)); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.click(); });
    return el;
  }

  const render = () => box.replaceChildren(draw());
  render();
  return Object.assign(box, { reveal: () => { if (!unfolded) { unfolded = true; render(); } } });
}
