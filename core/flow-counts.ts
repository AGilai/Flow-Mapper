// Component count per entry point without tracing each one: the services, channels and data stores
// a Full-flow trace (core/trace.ts, default options) would draw, computed as graph reachability.
//
// Each function gets a local set (its own service, the stores it uses, the channels and services its
// egress reach) and edges to the functions it calls or whose handlers it delivers to. Reachable sets
// are memoised per strongly connected component (Tarjan), so a function shared by many entries and a
// call cycle are each handled once. Same rules as the trace: frontier steps, unresolved steps and
// classified leaves are not followed; a subscription that filters the event out is not followed.
// Alternatives (#41, steps that exclude each other) need no special case: every component is counted once however many
// branches reach it.
// Binds (#42): memoising per function means a call step's `bind` cannot be followed per path. An egress step
// with `eventFrom` therefore sends the union of every value any call step in the graph binds to that name, plus
// the egress's own events and candidates. A count can be a superset of the trace through one caller (never a
// subset, except where the trace is truncated); tests/eventfrom.test.ts says exactly where they differ.
// Differences from a trace: it has no depth (25) or message (500) limit, so a flow that a trace
// truncates counts fully; broken links ("missing") and unresolved gaps are not components in either.

import type { GraphIndex } from './graph-index.ts';
import { linksFrom, sid } from './graph-index.ts';
import type { Ingress, Ref } from './types.ts';
import { handlerFor, passes, boundValues, passesUntyped, untypedEventSet } from './events.ts';
import { refKey, unresolvedTarget } from './resolve.ts';
import { splitAmqpKey } from './amqp.ts';
import { routeKey, rpcOf } from './amqp-route.ts';
import { entryPoints } from './trace.ts';
import { markedId } from './step-marks.ts';

export interface FlowCount {
  service: string; ingress: string; total: number;
  services: number; topics: number; queues: number; buses: number; stores: number; otherChannels: number;
}
interface Node { local: Set<string>; next: string[] }

const markedDone = new WeakMap<GraphIndex, Map<string, number>>();
const counted = new WeakMap<GraphIndex, FlowCount[]>();
const cache = new WeakMap<GraphIndex, Map<string, string[]>>();

/** Component ids ('s:<service>', 'c:<channel key>', 'r:<store key>') reachable from a function. `mark` (core/flow-refs.ts) names an
 *  ingress the walk reaches with an extra id of its own, and then the result is not cached here (the caller keeps it). */
export function componentSets(g: GraphIndex, mark?: (i: Ingress) => string | undefined): Map<string, string[]> {
  const hit = mark ? undefined : cache.get(g);
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
      if (st.mark) node.local.add(markedId(f.service, f.id, st.seq));
      const out = st.type === 'egress' && st.target ? g.egress.get(sid(f.service, st.target)) : undefined;
      if ((!st.target ? st.unresolved?.find((u) => u.what === 'target') : undefined) ?? (out ? unresolvedTarget(out) : undefined)) continue;
      if (!st.target) continue;
      if (st.type === 'call') { if (g.fns.get(sid(f.service, st.target))) node.next.push(sid(f.service, st.target)); continue; }
      if (st.type === 'resource') { node.local.add('r:' + (g.resources.get(sid(f.service, st.target))?.bindKey ?? sid(f.service, st.target))); continue; }
      if (!out) continue;
      const event = st.eventFrom ? undefined : st.event ?? (out.events?.length === 1 ? out.events[0] : undefined);
      const own = untypedEventSet(out);
      const set = st.eventFrom ? { known: [...new Set([...own.known, ...boundValues(g, f.service, f.id, st.eventFrom)])], candidates: own.candidates }
        : event ? undefined : own; // same rule as the trace (#40): an untyped publish follows only subscriptions that match its events or candidates
      const ok = (l: Parameters<typeof passes>[1]) => (set ? passesUntyped(g, l, set) !== false : passes(g, l, event));
      const walk = (r: Ref, seenCh: string[]) => {
        if (r.type === 'channel') {
          node.local.add('c:' + r.key);
          if (seenCh.includes(r.key)) return;
          for (const l of linksFrom(g, r)) if (ok(l)) walk(l.to, [...seenCh, r.key]);
        } else if (r.type === 'ingress') {
          const i = g.ingress.get(sid(r.service, r.id));
          if (!i) return;
          node.local.add('s:' + i.service);
          const m = mark?.(i);
          if (m) node.local.add(m);
          const handlers = st.eventFrom && i.events?.length ? [...set!.known, ...set!.candidates].map((t) => handlerFor(i, t)) : [event ? handlerFor(i, event) : i.handler];
          for (const handler of new Set(handlers)) if (handler && g.fns.get(sid(i.service, handler))) node.next.push(sid(i.service, handler));
        }
      };
      const routed = linksFrom(g, { type: 'egress', service: f.service, id: out.id }).filter(ok);
      // A publish to an exchange that fans out to several queues, or routes nowhere, draws the exchange as a lifeline (a single queue is reached directly).
      const ex = splitAmqpKey(out.bindKey)?.exchange, to = new Set(routed.map((l) => refKey(l.to)));
      if (ex && !rpcOf(out) && !g.channels.has(out.bindKey) && (g.channels.has(`amqp:${ex}`) || g.model.bindings.some((b) => splitAmqpKey(b.from)?.exchange === ex))) {
        const r = routeKey(g.model.bindings, g.channels.get(`amqp:${ex}`)?.details, out.bindKey, out.details);
        if (r && ((to.size > 1 && routed.every((l) => l.to.type === 'channel')) || (!to.size && !r.matched.length && !r.possible.length))) node.local.add(`c:amqp:${ex}`);
      }
      for (const l of routed) walk(l.to, []);
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
    for (const fn of [...(i.middleware ?? []), i.handler]) {
      const k = sid(i.service, fn);
      if (g.fns.get(k) && !index.has(k)) visit(k);
    }
  }
  const result = new Map<string, string[]>();
  for (const [k, s] of sets) result.set(k, [...s]);
  if (!mark) cache.set(g, result);
  return result;
}

/** Component counts for every entry point (see entryPoints in trace.ts), computed in one pass. */
export function flowCounts(g: GraphIndex): FlowCount[] {
  const done = counted.get(g);
  if (done) return done;
  const sets = componentSets(g);
  const res = entryPoints(g).map((e) => {
    const c: FlowCount = { service: e.service, ingress: e.id, total: 0, services: 0, topics: 0, queues: 0, buses: 0, stores: 0, otherChannels: 0 };
    const reached = new Set([e.handler, ...(e.middleware ?? [])].flatMap((fn) => sets.get(sid(e.service, fn)) ?? []));
    for (const id of reached) {
      if (id[0] === 'm') continue;                  // a marked step (step-marks.ts), not a component
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

/** 0.32.2 (#75): `${service}:${ingress}` of an entry point -> how many marked steps (step-marks.ts) its flow runs; entries with none are absent. */
export function markedReached(g: GraphIndex): Map<string, number> {
  const hit = markedDone.get(g);
  if (hit) return hit;
  const out = new Map<string, number>();
  markedDone.set(g, out);
  if (![...g.fns.values()].some((f) => f.steps.some((s) => s.mark))) return out;
  const sets = componentSets(g);
  for (const e of entryPoints(g)) {
    const ids = new Set<string>();
    for (const fn of [e.handler, ...(e.middleware ?? [])]) for (const c of sets.get(sid(e.service, fn)) ?? []) if (c.startsWith('m:')) ids.add(c);
    if (ids.size) out.set(`${e.service}:${e.id}`, ids.size);
  }
  return out;
}
