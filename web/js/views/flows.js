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
import { renderLane } from './flow-draw.js';
import { buildLane } from './flow-lane.js';
import { asyncTree } from './flow-async.js';
import { renderIndex } from './flow-index.js';
import { createInside } from './flow-inside-panel.js';
import { messagePanel } from './flow-panel.js';
import { participantMenu, barMenu } from './flow-menu.js';
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
    stores: query.get('stores') !== '0', queues: query.get('queues') === '1', depth: query.get('depth') ?? 'all',
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
  const rightEl = h('div.flows-right', mainPane); // the message panel is this grid's second column, so it squeezes the diagram
  const panel = createPanel(rightEl, { onClose: () => { flowsEl.classList.remove('mp-open'); mainPane.querySelector('.msg.active')?.classList.remove('active'); } });
  const listEl = h('aside.flows-list', h('div.search', icon('search'), filter), listBody);
  const flowsEl = h('div.flows', listEl, rightEl);
  resizer(listEl, { edge: 'right', key: 'flows-list', defaultWidth: 300, label: 'Resize entry point list',
    width: () => listEl.offsetWidth, apply: (px) => flowsEl.style.setProperty('--list-w', `${px}px`) });
  resizer(panel.el, { edge: 'left', key: 'flow-panel', defaultWidth: 380, label: 'Resize flow details',
    width: () => panel.el.offsetWidth, apply: (px) => { panel.el.style.width = `${px}px`; } });

  main.append(
    pageHead('Flows', service ? `Starting points in ${service}` : `${points.length} entry points in ${state.env}`),
    h('div.content.flush', flowsEl));

  if (!start.ingress && !start.fn) {
    mainPane.append(h('div.empty', h('h2', 'Pick a starting point'),
      h('p', 'Choose an entry point on the left to see every call, queue and data store it touches, in order.')));
    return { dispose: panel.dispose };
  }

  let trace, tree, index, lane, mwOpen = false;
  const scroller = h('div.seq-scroll');
  const hint = h('span.seq-hint', 'More to the right. Scroll sideways ›');
  const wrap = h('div.seq-wrap', scroller, hint);
  const body = h('div.flow-body', wrap);
  const edge = () => { wrap.classList.toggle('scrolls', scroller.scrollWidth > scroller.clientWidth + 2); wrap.classList.toggle('at-end', scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4); };
  scroller.addEventListener('scroll', edge, { passive: true });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(edge) : null;
  ro?.observe(scroller);
  const inside = createInside(body, { env: state.env, onOpen: () => { panel.close(); flowsEl.classList.add('fi-open'); }, onClose: () => { flowsEl.classList.remove('fi-open'); select(null); }, onStep: (m) => markArrow(m) });
  const info = h('span.small.muted');
  const seg = h('div.seg', { role: 'group', 'aria-label': 'Scope' }, [['intra', 'Inside the service'], ['full', 'Full flow']].map(([id, label]) =>
    h('button', { 'aria-pressed': String(opts.scope === id), on: { click: async () => { opts.scope = id; persist(); await load(); seg.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(['intra', 'full'][i] === id))); } } }, label)));
  const check = (key, label, title) => h('label.check', { title }, h('input', { type: 'checkbox', checked: opts[key], on: { change: (e) => { opts[key] = e.target.checked; persist(); draw(); } } }), label);
  const frontierCheck = h('label.check', { title: 'Call trees the harvester marked as reaching no sink. Folded into one marker per function by default.' },
    h('input', { type: 'checkbox', checked: opts.frontier, on: { change: async (e) => { opts.frontier = e.target.checked; persist(); await load(); } } }), 'Frontier steps');
  const depth = h('select.select', { 'aria-label': 'Depth', on: { change: (e) => { opts.depth = e.target.value; persist(); draw(); } } },
    ['all', '1', '2', '3', '4', '6', '8'].map((d) => h('option', { value: d, selected: d === opts.depth }, d === 'all' ? 'All depths' : `Depth ${d}`)));

  // TODO: the "Queues and topics" checkbox (opts.queues) returns with part 2, when queue/topic lifelines are drawn inside sub-flows.
  mainPane.prepend(h('div.seq-toolbar', seg, check('stores', 'Data stores'), frontierCheck, depth, h('span.spacer'),
    h('span.xs.muted', 'Double-click a bar, or right-click it, to look inside'), info), body);

  function persist() {
    setQuery({ scope: opts.scope, stores: opts.stores ? null : '0', queues: opts.queues ? '1' : null, depth: opts.depth === 'all' ? null : opts.depth, frontier: opts.frontier ? '1' : null });
  }
  async function load() {
    fill(scroller, h('div.loading', 'Tracing…'));
    try {
      trace = await api.trace(state.env, { service: start.service, ingress: start.ingress, fn: start.fn, event: start.event, scope: opts.scope, maxMessages: 800, frontier: opts.frontier ? '1' : null });
    } catch (err) {
      fill(scroller, h('div.content', h('div.error-box', err.message)));
      return;
    }
    tree = asyncTree(trace.messages);
    inside.close();
    draw();
  }
  function select(bar) {
    document.querySelectorAll('.act.selected').forEach((e) => e.classList.remove('selected'));
    bar?.el?.classList.add('selected');
  }
  function markArrow(m) { // a step in the drill-down marks its arrow
    mainPane.querySelectorAll('.msg.active').forEach((e) => e.classList.remove('active'));
    const g = [...mainPane.querySelectorAll('.seq-body')].map((b) => ({ b, k: b.__events?.findIndex((e) => e.msg === m) })).find((x) => x.k >= 0);
    const el = g?.b.querySelector(`[data-e="${g.k}"]`);
    el?.classList.add('active');
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  const laneOpts = () => ({ mwOpen, stores: opts.stores, scope: opts.scope, maxDepth: opts.depth === 'all' ? Infinity : Number(opts.depth) });
  const openFlow = (row, full) => go('/flows', { service: row.service, ingress: row.ingress, scope: full ? 'full' : opts.scope });
  const lookInside = (bar) => { select(bar); inside.open(bar, trace); };
  const handlers = {
    onMw: () => { mwOpen = !mwOpen; draw(); }, // fold or unfold a long middleware chain
    onBar: (bar, mode) => { if (mode === 'select') select(bar); else lookInside(bar); },
    onBarMenu: (bar, x, y) => barMenu(bar, x, y, { trace, inside: () => lookInside(bar), toIndex: index ? () => index.el.scrollIntoView({ behavior: 'smooth' }) : null }),
    onParticipant: (p, x, y) => participantMenu(p, x, y, { trace, scope: opts.scope }),
    onBadge: (ev) => { // one flow: open it; several: scroll to their group in the index below
      const at = trace.messages.indexOf(ev.msg), g = index?.groupEl(at);
      const only = ev.flows === 1 ? tree.rows.find((r) => r.i > at && g?.contains(document.getElementById(`row-${r.label}`))) : null;
      if (only?.ingress && !only.noHandler) { openFlow(only, false); return; }
      g?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      g?.classList.add('flash');
      setTimeout(() => g?.classList.remove('flash'), 1600);
    },
    onMessage: async (m, g) => { // clicking a frontier marker expands the frontier steps
      if (m.kind === 'frontier') { opts.frontier = true; frontierCheck.querySelector('input').checked = true; persist(); await load(); return; }
      mainPane.querySelectorAll('.msg.active').forEach((e) => e.classList.remove('active'));
      g.classList.add('active');
      inside.close(); // one side panel at a time
      flowsEl.classList.add('mp-open');
      panel.open(...messagePanel(m, trace, state.env, opts.scope));
    },
  };
  function draw() {
    const lo = laneOpts();
    const msgs = trace.messages.filter((m) => m.depth <= lo.maxDepth);
    lane = renderLane(buildLane(msgs, { mwOpen: lo.mwOpen, stores: lo.stores, scope: trace.scope, participants: trace.participants }), handlers);
    index = tree.groups.length ? renderIndex(tree, { trace, lane: lo, handlers, open: openFlow }) : null;
    const services = new Set(trace.messages.map((m) => m.service).filter(Boolean));
    info.textContent = `${trace.start.event ? `${trace.start.event}: ` : ''}${trace.messages.length} steps, ${services.size} ${services.size === 1 ? 'service' : 'services'}${trace.truncated ? ', truncated' : ''}`;
    fill(scroller, lane.el, index?.el);
    edge();
    requestAnimationFrame(edge);
  }
  await load();
  return { dispose: () => { panel.dispose(); inside.dispose(); ro?.disconnect(); } };
}
