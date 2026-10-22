// The info pane of a component (0.33.0, frame 19a): header, Overview facts, About, Flows through it, Connections (today's panel content).
// `componentSpec(name, ctx)` loads what it needs and returns the spec `pane-frame.js` draws and `pane-expanded.js` lays out as rows.
// ctx: { pen, system?: { node, edges, byId }, onSub(key), onComponent(name), fromFlow? }.

import { h } from '../dom.js';
import { api } from '../api.js';
import { href } from '../router.js';
import { state, isDesign } from '../state.js';
import { loadMarks } from '../design/marks-store.js';
import { loadSubsystems } from '../design/subsystems-store.js';
import { cmpVar } from '../design/component-colors.js';
import { markBadge } from '../components/status-mark.js';
import { subIcon } from '../icons.js';
import { connectionSections } from '../views/system-panel.js';
import { markOfPoint } from '../views/flow-list-filter.js';
import { block, facts, docLinks, endpointText, flowsList } from './pane-parts.js';
import { loadAbout, aboutSection } from './pane-about.js';
import { componentRows } from './pane-component-rows.js';
import { questionsButton } from './pane-questions.js';

const KIND = { service: 'Service', gateway: 'Gateway', lambda: 'Lambda', 'client-app': 'Client app', infra: 'Infrastructure' };

/** The coloured tile of the header: the component colour, neutral for client apps and infrastructure. */
export const tile = (color) => h('span.pane-tile', { style: { '--c': color ?? 'var(--ink-2)' } },
  h('svg', { svg: true, viewBox: '0 0 18 18', 'aria-hidden': 'true' }, h('circle', { svg: true, cx: 9, cy: 9, r: 5.5, fill: 'var(--surface)', stroke: 'var(--c)', 'stroke-width': 1.8 })));

/** The system data for the Connections list: the page's own when it has it, else the environment's (component level, no channels). */
export async function systemFor(name, ctx) {
  if (ctx.system?.node) return ctx.system;
  const data = await api.system(state.env).catch(() => null);
  if (!data) return null;
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  return { node: byId.get(`svc:${name}`) ?? null, edges: data.collapsedEdges ?? [], byId };
}

export async function componentSpec(name, ctx) {
  const [view, subs, marks, flows, sys] = await Promise.all([api.service(state.env, name).catch(() => null), loadSubsystems(), loadMarks(), api.flowsThrough(state.env, [name]).catch(() => []), systemFor(name, ctx)]);
  const svc = view?.service ?? {}, node = sys?.node ?? null, kind = svc.kind ?? node?.svcKind ?? 'service';
  const about = await loadAbout(svc.about ?? node?.about), subKey = subs.subOf(name), design = isDesign();
  const aboutPen = ctx.pen?.about(name, { form: 'component', service: name }) ?? null;
  const mk = marks.markOf(`svc:${name}`), ep = endpointText(view?.ingress, view?.egress);
  const target = { kind: 'component', name }, open = href(`/services/${encodeURIComponent(name)}`);

  const subLink = () => (subKey ? h('button.pane-sub-link', { type: 'button', 'data-qa': 'pane-sub', on: { click: () => ctx.onSub?.(subKey) } }, subIcon(subs.info(subKey)?.icon, 14), subs.labelOf(subKey)) : subs.has ? 'Not set' : null);
  const overview = () => [ctx.pen?.hint() ?? null, facts([
    ['Subsystem', subLink()], ['Kind', KIND[kind] ?? kind], ['Team', svc.team], ['Description', svc.description],
    ['Endpoints', ep.total ? [`${ep.total} `, h('small', `· ${ep.text} `), h('a.pane-more', { href: open }, 'Open service')] : h('a.pane-more', { href: open }, 'Open service')],
    ['Docs', docLinks(svc.links)],
  ])];
  const flowsBody = () => flowsList(flows, { mark: (e) => markBadge(markOfPoint(marks, e), { store: marks }), hit: (e) => ctx.fromFlow && e.service === ctx.fromFlow.service && e.id === ctx.fromFlow.ingress });
  const conn = sys?.node ? connectionSections(sys.node, sys.edges, sys.byId) : [];
  const nConn = sys?.node ? sys.edges.filter((e) => e.from === sys.node.id || e.to === sys.node.id).length : 0;
  const connBody = () => (conn.length ? connectionSections(sys.node, sys.edges, sys.byId) : h('p.pane-none', 'No connections on the map.'));

  const spec = {
    kind: 'component', key: `svc:${name}`, target, title: name, mono: true, tile: () => tile(cmpVar(name, kind)), sub: [KIND[kind] ?? kind, subKey ? subs.labelOf(subKey) : null],
    marks: (goQuestions) => [markBadge(mk, { store: marks }), questionsButton(about.questions, goQuestions)], questions: about.questions,
    sections: {
      overview: block('overview', '', {}, overview()), about: aboutSection(about, { pen: aboutPen, design }),
      flows: block('flows', 'Flows through it', { count: flows.length, right: h('a', { href: href('/flows', { service: name }) }, 'Trace flows') }, flowsBody()),
      connections: block('connections', 'Connections', { count: nConn }, connBody()),
    },
    counts: { flows: flows.length, connections: nConn }, edit: () => ctx.pen?.button('panel-component', name, { form: 'component', service: name }, { text: 'Edit' }) ?? null,
    crumb: ['System map', subKey ? subs.labelOf(subKey) : null], svc, inDraft: marks.inDraft(`svc:${name}`), mark: mk,
  };
  spec.expanded = () => componentRows(spec, { about, aboutPen, design, flows, flowsBody, overview, connections: () => ({ nodes: sys?.node ? neighbours(sys) : [], count: nConn }), view, ctx, marks });
  return spec;
}

/** The neighbours of a node for the expanded page: [{ id, label, transports, async, broken, count, dir, service }] (a click swaps the content). */
function neighbours({ node, edges, byId }) {
  const rows = [];
  for (const e of edges) {
    const dir = e.from === node.id ? 'out' : e.to === node.id ? 'in' : null;
    if (!dir) continue;
    const o = byId.get(dir === 'out' ? e.to : e.from);
    rows.push({ label: o?.label ?? String(dir === 'out' ? e.to : e.from), service: o && (o.kind === 'service' || o.kind === 'gateway') ? o.label : null, dir, broken: !!e.broken,
      transports: (e.transports ?? []).filter((t) => t !== 'other').slice(0, 3), async: (e.modes ?? []).includes('async') && !(e.modes ?? []).includes('sync'), count: e.endpoints?.length ?? 0 });
  }
  return rows.sort((a, b) => Number(b.broken) - Number(a.broken) || b.count - a.count);
}
