// Flows: pick a starting point (entry point, ingress or function), see its sequence diagram.
// Starts inside the service ("Inside the service"), then expands to the whole route ("Full flow").

import { h, clear, fill, debounce } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { href, setQuery } from '../router.js';
import { pageHead } from '../components/page.js';
import { createPanel, section } from '../components/panel.js';
import { chip, splitKey } from '../format.js';
import { renderSequence } from './sequence-render.js';

const LIST_CAP = 300;

export async function render({ main, query }) {
  const service = query.get('service');
  const start = { service, ingress: query.get('ingress'), fn: query.get('fn'), event: query.get('event') };
  const opts = {
    scope: query.get('scope') ?? (start.fn ? 'intra' : 'full'),
    internal: query.get('internal') !== '0', stores: query.get('stores') !== '0', depth: query.get('depth') ?? 'all',
  };

  // Starting points: a service's ingress, or every entry point in the environment.
  const points = service
    ? (await api.service(state.env, service)).ingress.map((i) => ({ service, id: i.id, bindKey: i.bindKey, transport: i.transport, handler: i.handler, entryPoint: i.entryPoint }))
    : await api.entryPoints(state.env);

  const listBody = h('div.flows-scroll');
  const filter = h('input.input', { type: 'search', placeholder: service ? 'Filter ingress' : 'Filter entry points', 'aria-label': 'Filter starting points' });
  const drawList = () => {
    const q = filter.value.trim().toLowerCase();
    const xs = points.filter((p) => !q || p.bindKey.toLowerCase().includes(q) || p.service.includes(q) || p.handler.toLowerCase().includes(q));
    const groups = new Map();
    for (const p of xs.slice(0, LIST_CAP)) { if (!groups.has(p.service)) groups.set(p.service, []); groups.get(p.service).push(p); }
    fill(listBody, 
      service ? h('a.small', { href: href('/flows'), style: { padding: '0 var(--s2)' } }, 'Show all entry points') : null,
      [...groups].map(([svc, ps]) => [h('h3', svc), ps.map((p) => h('a.entry', {
        href: href('/flows', { service: p.service, ingress: p.id, scope: opts.scope }),
        'aria-current': String(p.service === start.service && p.id === start.ingress),
      }, h('span.row', chip(p.transport), p.entryPoint ? h('span.xs.muted', 'entry point') : null), h('span.key', splitKey(p.bindKey).rest)))]),
      xs.length > LIST_CAP ? h('p.xs.muted', { style: { padding: 'var(--s2)' } }, `${xs.length - LIST_CAP} more. Type to narrow the list.`) : null,
      !xs.length ? h('p.small.muted', { style: { padding: 'var(--s2)' } }, 'No starting points match.') : null);
  };
  filter.addEventListener('input', debounce(drawList, 120));
  drawList();

  const mainPane = h('div.flows-main');
  const panel = createPanel(mainPane, { onClose: () => mainPane.querySelector('.msg.active')?.classList.remove('active') });

  main.append(
    pageHead('Flows', service ? `Starting points in ${service}` : `${points.length} entry points in ${state.env}`),
    h('div.content.flush', h('div.flows', h('aside.flows-list', h('div.search', icon('search'), filter), listBody), mainPane)));

  if (!start.ingress && !start.fn) {
    mainPane.append(h('div.empty', h('h2', 'Pick a starting point'),
      h('p', 'Choose an entry point on the left to see every call, queue and data store it touches, in order.')));
    return { dispose: panel.dispose };
  }

  let trace;
  const scroller = h('div.seq-scroll');
  const info = h('span.small.muted');
  const seg = h('div.seg', { role: 'group', 'aria-label': 'Scope' }, [['intra', 'Inside the service'], ['full', 'Full flow']].map(([id, label]) =>
    h('button', { 'aria-pressed': String(opts.scope === id), on: { click: async () => { opts.scope = id; persist(); await load(); seg.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(['intra', 'full'][i] === id))); } } }, label)));
  const check = (key, label) => h('label.check', h('input', { type: 'checkbox', checked: opts[key], on: { change: (e) => { opts[key] = e.target.checked; persist(); draw(); } } }), label);
  const depth = h('select.select', { 'aria-label': 'Depth', on: { change: (e) => { opts.depth = e.target.value; persist(); draw(); } } },
    ['all', '1', '2', '3', '4', '6', '8'].map((d) => h('option', { value: d, selected: d === opts.depth }, d === 'all' ? 'All depths' : `Depth ${d}`)));

  mainPane.prepend(h('div.seq-toolbar', seg, check('internal', 'Internal calls'), check('stores', 'Data stores'), depth, h('span.spacer'), info), scroller);

  function persist() {
    setQuery({ scope: opts.scope, internal: opts.internal ? null : '0', stores: opts.stores ? null : '0', depth: opts.depth === 'all' ? null : opts.depth });
  }
  async function load() {
    fill(scroller, h('div.loading', 'Tracing…'));
    try {
      trace = await api.trace(state.env, { service: start.service, ingress: start.ingress, fn: start.fn, event: start.event, scope: opts.scope, maxMessages: 800 });
    } catch (err) {
      fill(scroller, h('div.content', h('div.error-box', err.message)));
      return;
    }
    draw();
  }
  function draw() {
    const seq = renderSequence(trace, {
      internal: opts.internal, stores: opts.stores, maxDepth: opts.depth === 'all' ? Infinity : Number(opts.depth),
      onMessage: (m, g) => { mainPane.querySelector('.msg.active')?.classList.remove('active'); g.classList.add('active'); panel.open(...messagePanel(m, trace)); },
    });
    const services = new Set(trace.messages.map((m) => m.service).filter(Boolean));
    info.textContent = `${trace.start.event ? `${trace.start.event}: ` : ''}${seq.shown} of ${seq.total} steps, ${services.size} services${trace.truncated ? ', truncated' : ''}`;
    fill(scroller, seq.el);
  }
  await load();
  return { dispose: panel.dispose };
}

function messagePanel(m, trace) {
  const p = (id) => trace.participants.find((x) => x.id === id);
  const kind = { entry: 'Entry', call: 'Function call', egress: m.mode === 'async' ? 'Publish / async call' : 'Call', deliver: 'Delivery from queue', resource: 'Data store access' }[m.kind];
  const head = h('div.stack', { style: { gap: '2px' } }, h('h2', kind), h('span.small.muted', `Depth ${m.depth}`));
  return [head,
    h('dl.kv',
      h('dt', 'From'), h('dd', p(m.from)?.label ?? m.from),
      h('dt', 'To'), h('dd', { class: m.broken ? 'key' : '' }, p(m.to)?.label ?? m.to),
      h('dt', 'What'), h('dd.key', m.label),
      m.event ? [h('dt', 'Event type'), h('dd.key', m.event)] : null,
      m.transport && m.transport !== 'res' ? [h('dt', 'Transport'), h('dd', chip(m.transport))] : null,
      h('dt', 'Mode'), h('dd', m.mode),
      m.condition ? [h('dt', 'Only if'), h('dd', m.condition)] : null,
      m.loop ? [h('dt', 'Repeats'), h('dd', 'In a loop')] : null,
      m.note ? [h('dt', 'Note'), h('dd', m.note)] : null,
      m.service ? [h('dt', 'In'), h('dd', h('a', { href: href(`/services/${encodeURIComponent(m.service)}`) }, m.service), m.fn ? h('span.key', ` ${m.fn}`) : null)] : null),
    m.unhandled ? section('Why it is broken', null, h('p.small', `${m.event} reaches this consumer, but none of its event handlers matches it. It will fail or go to the dead-letter queue.`))
      : m.broken ? section('Why it is broken', null, h('p.small', 'No ingress, queue or route matches this key. Either the target was renamed, or a harvester produced a different key on one side.')) : null,
    m.cycle ? h('p.small.muted', 'This call leads back into a function already on the path, so the trace stops here.') : null];
}
