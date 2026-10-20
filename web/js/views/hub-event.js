// Compact event type page: the producers, the event type as the hub, and the consuming services with
// their outcome ("on <queue>" in muted text). Problem consumers first; past 12 the handled rest folds.
// A click on a service opens its card in the side panel. See design/mockups/hub-views.html, frame 3.

import { h } from '../dom.js';
import { flowLanes, connector } from '../components/flow-lanes.js';
import { wbr } from '../components/flow-nodes.js';
import { eventHub, foldList, matchesQuery } from '../../core/hub.js';
import { hubNode, outcomeBadge, plural, stub, tools } from './hub-parts.js';

const LIMIT = 12;

const where = (c) => (c.queues.length && c.direct ? `on ${plural(c.queues.length + c.direct, 'route')}, one a direct send`
  : c.queues.length > 1 ? `on ${c.queues.length} queues` : c.queues.length ? `on ${c.queues[0]}` : 'sent directly');
const ifSent = (c) => `if ${c.maybe.join(', ')} sends it${c.ifSent === 'no-handler' ? ', no handler' : ''}`;

/** `open(kind, service, el)` opens the side panel. The result has `.toolbar` and `.reveal()`. */
export function eventCompact(flow, { open }) {
  const box = h('div.hub');
  const hub = eventHub(flow);
  let query = '', unfolded = false, selected = null;

  const draw = () => {
    const matched = query ? hub.consumers.filter((c) => matchesQuery(query, c.service, ...c.queues)) : hub.consumers;
    const { shown, hidden } = query || unfolded ? { shown: matched, hidden: [] } : foldList(matched, LIMIT);
    const n = Math.max(shown.length + (hidden.length ? 1 : 0), 1);
    const sure = hub.producers.some((p) => !p.possible);
    const cols = [[`Producers ${hub.producers.length}`, 'minmax(170px, 1fr)'], ['', '24px'], ['Event type', 'minmax(150px, 0.8fr)'], ['', '24px'], [`Consumers ${hub.consumers.length}`, 'minmax(240px, 1.6fr)']];
    const lanes = flowLanes(cols.map(([head, width]) => ({ head, width })), {
      hint: 'Scroll to see the consumers',
      legend: [{ t: 'sns', text: 'Publish' }, { t: 'sqs', text: 'Delivered through a queue' }, ...(hub.producers.some((p) => p.possible) || hub.consumers.some((c) => c.outcome === 'possible') ? [{ t: 'sns', dash: true, text: 'Possible: only if the possible producer sends it' }] : [])],
    });
    const sticky = shown.length > 3;
    lanes.put(h('div.lane-stack', hub.producers.length ? hub.producers.map((p) => {
      const el = h('div.lane-node.svc.hub-pub', { role: 'button', tabindex: '0' }, h('div.nm', wbr(p.name)), p.possible ? h('span.possible-chip', 'Possible') : null);
      el.addEventListener('click', () => pick(el, 'producer', p.name));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.click(); });
      return el;
    }) : h('div.lane-node.empty', 'No harvested service publishes it. Its producer\'s harvester may be missing.')), 0, 0, n, { sticky });
    lanes.arrow(1, 0, 'sns', { span: n, top: sticky, dash: !sure });
    lanes.put(hubNode(flow.type, 'Event type', 'async', [[hub.producers.length, hub.producers.length === 1 ? 'producer' : 'producers'], [hub.consumers.length, hub.consumers.length === 1 ? 'consumer' : 'consumers']]), 2, 0, n, { sticky });
    shown.forEach((c, i) => {
      lanes.put(connector(n === 1 ? 'arrow' : `fan ${i === 0 ? 'first' : i === n - 1 && !hidden.length ? 'last' : 'mid'}`, 'sqs', c.outcome === 'possible'), 3, i);
      lanes.put(consumerNode(c), 4, i);
    });
    if (hidden.length) {
      lanes.put(connector('fan last', 'sqs'), 3, shown.length);
      lanes.put(stub(`${plural(hidden.length, 'more consumer')}, all handled`, hidden.length, () => { unfolded = true; render(); }), 4, shown.length);
    }
    if (!shown.length) lanes.put(h('div.lane-node.empty', query ? `No service matches "${query}".` : 'Nothing delivers it to a harvested consumer yet.'), 4, 0);
    return lanes.el;
  };

  function pick(el, kind, name) {
    selected?.classList.remove('selected');
    selected = el;
    el.classList.add('selected');
    open(kind, name, el);
  }

  function consumerNode(c) {
    const el = h('div.lane-node.svc.hub-c', { id: c.rowId, class: c.problem ? 'bad' : '', role: 'button', tabindex: '0', 'aria-label': `${c.service}, consumer` },
      h('div.hub-q-head', h('div.hub-q-name', h('div.nm', wbr(c.service)), h('div.who', c.outcome === 'possible' ? ifSent(c) : where(c))), outcomeBadge(c.outcome)));
    el.addEventListener('click', () => pick(el, 'consumer', c.service));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.click(); });
    return el;
  }

  const render = () => box.replaceChildren(draw());
  render();
  const toolbar = tools({ placeholder: 'Find a service', onQuery: (q) => { query = q; render(); } });
  return Object.assign(box, { toolbar: toolbar.el, reveal: () => { if (!unfolded) { unfolded = true; render(); } } });
}
