// System view data: services, channels, resources and missing targets as nodes; aggregated edges.
// The UI filters this client-side (name, function, transport, team, broken only).

import type { GraphIndex } from './graph-index.ts';
import { downstreamIngress, sid } from './graph-index.ts';
import type { Mode, Ref, Transport } from './types.ts';
import { eventReport } from './events.ts';
import { keyMatches } from './glob.ts';

export type NodeKind = 'service' | 'gateway' | 'infra' | 'channel' | 'resource' | 'missing';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  sub?: string;                // team / channel kind / resource kind
  svcKind?: string;            // service kind (service | gateway | lambda), for icons
  service?: string;
  team?: string;
  tags?: string[];
  functions?: string[];        // for name/function filtering
  transports?: string[];
  stats?: { ingress: number; egress: number; functions: number; dangling: number; orphans: number };
  /** Topics, queues and buses: event types published here, and subscriptions out with their event filters. */
  events?: string[];
  subscriptions?: { id: string; service: string; to: string; events: '*' | string[]; conflict: boolean }[];
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  transports: Transport[];
  modes: Mode[];
  broken: boolean;
  endpoints: EdgeEndpoint[];
}

/** One resolved call behind an edge. `egress` / `ingress` are ids within the edge's from / to service
 *  (absent on a channel side); `filter` is the event filter of the subscription the hop goes through. */
export interface EdgeEndpoint {
  from: string; to: string; bindKey: string; via: string;
  egress?: string; ingress?: string; filter?: '*' | string[];
}

export interface SystemGraph { nodes: GraphNode[]; edges: GraphEdge[]; collapsedEdges: GraphEdge[] }

const svcNode = (name: string) => `svc:${name}`;
const chNode = (key: string) => `ch:${key}`;

export function systemGraph(g: GraphIndex): SystemGraph {
  const nodes = new Map<string, GraphNode>();
  const r = g.resolution;
  const danglingSet = new Set(r.dangling.map((e) => sid(e.service, e.id)));
  const orphanSet = new Set(r.orphans.map((i) => sid(i.service, i.id)));

  for (const s of g.model.services) {
    if (s.kind === 'infra') continue; // infra manifests only declare channels
    const of = <T extends { service: string }>(xs: T[]) => xs.filter((x) => x.service === s.name);
    const ins = of(g.model.ingress), outs = of(g.model.egress);
    nodes.set(svcNode(s.name), {
      id: svcNode(s.name), kind: s.kind === 'lambda' ? 'service' : s.kind, svcKind: s.kind, label: s.name, sub: s.team, service: s.name, team: s.team, tags: s.tags,
      functions: of(g.model.functions).map((f) => f.name),
      transports: [...new Set([...ins, ...outs].map((x) => x.transport))],
      stats: {
        ingress: ins.length, egress: outs.length, functions: of(g.model.functions).length,
        dangling: outs.filter((e) => danglingSet.has(sid(e.service, e.id))).length,
        orphans: ins.filter((i) => orphanSet.has(sid(i.service, i.id))).length,
      },
    });
  }
  for (const [key, c] of g.channels) {
    const conflicted = new Set(eventReport(g).conflicts.filter((x) => x.from === key).map((x) => x.to));
    nodes.set(chNode(key), {
      id: chNode(key), kind: 'channel', label: c.name ?? key, sub: c.kind, transports: [c.kind.split('-')[0]],
      events: [...new Set(g.model.egress.filter((e) => e.bindKey === key).flatMap((e) => e.events ?? []))].sort(),
      subscriptions: g.model.bindings.filter((b) => keyMatches(b.from, b.match, key))
        .map((b) => ({ id: b.id, service: b.service, to: b.to, events: b.events ?? '*', conflict: conflicted.has(b.to) })),
    });
  }

  const edges = new Map<string, GraphEdge>();
  const addEdge = (from: string, to: string, t: Transport, m: Mode, ep: GraphEdge['endpoints'][number], broken = false) => {
    const id = `${from}->${to}`;
    let e = edges.get(id);
    if (!e) edges.set(id, (e = { id, from, to, transports: [], modes: [], broken, endpoints: [] }));
    if (!e.transports.includes(t)) e.transports.push(t);
    if (!e.modes.includes(m)) e.modes.push(m);
    e.endpoints.push(ep);
  };
  const nodeOf = (ref: Ref): string => (ref.type === 'channel' ? chNode(ref.key) : svcNode(ref.service));
  const label = (ref: Ref): string => (ref.type === 'channel' ? ref.key : `${ref.service}:${ref.id}`);

  for (const l of r.links) {
    const from = nodeOf(l.from), to = nodeOf(l.to);
    if (!nodes.has(from) || !nodes.has(to)) continue;
    const key = l.from.type === 'egress' ? g.egress.get(sid(l.from.service, l.from.id))!.bindKey : label(l.from);
    const b = l.binding ? g.bindings.get(sid(l.binding.service, l.binding.id)) : undefined;
    addEdge(from, to, l.transport, l.mode, {
      from: label(l.from), to: label(l.to), bindKey: key, via: l.via,
      ...(l.from.type === 'egress' ? { egress: l.from.id } : {}), ...(l.to.type === 'ingress' ? { ingress: l.to.id } : {}),
      ...(b?.events ? { filter: b.events } : {}),
    });
  }

  for (const e of r.dangling) {
    if (g.channels.has(e.bindKey)) continue; // goes to a declared channel that leads nowhere; shown via channel node
    const id = `missing:${e.bindKey}`;
    if (!nodes.has(id)) nodes.set(id, { id, kind: 'missing', label: e.bindKey, sub: 'no match' });
    addEdge(svcNode(e.service), id, e.transport, e.mode ?? 'sync', { from: `${e.service}:${e.id}`, to: '—', bindKey: e.bindKey, via: 'none', egress: e.id }, true);
  }

  // Resources shared by bindKey
  for (const res of g.model.resources) {
    const id = `res:${res.bindKey ?? `${res.service}:${res.id}`}`;
    if (!nodes.has(id)) nodes.set(id, { id, kind: 'resource', label: res.name, sub: res.kind });
    const fns = g.model.functions.filter((f) => f.service === res.service);
    const ops = fns.flatMap((f) => f.steps.filter((s) => s.type === 'resource' && s.target === res.id).map((s) => s.operation ?? 'use'));
    addEdge(svcNode(res.service), id, 'other', 'sync', { from: res.service, to: res.name, bindKey: res.bindKey ?? res.id, via: [...new Set(ops)].join(', ') || 'use' });
  }

  // Channels hidden: connect services directly through channel chains.
  const collapsed = new Map<string, GraphEdge>();
  for (const e of g.model.egress) {
    for (const d of downstreamIngress(g, { type: 'egress', service: e.service, id: e.id })) {
      const from = svcNode(e.service), to = svcNode(d.ingress.service);
      const id = `${from}->${to}`;
      let ce = collapsed.get(id);
      if (!ce) collapsed.set(id, (ce = { id, from, to, transports: [], modes: [], broken: false, endpoints: [] }));
      if (!ce.transports.includes(e.transport)) ce.transports.push(e.transport);
      const m = e.mode ?? (d.via.length ? 'async' : 'sync');
      if (!ce.modes.includes(m)) ce.modes.push(m);
      ce.endpoints.push({
        from: `${e.service}:${e.id}`, to: `${d.ingress.service}:${d.ingress.id}`, bindKey: e.bindKey, egress: e.id, ingress: d.ingress.id,
        via: d.via.length ? d.via.map((v) => (v.type === 'channel' ? v.key : '')).join(' → ') : 'direct',
      });
    }
  }
  for (const [id, e] of edges) if (e.broken) collapsed.set(id, e);

  return { nodes: [...nodes.values()], edges: [...edges.values()], collapsedEdges: [...collapsed.values()] };
}
