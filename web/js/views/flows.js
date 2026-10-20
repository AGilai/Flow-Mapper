// Flows: pick a starting point (entry point, ingress or function), see its sequence diagram.
// Starts inside the service ("Inside the service"), then expands to the whole route ("Full flow").

import { h, fill, debounce } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { href, setQuery, go } from '../router.js';
import { pageHead } from '../components/page.js';
import { createPanel } from '../components/panel.js';
import { chip, splitKey } from '../format.js';
import { renderSequence } from './sequence-render.js';
import { flowMenu } from './flow-menu.js';
import { messagePanel } from './flow-panel.js';
import { participantMenu } from './flow-menu.js';
import { resizer } from '../components/resizer.js';
import { describeCount } from '../../core/flow-counts.js';

const LIST_CAP = 300;

/** "(8)" after an entry point: distinct services, channels and stores its flow reaches; the breakdown is the tooltip. */
const countBadge = (c) => c ? h('span.count', { title: describeCount(c) }, ` (${c.total})`) : null;

export async function render({ main, query }) {
  const service = query.get('service');
  const start = { service, ingress: query.get('ingress'), fn: query.get('fn'), event: query.get('event') };
  const opts = {
    scope: query.get('scope') ?? (start.fn ? 'intra' : 'full'),
    internal: query.get('internal') !== '0', stores: query.get('stores') !== '0', queues: query.get('queues') !== '0', depth: query.get('depth') ?? 'all',
    expand: new Set((query.get('expand') ?? '').split(',').filter(Boolean)), // services shown function by function
    frontier: query.get('frontier') === '1', // steps the harvester marked as frontier (call trees that reach no sink)
  };

  // Starting points: a service's ingress, or every entry point in the environment.
  const points = service
    ? (await api.service(state.env, service)).ingress.map((i) => ({ service, id: i.id, bindKey: i.bindKey, transport: i.transport, handler: i.handler, entryPoint: i.entryPoint }))
    : await api.entryPoints(state.env);

  // Components each entry point's flow reaches, from one batched call; the list works without it.
  const counts = new Map((await api.flowCounts(state.env).catch(() => [])).map((c) => [`${c.service}:${c.ingress}`, c]));
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
      }, h('span.row', chip(p.transport), p.entryPoint ? h('span.xs.muted', 'entry point') : null), h('span.key', splitKey(p.bindKey).rest, countBadge(counts.get(`${p.service}:${p.id}`)))))]),
      xs.length > LIST_CAP ? h('p.xs.muted', { style: { padding: 'var(--s2)' } }, `${xs.length - LIST_CAP} more. Type to narrow the list.`) : null,
      !xs.length ? h('p.small.muted', { style: { padding: 'var(--s2)' } }, 'No starting points match.') : null);
  };
  filter.addEventListener('input', debounce(drawList, 120));
  drawList();

  const mainPane = h('div.flows-main');
  const panel = createPanel(mainPane, { onClose: () => mainPane.querySelector('.msg.active')?.classList.remove('active') });
  const listEl = h('aside.flows-list', h('div.search', icon('search'), filter), listBody);
  const flowsEl = h('div.flows', listEl, mainPane);
  resizer(listEl, { edge: 'right', key: 'flows-list', defaultWidth: 300, label: 'Resize entry point list',
    width: () => listEl.offsetWidth, apply: (px) => flowsEl.style.setProperty('--list-w', `${px}px`) });
  resizer(panel.el, { edge: 'left', key: 'flow-panel', defaultWidth: 380, label: 'Resize flow details',
    width: () => panel.el.offsetWidth, apply: (px) => { panel.el.style.width = `min(${px}px, 100%)`; } });

  main.append(
    pageHead('Flows', service ? `Starting points in ${service}` : `${points.length} entry points in ${state.env}`),
    h('div.content.flush', flowsEl));

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
  const frontierCheck = h('label.check', { title: 'Call trees the harvester marked as reaching no sink. Folded into one marker per function by default.' },
    h('input', { type: 'checkbox', checked: opts.frontier, on: { change: async (e) => { opts.frontier = e.target.checked; persist(); await load(); } } }), 'Frontier steps');
  const internalCheck = check('internal', 'Internal calls');
  const internalBox = internalCheck.querySelector('input');
  const depth = h('select.select', { 'aria-label': 'Depth', on: { change: (e) => { opts.depth = e.target.value; persist(); draw(); } } },
    ['all', '1', '2', '3', '4', '6', '8'].map((d) => h('option', { value: d, selected: d === opts.depth }, d === 'all' ? 'All depths' : `Depth ${d}`)));

  mainPane.prepend(h('div.seq-toolbar', seg, internalCheck, check('stores', 'Data stores'), check('queues', 'Queues and topics'), frontierCheck, depth, h('span.spacer'),
    h('span.xs.muted', 'Right-click a lifeline to see inside it'), info), scroller);

  function persist() {
    setQuery({ scope: opts.scope, internal: opts.internal ? null : '0', stores: opts.stores ? null : '0', queues: opts.queues ? null : '0', depth: opts.depth === 'all' ? null : opts.depth,
      expand: [...opts.expand].join(',') || null, frontier: opts.frontier ? '1' : null });
  }
  async function load() {
    fill(scroller, h('div.loading', 'Tracing…'));
    try {
      trace = await api.trace(state.env, { service: start.service, ingress: start.ingress, fn: start.fn, event: start.event, scope: opts.scope, maxMessages: 800, expand: [...opts.expand].join(',') || null, frontier: opts.frontier ? '1' : null });
    } catch (err) {
      fill(scroller, h('div.content', h('div.error-box', err.message)));
      return;
    }
    draw();
  }
  function draw() {
    const seq = renderSequence(trace, {
      internal: opts.internal, stores: opts.stores, queues: opts.queues, maxDepth: opts.depth === 'all' ? Infinity : Number(opts.depth), expanded: opts.expand,
      onOpenFlow: (f) => go('/flows', { service: f.service, ingress: f.ingress, scope: opts.scope }),
      onFlowMenu: (f, m, x, y, jump) => flowMenu(f, x, y, opts.scope, jump),
      onParticipant: (p, x, y) => participantMenu(p, x, y, {
        trace, scope: opts.scope, expanded: opts.expand,
        setExpanded: async (svc, on) => { on ? opts.expand.add(svc) : opts.expand.delete(svc); if (on) { opts.internal = true; internalBox.checked = true; } persist(); await load(); },
      }),
      onMessage: async (m, g) => { // clicking a frontier marker expands the frontier steps
        if (m.kind === 'frontier') { opts.frontier = true; frontierCheck.querySelector('input').checked = true; persist(); await load(); return; } mainPane.querySelector('.msg.active')?.classList.remove('active'); g.classList.add('active'); panel.open(...messagePanel(m, trace, state.env, opts.scope)); },
    });
    const services = new Set(trace.messages.map((m) => m.service).filter(Boolean));
    info.textContent = `${trace.start.event ? `${trace.start.event}: ` : ''}${seq.shown} of ${seq.total} steps, ${services.size} services${trace.truncated ? ', truncated' : ''}`;
    fill(scroller, seq.el);
  }
  await load();
  return { dispose: panel.dispose };
}
