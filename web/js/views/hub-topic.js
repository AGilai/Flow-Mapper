// Compact topic page: producers, the topic, then its queues. Problem queues come first, then by name;
// past 12 the healthy rest folds into one stub. A queue row expands in place to the outcome of each event
// type; a click on an edge or a queue opens the info pane. The topic stays in view while scrolling.
// See design/mockups/hub-views.html, frame 1.

import { h } from '../dom.js';
import { flowLanes, connector, filterCell, transportOf } from '../components/flow-lanes.js';
import { eventChips } from '../components/event-chips.js';
import { channelLink, serviceLink } from './inventory-links.js';
import { foldList, matchesQuery, orderQueues, queueSummaries } from '../../core/hub.js';
import { badge, hubNode, markerChip, plural, stub, tools } from './hub-parts.js';

const LIMIT = 12;
const KIND = { 'sns-topic': 'SNS topic', 'eventbridge-bus': 'Event bus', 'amqp-exchange': 'Exchange' };

/** The expanded part of a queue row: the consumer, then the outcome of every event type. */
function detail(q, total) {
  const c = q.consumers[0];
  const filtered = h('div.hub-filtered', h('span.muted.small', `Filtered out ${q.filtered.length} of the ${total} types this topic carries.`));
  if (q.filtered.length) filtered.append(h('button.chip-more', { type: 'button', on: { click: (e) => { e.target.replaceWith(eventChips(q.filtered, { limit: 100 })); } } }, 'Show all'));
  return h('div.hub-detail',
    c ? h('div.hub-consumer', h('b', serviceLink(c.service)), h('span.mono.small.muted', `${c.ingress} calls ${c.handler}`)) : h('div.small.muted', 'No harvested service reads this queue.'),
    q.handled.length ? h('div.hub-out', h('span.hub-out-t.ok', h('i', '✓'), `Handled ${q.handled.length}`), eventChips(q.handled, { limit: 4 })) : null,
    q.noHandler.length ? h('div.hub-out', h('span.hub-out-t.bad', h('i', '!'), `Arrives, no handler ${q.noHandler.length}`), h('ul.hub-list', q.noHandler.slice(0, 6).map((t) => h('li', t)),
      q.noHandler.length > 6 ? h('li', h('button.chip-more', { type: 'button', on: { click: (e) => e.target.closest('li').replaceWith(...q.noHandler.slice(6).map((t) => h('li', t))) } }, `+${q.noHandler.length - 6} more`)) : null)) : null,
    q.filtered.length ? filtered : null);
}

/** `v` is the channel API response (topic, bus or exchange). `pane(row)` opens the info pane. Returns an element with `.reveal(rowId)`. */
export function topicCompact(v, { openEdge }) {
  const box = h('div.hub');
  const t = transportOf(v.kind);
  const flow = v.flow;
  const all = orderQueues(queueSummaries(flow));
  const total = flow.grid.rows.filter((r) => !r.possible).length;
  const rowOf = new Map(flow.rows.map((r) => [r.id, r]));
  const open = new Set();
  let query = '', unfolded = false, allPubs = false, selected = null;
  // One node per service, however many egresses it publishes through.
  const byService = new Map();
  for (const p of v.publishers) {
    const cur = byService.get(p.service) ?? { service: p.service, events: new Set(), possible: new Set() };
    p.events.forEach((e) => cur.events.add(e));
    p.possible.forEach((e) => cur.possible.add(e));
    byService.set(p.service, cur);
  }
  const pubs = [...byService.values()].map((p) => ({ ...p, events: [...p.events], possible: [...p.possible].filter((e) => !p.events.has(e)) })).sort((a, b) => a.service.localeCompare(b.service));

  const draw = () => {
    const matched = query ? all.filter((q) => matchesQuery(query, q.queue.name, ...q.consumers.map((c) => c.service))) : all;
    const { shown, hidden } = query || unfolded ? { shown: matched, hidden: [] } : foldList(matched, LIMIT);
    const n = Math.max(shown.length + (hidden.length ? 1 : 0), 1);
    const cols = [['Producers', 'minmax(120px, 0.8fr)'], ['', '24px'], [KIND[v.kind] ?? 'Channel', 'minmax(140px, 0.55fr)'], ['', '24px'], ['', '96px'], [`Queues ${all.length}`, 'minmax(220px, 1.7fr)']];
    const lanes = flowLanes(cols.map(([head, width]) => ({ head, width })), {
      hint: 'Scroll to see the queues',
      legend: [{ t, text: 'SNS publish and fan-out' }, ...(all.some((q) => q.disagree) ? [{ t, dash: true, text: 'Uncertain: declarations disagree' }] : [])],
    });
    const sticky = shown.length > 3;
    const list = allPubs ? pubs : pubs.slice(0, LIMIT);
    lanes.put(h('div.lane-stack', list.map((p) => h('div.lane-node.svc.hub-pub', h('div.nm', serviceLink(p.service)),
      h('div.who', p.events.length ? plural(p.events.length, 'type') : 'types not listed', p.possible?.length && !p.events.length ? `, may send ${p.possible.length}` : ''),
      p.events.length === 0 && p.possible?.length ? h('span.possible-chip', 'Possible') : null)),
      pubs.length > LIMIT && !allPubs ? stub(`${pubs.length - LIMIT} more services`, pubs.length, () => { allPubs = true; render(); }) : null,
      !pubs.length ? h('div.lane-node.empty', 'No harvested service publishes here.') : null), 0, 0, n, { sticky });
    lanes.arrow(1, 0, t, { span: n, top: sticky });
    lanes.put(hubNode(v.name, KIND[v.kind] ?? 'Channel', t, [[total, total === 1 ? 'event type' : 'event types'], [all.length, all.length === 1 ? 'queue out' : 'queues out']]), 2, 0, n, { sticky });

    shown.forEach((q, i) => {
      const row = rowOf.get(q.rowId);
      lanes.put(connector(n === 1 ? 'arrow' : `fan ${i === 0 ? 'first' : i === n - 1 && !hidden.length ? 'last' : 'mid'}`, t, q.disagree), 3, i);
      const edge = filterCell(markerChip(q.marker, () => {}), { t, dash: q.disagree, tip: true });
      edge.classList.add('hub-edge');
      edge.addEventListener('click', () => pick(q, edge));
      lanes.put(edge, 4, i);
      lanes.put(queueNode(q, row), 5, i);
    });
    if (hidden.length) {
      const i = shown.length;
      lanes.put(connector(`fan ${shown.length ? 'last' : 'first'}`, t), 3, i);
      const s = stub(`${plural(hidden.length, 'more queue', 'more queues')}, all handled`, all.length, () => { unfolded = true; render(); });
      lanes.put(s, 4, i).style.gridColumn = '5 / 7';
    }
    if (!shown.length) lanes.put(h('div.lane-node.empty', query ? `No queue or service matches "${query}".` : 'Nothing subscribes to this topic yet. The subscriber\'s harvester may be missing.'), 5, 0);
    return lanes.el;
  };

  const pick = (q, el) => {
    selected?.classList.remove('selected');
    selected = el;
    el.classList.add('selected');
    openEdge(rowOf.get(q.rowId), el);
  };

  function queueNode(q, row) {
    const c = q.consumers[0];
    const isOpen = open.has(q.rowId);
    const el = h('div.lane-node.chan.hub-q', { id: row.id, 'data-t': 'sqs', class: q.noHandler.length ? 'bad' : q.disagree ? 'warn' : '' },
      h('div.hub-q-head',
        h('button.hub-chev', { type: 'button', 'aria-expanded': String(isOpen), 'aria-label': `${isOpen ? 'Collapse' : 'Expand'} ${q.queue.name}`, on: { click: (e) => { e.stopPropagation(); open.has(q.rowId) ? open.delete(q.rowId) : open.add(q.rowId); render(); } } }, isOpen ? '⌄' : '›'),
        h('div.hub-q-name', channelLink(q.queue.key, q.queue.name), h('div.who', c ? (q.consumers.length > 1 ? `${c.service} and ${q.consumers.length - 1} more` : c.service) : 'no harvested reader')),
        badge({ noHandler: q.noHandler.length, ok: !!c })),
      isOpen ? detail(q, total) : null);
    el.addEventListener('click', (e) => { if (!e.target.closest('a,button')) pick(q, el); });
    return el;
  }

  const render = () => box.replaceChildren(draw());
  render();
  const reveal = (id) => { const q = all.find((x) => x.rowId === id); if (q && !unfolded && !query) { unfolded = true; render(); } };
  const toolbar = tools({
    placeholder: 'Find a queue or service',
    onQuery: (q) => { query = q; render(); },
    onExpand: (on) => { all.forEach((q) => (on ? open.add(q.rowId) : open.delete(q.rowId))); render(); },
  });
  return Object.assign(box, { reveal, toolbar: toolbar.el });
}
