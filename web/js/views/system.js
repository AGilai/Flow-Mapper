// System map: services (and optionally channels and data stores) as a force-directed graph,
// clustered by team. Filters: text (name, team, function), transport, team, broken only.
// A filter keeps the matches (plus N hops, default 0) and hides the rest; selecting a node does the
// same around it (at least 1 hop). Clicking a node or a line opens the panel with its details.

import { h, debounce } from '../dom.js';
import { api } from '../api.js';
import { state, isDesign } from '../state.js';
import { icon } from '../icons.js';
import { setQuery, go } from '../router.js';
import { pageHead } from '../components/page.js';
import { createPanel } from '../components/panel.js';
import { createCanvasGraph } from '../graph/canvas-graph.js';
import { layout } from '../graph/layout.js';
import { withinHops } from '../../core/subgraph.js';
import { nodePanel } from './system-panel.js';
import { pencils } from '../design/pencil.js';
import { loadMarks } from '../design/marks-store.js';
import { legend } from './system-legend.js';
import { loadSubsystems } from '../design/subsystems-store.js';
import { levelOf, showLevelControl } from './system-level.js';
import { levelControl } from './system-toolbar.js';
import { renderSubsystems } from './system-subsystems.js';
import { regionsOf, regionCells } from '../graph/graph-regions.js';
import { edgePanel } from './edge-panel.js';
import { createPane } from '../pane/pane.js';
import { parseSel } from '../pane/pane-pure.js';

const TRANSPORTS = ['http', 'rpc', 'grpc', 'sns', 'sqs', 'amqp', 'eventbridge', 'socket'];

/** "1 service", "3 services". */
const n1 = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export async function render({ main, query }) {
  const subs = await loadSubsystems();
  if (levelOf(query.get('level'), subs.has) === 'subsystems') return renderSubsystems({ main, query, subs, marks: await loadMarks() }); // 0.28.1: frame 3
  const [data, marks] = await Promise.all([api.system(state.env), loadMarks()]);
  const isSvc = (n) => n.kind === 'service' || n.kind === 'gateway';
  const regions = subs.assigned && data.nodes.some((n) => isSvc(n) && subs.subOf(n.label)); // subsystem regions (frame 2), only when a shown component has a subsystem: the map groups by subsystem instead of by team
  const design = isDesign() && !marks.empty; // a design with marks: "Components from prod", "Only what's new", and prod-to-prod edges drawn quiet
  const opts = {
    q: query.get('q') ?? '', channels: query.get('channels') === '1', stores: query.get('stores') === '1',
    broken: query.get('broken') === '1', team: query.get('team') ?? '', hops: Math.max(0, Math.min(3, Number(query.get('hops')) || 0)),
    transports: new Set((query.get('t') ?? TRANSPORTS.join(',')).split(',').filter(Boolean)),
    fromProd: query.get('prod') !== '0', onlyNew: query.get('new') === '1',
  };
  const teams = [...new Set(data.nodes.map((n) => n.team).filter(Boolean))].sort();
  const services = data.nodes.filter((n) => n.kind === 'service' || n.kind === 'gateway').length;

  const stage = h('div.graph-stage');
  const count = h('span.small.muted');
  const content = h('div.content.flush', h('div.stage-wrap', stage, legend(marks, data, { regions })));
  let selected = null;
  const panel = createPanel(content, { onClose: () => { selected = null; graph.select(null); setQuery({ sel: null }); apply(); } });
  const pen = pencils({ panel, flowsEl: null });
  // The info pane (0.33.0): a component opens it; so does a subsystem picked inside it. `sel=` names it in the URL.
  const pane = createPane(panel, {
    pen, ctx: (t) => ({ system: t.kind === 'component' ? { node: byId.get(`svc:${t.name}`), edges: current.edges, byId } : null }),
    onSelect: (sel, t) => {
      const id = t.kind === 'component' && byId.has(`svc:${t.name}`) ? `svc:${t.name}` : null;
      if (id !== selected) { selected = id; graph.select(id); apply(); }
      setQuery({ sel });
    },
  });
  const search = h('input.input', { type: 'search', placeholder: 'Filter by service, team or function', value: opts.q, 'aria-label': 'Filter map' });
  const filt = (key, label) => h('label.check', h('input', { type: 'checkbox', 'data-qa': `map-${key}`, checked: opts[key], on: { change: (e) => { opts[key] = e.target.checked; persist(); apply(); } } }), label);
  const toggle = (key, label) => h('label.check', h('input', { type: 'checkbox', checked: opts[key], on: { change: (e) => { opts[key] = e.target.checked; persist(); rebuild(); } } }), label);

  main.append(
    pageHead('System map', `${n1(services, 'service')}, ${n1(data.edges.length, 'connection')}`,
      h('div.search', icon('search'), search),
      h('select.select', { 'aria-label': 'Team', on: { change: (e) => { opts.team = e.target.value; persist(); apply(); } } },
        h('option', { value: '' }, 'All teams'), teams.map((t) => h('option', { value: t, selected: t === opts.team }, t))),
      h('label.small.muted.row', { title: 'How many connections out from the matches or the selected service to keep showing' }, 'Hops',
        h('select.select', { 'aria-label': 'Hops around the filter or selection', on: { change: (e) => { opts.hops = Number(e.target.value); persist(); apply(); } } },
          [0, 1, 2, 3].map((n) => h('option', { value: n, selected: n === opts.hops }, String(n))))),
      showLevelControl(subs) ? levelControl('components', subs) : null,
      h('button.btn', { on: { click: () => graph.fit() } }, icon('fit'), 'Fit')),
    h('div.filter-bar',
      h('span.small.muted', 'Show'), design ? [filt('fromProd', 'Components from prod'), filt('onlyNew', "Only what's new")] : null, toggle('channels', 'Queues and topics'), toggle('stores', 'Data stores'), h('label.check', h('input', { type: 'checkbox', checked: opts.broken, on: { change: (e) => { opts.broken = e.target.checked; persist(); rebuild(); } } }), 'Broken links only'),
      h('span.divider'),
      h('span.small.muted', 'Transports'),
      TRANSPORTS.map((t) => h('label.check', h('input', { type: 'checkbox', checked: opts.transports.has(t), on: { change: (e) => {
        e.target.checked ? opts.transports.add(t) : opts.transports.delete(t); persist(); apply(); } } }), h('span.chip', { 'data-t': t }, t))),
      h('span.spacer'), regions ? h('span.hint.small.muted', 'Click a region to open its components in Inventory') : null, count),
    content);

  const graph = createCanvasGraph(stage, {
    marks, quiet: design ? (e) => isSvc(byId.get(e.from) ?? {}) && isSvc(byId.get(e.to) ?? {}) && !marks.markOf(e.from) && !marks.markOf(e.to) : null, padBottom: () => (content.querySelector('.legend')?.offsetHeight ?? 0) + 24, // the legend wraps to more lines on a narrow window
    onSelect: (hit) => {
      if (!hit) { if (pane.active()) pane.dismiss(); else panel.close(); return; }
      if (hit.type === 'region') go('/inventory', { subsystem: hit.item.key }); // a region's head opens its components in Inventory
      else if (hit.type === 'node') selectNode(hit.item.id);
      else { graph.select(hit.item.id); panel.open(...edgePanel(hit.item, byId, state.env)); }
    },
  });

  let byId = new Map(), current = null, cellsOf = null;
  const layouts = new Map();

  function persist() {
    setQuery({ q: opts.q || null, channels: opts.channels ? 1 : null, stores: opts.stores ? 1 : null, broken: opts.broken ? 1 : null,
      team: opts.team || null, prod: opts.fromProd ? null : '0', new: opts.onlyNew ? 1 : null, hops: opts.hops || null, t: opts.transports.size === TRANSPORTS.length ? null : [...opts.transports].join(',') });
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
    const grp = (n) => (regions && isSvc(n) ? subs.subOf(n.label) : n.team); // with regions a component's district is its subsystem
    const teamOf = new Map(data.nodes.map((n) => [n.id, grp(n)]));
    for (const n of nodes) if (!grp(n)) {
      const e = edges.find((x) => x.to === n.id || x.from === n.id);
      n.group = e ? teamOf.get(e.to === n.id ? e.from : e.to) : 'other';
    } else n.group = grp(n);
    if (!layouts.has(key)) {
      // Services are laid out once; queues, stores and missing targets are added around them.
      const svcKey = regions ? 'services-sub' : 'services';
      if (!layouts.has(svcKey)) {
        const sn = nodes.filter((n) => n.kind === 'service' || n.kind === 'gateway');
        const ids2 = new Set(sn.map((n) => n.id));
        let bounds = null; // (cells: kept for the regions) // regions: a grid of cells in the environment's subsystem order, each node kept inside its own
        if (regions) {
          const order = [...subs.list().map((s) => s.key), ''], counts = new Map(order.map((k) => [k, 0]));
          for (const n of sn) counts.set(subs.subOf(n.label), (counts.get(subs.subOf(n.label)) ?? 0) + 1);
          const cells = regionCells(order.filter((k) => counts.get(k)).map((k) => ({ key: k, count: counts.get(k) })));
          bounds = new Map(sn.map((n) => [n.id, cells.get(subs.subOf(n.label))])); cellsOf = cells;
        }
        layouts.set(svcKey, layout(sn, data.collapsedEdges.filter((e) => ids2.has(e.from) && ids2.has(e.to)), { iterations: 280, bounds }));
      }
      const extra = nodes.some((n) => n.kind !== 'service' && n.kind !== 'gateway');
      layouts.set(key, extra ? layout(nodes, edges, { iterations: 90, ideal: 34, fixed: layouts.get(svcKey) }) : layouts.get(svcKey));
    }
    current = { nodes, edges };
    byId = new Map(data.nodes.map((n) => [n.id, n]));
    graph.setData({ nodes, edges, positions: layouts.get(key), regions: regions ? regionsOf(nodes, layouts.get(key), subs, marks, cellsOf) : [] });
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
    const hide = (n) => isSvc(n) && ((opts.onlyNew && marks.markOf(n.id)?.mark !== 'new') || (!opts.fromProd && !marks.markOf(n.id)));
    if (design && current.nodes.some(hide)) { const keep = new Set(current.nodes.filter((n) => !hide(n)).map((n) => n.id)); visible = visible ? new Set([...visible].filter((id) => keep.has(id))) : keep; }
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
    apply();
    if (isSvc(n)) { pane.show({ kind: 'component', name: n.label }); return; }
    setQuery({ sel: id });
    panel.open(...nodePanel(n, current.edges, byId, pen));
  }

  search.addEventListener('input', debounce(() => { opts.q = search.value; persist(); apply(); }, 120));
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = search.value.trim().toLowerCase();
    const first = current.nodes.find((n) => n.label.toLowerCase().includes(q));
    if (first) { graph.zoomTo(first.id); selectNode(first.id); }
  });

  rebuild();
  const sel = query.get('sel'), want = parseSel(sel);
  if (want?.kind === 'component' && byId.has(sel)) graph.zoomTo(sel);
  if (want) pane.restore(query); // a component or a subsystem: the pane (and the expanded page, `expanded=1`)
  else if (sel && byId.has(sel)) { selectNode(sel); graph.zoomTo(sel); }
  pen.resume();
  return { dispose: () => { graph.dispose(); pane.dispose(); panel.dispose(); } };
}
