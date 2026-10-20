// Component count per entry point without tracing each one: the services, channels and data stores
// a Full-flow trace (core/trace.ts, default options) would draw, computed as graph reachability.
//
// Each function gets a local set (its own service, the stores it uses, the channels and services its
// egress reach) and edges to the functions it calls or whose handlers it delivers to. Reachable sets
// are memoised per strongly connected component (Tarjan), so a function shared by many entries and a
// call cycle are each handled once. Same rules as the trace: frontier steps, unresolved steps and
// classified leaves are not followed; a subscription that filters the event out is not followed.
// Differences from a trace: it has no depth (25) or message (500) limit, so a flow that a trace
// truncates counts fully; broken links ("missing") and unresolved gaps are not components in either.

import type { GraphIndex } from './graph-index.ts';
import { linksFrom, sid } from './graph-index.ts';
import type { Ref } from './types.ts';
import { handlerFor, passes } from './events.ts';
import { unresolvedTarget } from './resolve.ts';
import { entryPoints } from './trace.ts';

export interface FlowCount {
  service: string; ingress: string; total: number;
  services: number; topics: number; queues: number; buses: number; stores: number; otherChannels: number;
}
interface Node { local: Set<string>; next: string[] }

const counted = new WeakMap<GraphIndex, FlowCount[]>();
const cache = new WeakMap<GraphIndex, Map<string, string[]>>();

/** Component ids ('s:<service>', 'c:<channel key>', 'r:<store key>') reachable from a function. */
function componentSets(g: GraphIndex): Map<string, string[]> {
  const hit = cache.get(g);
  if (hit) return hit;
  const nodes = new Map<string, Node>();
  const nodeOf = (k: string): Node => {
    let n = nodes.get(k);
    if (n) return n;
    const node: Node = { local: new Set(), next: [] };
    nodes.set(k, (n = node));
    const f = g.fns.get(k);
    if (!f) return n;
    node.local.add('s:' + f.service);
    for (const st of f.steps) {
      if (st.origin === 'frontier') continue;
      const out = st.type === 'egress' && st.target ? g.egress.get(sid(f.service, st.target)) : undefined;
      if ((!st.target ? st.unresolved?.find((u) => u.what === 'target') : undefined) ?? (out ? unresolvedTarget(out) : undefined)) continue;
      if (!st.target) continue;
      if (st.type === 'call') { if (g.fns.get(sid(f.service, st.target))) node.next.push(sid(f.service, st.target)); continue; }
      if (st.type === 'resource') { node.local.add('r:' + (g.resources.get(sid(f.service, st.target))?.bindKey ?? sid(f.service, st.target))); continue; }
      if (!out) continue;
      const event = st.event ?? (out.events?.length === 1 ? out.events[0] : undefined);
      const walk = (r: Ref, seenCh: string[]) => {
        if (r.type === 'channel') {
          node.local.add('c:' + r.key);
          if (seenCh.includes(r.key)) return;
          for (const l of linksFrom(g, r)) if (passes(g, l, event)) walk(l.to, [...seenCh, r.key]);
        } else if (r.type === 'ingress') {
          const i = g.ingress.get(sid(r.service, r.id));
          if (!i) return;
          node.local.add('s:' + i.service);
          const handler = event ? handlerFor(i, event) : i.handler;
          if (handler && g.fns.get(sid(i.service, handler))) node.next.push(sid(i.service, handler));
        }
      };
      for (const l of linksFrom(g, { type: 'egress', service: f.service, id: out.id })) if (passes(g, l, event)) walk(l.to, []);
    }
    return n;
  };

  // Tarjan over the functions reachable from any entry handler; a component's set is the union of
  // its members' local sets and its successors' sets.
  const index = new Map<string, number>(), low = new Map<string, number>(), onStack = new Set<string>();
  const stack: string[] = [];
  let counter = 0;
  const sets = new Map<string, Set<string>>();
  const visit = (k: string) => {
    index.set(k, counter); low.set(k, counter); counter++;
    stack.push(k); onStack.add(k);
    for (const m of nodeOf(k).next) {
      if (!index.has(m)) { visit(m); low.set(k, Math.min(low.get(k)!, low.get(m)!)); }
      else if (onStack.has(m)) low.set(k, Math.min(low.get(k)!, index.get(m)!));
    }
    if (low.get(k) !== index.get(k)) return;
    const members: string[] = [];
    let m: string;
    do { m = stack.pop()!; onStack.delete(m); members.push(m); } while (m !== k);
    const inSet = new Set(members);
    const set = new Set<string>();
    for (const x of members) {
      for (const c of nodes.get(x)!.local) set.add(c);
      for (const y of nodes.get(x)!.next) { const s = sets.get(y); if (s && !inSet.has(y)) for (const c of s) set.add(c); }
    }
    for (const x of members) sets.set(x, set);
  };
  for (const i of entryPoints(g)) {
    const k = sid(i.service, i.handler);
    if (g.fns.get(k) && !index.has(k)) visit(k);
  }
  const result = new Map<string, string[]>();
  for (const [k, s] of sets) result.set(k, [...s]);
  cache.set(g, result);
  return result;
}

/** Component counts for every entry point (see entryPoints in trace.ts), computed in one pass. */
export function flowCounts(g: GraphIndex): FlowCount[] {
  const done = counted.get(g);
  if (done) return done;
  const sets = componentSets(g);
  const res = entryPoints(g).map((e) => {
    const c: FlowCount = { service: e.service, ingress: e.id, total: 0, services: 0, topics: 0, queues: 0, buses: 0, stores: 0, otherChannels: 0 };
    for (const id of sets.get(sid(e.service, e.handler)) ?? []) {
      if (id[0] === 's') c.services++;
      else if (id[0] === 'r') c.stores++;
      else {
        const kind = g.channels.get(id.slice(2))?.kind;
        if (kind === 'sns-topic') c.topics++;
        else if (kind === 'sqs-queue' || kind === 'amqp-queue') c.queues++;
        else if (kind === 'eventbridge-bus') c.buses++;
        else c.otherChannels++;
      }
      c.total++;
    }
    return c;
  });
  counted.set(g, res);
  return res;
}

/** The same breakdown as a tooltip: "4 services, 2 topics, 2 queues, 1 store". */
export function describeCount(c: FlowCount): string {
  const part = (n: number, one: string, many = one + 's') => (n ? `${n} ${n === 1 ? one : many}` : '');
  return [part(c.services, 'service'), part(c.topics, 'topic'), part(c.queues, 'queue'), part(c.buses, 'bus', 'buses'), part(c.otherChannels, 'other channel'), part(c.stores, 'store')]
    .filter(Boolean).join(', ');
}
