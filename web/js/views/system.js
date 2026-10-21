// System map: services (and optionally channels and data stores) as a force-directed graph,
// clustered by team. Filters: text (name, team, function), transport, team, broken only.
// A filter keeps the matches (plus N hops, default 0) and hides the rest; selecting a node does the
// same around it (at least 1 hop). Clicking a node or a line opens the panel with its details.

import { h, debounce } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { setQuery } from '../router.js';
import { pageHead } from '../components/page.js';
import { createPanel } from '../components/panel.js';
import { createCanvasGraph } from '../graph/canvas-graph.js';
import { layout } from '../graph/layout.js';
import { withinHops } from '../../core/subgraph.js';
import { nodePanel } from './system-panel.js';
import { loadMarks } from '../design/marks-store.js';
import { markLegend } from './system-marks.js';
import { edgePanel } from './edge-panel.js';

const TRANSPORTS = ['http', 'rpc', 'grpc', 'sns', 'sqs', 'amqp', 'eventbridge', 'socket'];

/** "1 service", "3 services". */
const n1 = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export async function render({ main, query }) {
  const [data, marks] = await Promise.all([api.system(state.env), loadMarks()]);
  const opts = {
    q: query.get('q') ?? '', channels: query.get('channels') === '1', stores: query.get('stores') === '1',
    broken: query.get('broken') === '1', team: query.get('team') ?? '', hops: Math.max(0, Math.min(3, Number(query.get('hops')) || 0)),
    transports: new Set((query.get('t') ?? TRANSPORTS.join(',')).split(',').filter(Boolean)),
  };
  const teams = [...new Set(data.nodes.map((n) => n.team).filter(Boolean))].sort();
  const services = data.nodes.filter((n) => n.kind === 'service' || n.kind === 'gateway').length;

  const stage = h('div.graph-stage');
  const count = h('span.small.muted');
  const content = h('div.content.flush', h('div.stage-wrap', stage, legend(marks, data)));
  let selected = null;
  const panel = createPanel(content, { onClose: () => { selected = null; graph.select(null); setQuery({ sel: null }); apply(); } });
  const search = h('input.input', { type: 'search', placeholder: 'Filter by service, team or function', value: opts.q, 'aria-label': 'Filter map' });
  const toggle = (key, label) => h('label.check', h('input', { type: 'checkbox', checked: opts[key], on: { change: (e) => { opts[key] = e.target.checked; persist(); rebuild(); } } }), label);

  main.append(
    pageHead('System map', `${n1(services, 'service')}, ${n1(data.edges.length, 'connection')}`,
      h('div.search', icon('search'), search),
      h('select.select', { 'aria-label': 'Team', on: { change: (e) => { opts.team = e.target.value; persist(); apply(); } } },
        h('option', { value: '' }, 'All teams'), teams.map((t) => h('option', { value: t, selected: t === opts.team }, t))),
      h('label.small.muted.row', { title: 'How many connections out from the matches or the selected service to keep showing' }, 'Hops',
        h('select.select', { 'aria-label': 'Hops around the filter or selection', on: { change: (e) => { opts.hops = Number(e.target.value); persist(); apply(); } } },
          [0, 1, 2, 3].map((n) => h('option', { value: n, selected: n === opts.hops }, String(n))))),
      h('button.btn', { on: { click: () => graph.fit() } }, icon('fit'), 'Fit')),
    h('div.filter-bar',
      h('span.small.muted', 'Show'), toggle('channels', 'Queues and topics'), toggle('stores', 'Data stores'), h('label.check', h('input', { type: 'checkbox', checked: opts.broken, on: { change: (e) => { opts.broken = e.target.checked; persist(); rebuild(); } } }), 'Broken links only'),
      h('span.divider'),
      h('span.small.muted', 'Transports'),
      TRANSPORTS.map((t) => h('label.check', h('input', { type: 'checkbox', checked: opts.transports.has(t), on: { change: (e) => {
        e.target.checked ? opts.transports.add(t) : opts.transports.delete(t); persist(); apply(); } } }), h('span.chip', { 'data-t': t }, t))),
      h('span.spacer'), count),
    content);

  const graph = createCanvasGraph(stage, {
    marks, padBottom: marks.empty ? 60 : 120, // the legend has more lines in a design
    onSelect: (hit) => {
      if (!hit) { panel.close(); return; }
      if (hit.type === 'node') selectNode(hit.item.id);
      else { graph.select(hit.item.id); panel.open(...edgePanel(hit.item, byId, state.env)); }
    },
  });

  let byId = new Map(), current = null;
  const layouts = new Map();

  function persist() {
    setQuery({ q: opts.q || null, channels: opts.channels ? 1 : null, stores: opts.stores ? 1 : null, broken: opts.broken ? 1 : null,
      team: opts.team || null, hops: opts.hops || null, t: opts.transports.size === TRANSPORTS.length ? null : [...opts.transports].join(',') });
  }

  // Build the node/edge set for the current "show" toggles and lay it out (cached per combination).
  function rebuild() {
    const key = `${opts.channels}|${opts.stores}|${opts.broken}`;
    const keep = (n) => n.kind === 'service' || n.kind === 'gateway' || (opts.broken && n.kind === 'missing') || (opts.channels && n.kind === 'channel') || (opts.stores && n.kind === 'resource');
    const kept = data.nodes.filter(keep);
    const keptIds = new Set(kept.map((n) => n.id));
    const base = opts.channels ? data.edges : data.collapsedEdges.concat(opts.stores ? data.edges.filter((e) => e.to.startsWith('res:')) : []);
    const edges = base.filter((e) => keptIds.has(e.from) && keptIds.has(e.to));
    // Queues and stores with no connection in this view add noise; services always stay.
    const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
    const nodes = kept.filter((n) => n.kind === 'service' || n.kind === 'gateway' || linked.has(n.id));
    // channels and stores sit in the district of the service they connect to most
    const teamOf = new Map(data.nodes.map((n) => [n.id, n.team]));
    for (const n of nodes) if (!n.team) {
      const e = edges.find((x) => x.to === n.id || x.from === n.id);
      n.group = e ? teamOf.get(e.to === n.id ? e.from : e.to) : 'other';
    } else n.group = n.team;
    if (!layouts.has(key)) {
      // Services are laid out once; queues, stores and missing targets are added around them.
      const svcKey = 'services';
      if (!layouts.has(svcKey)) {
        const sn = nodes.filter((n) => n.kind === 'service' || n.kind === 'gateway');
        const ids2 = new Set(sn.map((n) => n.id));
        layouts.set(svcKey, layout(sn, data.collapsedEdges.filter((e) => ids2.has(e.from) && ids2.has(e.to)), { iterations: 280 }));
      }
      const extra = nodes.some((n) => n.kind !== 'service' && n.kind !== 'gateway');
      layouts.set(key, extra ? layout(nodes, edges, { iterations: 90, ideal: 34, fixed: layouts.get(svcKey) }) : layouts.get(svcKey));
    }
    current = { nodes, edges };
    byId = new Map(data.nodes.map((n) => [n.id, n]));
    graph.setData({ nodes, edges, positions: layouts.get(key) });
    apply();
    graph.fit();
  }

  // Filters hide nodes without re-layout, so the map stays stable while you narrow it down.
  function apply() {
    const q = opts.q.trim().toLowerCase();
    const match = (n) => !q || n.label.toLowerCase().includes(q) || (n.team ?? '').toLowerCase().includes(q) || (n.functions ?? []).some((f) => f.toLowerCase().includes(q));
    const edgeOk = (e) => (opts.broken ? e.broken : true) && (e.broken || e.transports.some((t) => opts.transports.has(t) || t === 'other' || t === 'undecided'));
    const edges = current.edges.filter(edgeOk);
    // Hits: nodes matching text and team. Nodes without a team (queues, stores, missing) never hit
    // on team alone; they appear only within the hops of a hit.
    const hits = new Set(current.nodes.filter((n) => match(n) && (!opts.team || n.team === opts.team) && (!opts.team || n.team)).map((n) => n.id));
    const filtering = q || opts.team || opts.broken || opts.transports.size < TRANSPORTS.length;
    let visible = null, focus = null;
    if (filtering) {
      const touched = new Set(edges.flatMap((e) => [e.from, e.to]));
      const seeds = opts.broken ? [...hits].filter((id) => touched.has(id)) : hits;
      visible = withinHops(seeds, edges, opts.hops);
    }
    if (selected) { // the selection narrows the map to its own neighbourhood
      focus = withinHops([selected], edges, Math.max(1, opts.hops));
      visible = visible ? new Set([...focus].filter((id) => visible.has(id) || id === selected || opts.hops === 0)) : focus;
    }
    graph.setEdgeFilter(edgeOk);
    graph.setVisible(visible);
    graph.setHighlight(focus ?? (q && opts.hops ? hits : null));
    const hop = opts.hops ? ` within ${opts.hops} ${opts.hops === 1 ? 'hop' : 'hops'}` : '';
    count.textContent = selected ? `${visible.size} shown around the selection` : q ? `${hits.size} matching${hop ? `, ${visible.size} shown${hop}` : ''}` : visible ? `${visible.size} of ${current.nodes.length} shown` : n1(current.nodes.length, 'node');
  }

  function selectNode(id) {
    const n = byId.get(id);
    if (!n) return;
    selected = id;
    graph.select(id);
    setQuery({ sel: id });
    apply();
    panel.open(...nodePanel(n, current.edges, byId));
  }

  search.addEventListener('input', debounce(() => { opts.q = search.value; persist(); apply(); }, 120));
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = search.value.trim().toLowerCase();
    const first = current.nodes.find((n) => n.label.toLowerCase().includes(q));
    if (first) { graph.zoomTo(first.id); selectNode(first.id); }
  });

  rebuild();
  const sel = query.get('sel');
  if (sel && byId.has(sel)) { selectNode(sel); graph.zoomTo(sel); }
  return { dispose: () => { graph.dispose(); panel.dispose(); } };
}

function legend(marks, data) {
  const item = (svg, label) => h('span.legend-item', h('span', { html: svg }), label);
  return h('div.legend', { 'aria-hidden': 'true' },
    item('<svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>', 'Service'),
    item('<svg width="14" height="14"><rect x="2" y="2" width="10" height="10" rx="3" fill="currentColor"/></svg>', 'Gateway'),
    item('<svg width="14" height="14"><path d="M7 1l6 6-6 6-6-6z" fill="var(--t-sqs)"/></svg>', 'Queue / topic'),
    item('<svg width="14" height="14"><rect x="3" y="3" width="8" height="8" fill="none" stroke="var(--t-res)" stroke-width="1.6"/></svg>', 'Data store'),
    item('<svg width="22" height="6"><path d="M1 3h20" stroke="var(--ink-2)" stroke-width="1.6"/></svg>', 'Sync call (waits for the reply)'),
    item('<svg width="22" height="6"><path d="M1 3h20" stroke="var(--ink-2)" stroke-width="1.6" stroke-dasharray="4 3"/></svg>', 'Async (queue, topic, event)'),
    item('<svg width="22" height="6"><path d="M1 3h20" stroke="var(--t-socket)" stroke-width="3" stroke-linecap="round"/></svg>', 'Client socket entry (tls / tcp / ws)'),
    item('<svg width="22" height="6"><path d="M1 3h20" stroke="var(--t-broken)" stroke-width="1.6" stroke-dasharray="4 3"/></svg>', 'Broken (no target matches)'),
    markLegend(item, marks, data));
}
