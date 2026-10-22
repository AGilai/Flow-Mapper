// Event types on top of the channel graph. See docs/DESIGN.md §3 "Event types".
//
// A producer's egress lists the event types it publishes. A subscription (binding) may let only some
// event types through. A consumer's ingress maps each event type (name or glob) to a handler.
// A delivery is one event type travelling from a producer's egress to a consumer's ingress along
// links whose subscriptions let it through. Producers of an event type are derived from deliveries;
// a consumer may also declare producers that are not harvested. When a producer only knows the type
// is one of several (`unresolved` what: 'event', candidates), each candidate is a *possible* delivery:
// shown, never counted as unhandled, and enough to keep a consumer off "never arrives".

import type { GraphIndex } from './graph-index.ts';
import { itemsOf, linksFrom, sid } from './graph-index.ts';
import { refKey } from './resolve.ts';
import { compareSpecificity, eventMatches, filterAllows, specificity } from './glob.ts';
import type { Ingress, Link, Ref } from './types.ts';
import { subscriptionConflicts } from './event-pairs.ts';
export { deliveriesBetween } from './event-pairs.ts';

export interface Delivery {
  event: string;
  producer: { service: string; egress: string };
  consumer: { service: string; ingress: string };
  handler: string | null;     // null: the consumer lists event types and none matches
  via: string[];              // channel keys on the way
  possible?: boolean;         // one of the producer's candidate types, not a confirmed one
}

export interface EventReport {
  deliveries: Delivery[];
  /** Arrives at a consumer that lists event types, none of which matches. */
  unhandled: Delivery[];
  /** Published, but every route filters it out (the egress itself does reach something). */
  undelivered: { service: string; egress: string; bindKey: string; event: string }[];
  /** A consumer handles it, but nothing produces it and no producer is declared. */
  neverArrives: { service: string; ingress: string; bindKey: string; event: string }[];
  /** A declared producer is a harvested service that does not send this event type here. */
  declaredNotSeen: { service: string; ingress: string; event: string; producer: string }[];
  /** The same subscription (from, to) reported by several manifests with different event filters. */
  conflicts: { from: string; to: string; declarations: { service: string; id: string; events: '*' | string[] }[] }[];
}

/** Whether a hop lets an event type through. Hops that are not subscriptions let everything through. */
export function passes(g: GraphIndex, l: Link, event: string | undefined): boolean {
  if (!event || !l.binding) return true;
  const b = g.bindings.get(sid(l.binding.service, l.binding.id));
  return !b?.events || b.events === '*' || filterAllows(b.events, event);
}

/**
 * The event types an egress step may send when the step does not name one and the egress does not
 * have exactly one: its own `events` (known) and the candidates of its unresolved event (possible).
 * Both empty means the event is fully unknown.
 */
export interface EventSet { known: string[]; candidates: string[] }
export function untypedEventSet(e: { events?: string[]; unresolved?: { what: string; candidates?: string[] }[] }): EventSet {
  const known = e.events ?? [];
  const candidates = (e.unresolved ?? []).filter((u) => u.what === 'event').flatMap((u) => u.candidates ?? []).filter((t) => !known.includes(t));
  return { known, candidates };
}

/**
 * Every value a call step binds to `name` on a call path that reaches function `fn` (#42, scoped by #44):
 * call steps of the same service whose target is `fn` or reaches `fn` through call steps. Binds do not cross a
 * publish or another service, so the same name in another service never leaks in.
 */
const boundCache = new WeakMap<GraphIndex, Map<string, Map<string, Set<string>>>>();
export function boundValues(g: GraphIndex, service: string, fn: string, name: string): Set<string> {
  let m = boundCache.get(g);
  if (!m) boundCache.set(g, (m = new Map()));
  const key = `${service}\u0000${fn}`;
  let byName = m.get(key);
  if (!byName) {
    byName = new Map();
    const fns = itemsOf(g, service).functions;
    const reach = new Set([fn]); // fn and every function with a call step into the set
    for (let grew = true; grew;) {
      grew = false;
      for (const f of fns) if (!reach.has(f.id) && f.steps.some((st) => st.type === 'call' && st.target && reach.has(st.target))) { reach.add(f.id); grew = true; }
    }
    for (const f of fns) for (const st of f.steps) if (st.type === 'call' && st.target && reach.has(st.target)) {
      for (const [k, v] of Object.entries(st.bind ?? {})) byName.set(k, (byName.get(k) ?? new Set()).add(v));
    }
    m.set(key, byName);
  }
  return byName.get(name) ?? new Set();
}
/** The event types an egress sends: its own `events` plus what callers bind for its `eventFrom` steps (#42). */
export const egressEvents = (g: GraphIndex, e: { service: string; id: string; events?: string[] }): string[] => [...new Set([...(e.events ?? []), ...eventFromTypes(g, e)])];
/** Event types an egress gets from `eventFrom` steps: the union of the values bound to those names by callers that reach the step's function, in its service. Conservative: not per path. */
export function eventFromTypes(g: GraphIndex, e: { service: string; id: string }): string[] {
  const out = new Set<string>();
  for (const { fn: f, step: st } of g.stepsToEgress.get(sid(e.service, e.id)) ?? []) {
    if (st.eventFrom) for (const v of boundValues(g, f.service, f.id, st.eventFrom)) out.add(v);
  }
  return [...out];
}

/**
 * `passes` for a publish whose event type is not known exactly. A hop that is not a filtered
 * subscription lets it through ('sure'); a filtered one only when it allows one of the set's types:
 * 'sure' for a known type, 'possible' when only a candidate matches, false otherwise (also for an
 * empty set). Traces and flow counts use this; `passes` itself still lets everything through for an
 * undefined event, which is right for callers that have no event to test (eventReport etc.).
 */
export function passesUntyped(g: GraphIndex, l: Link, set: EventSet): false | 'sure' | 'possible' {
  if (!l.binding) return 'sure';
  const b = g.bindings.get(sid(l.binding.service, l.binding.id));
  if (!b?.events || b.events === '*') return 'sure';
  const ev = b.events;
  if (set.known.some((t) => filterAllows(ev, t))) return 'sure';
  return set.candidates.some((t) => filterAllows(ev, t)) ? 'possible' : false;
}

/** The handler for an event type at a consumer: the most specific matching entry; the ingress handler when it lists none. */
export function handlerFor(i: Ingress, event: string): string | null {
  if (!i.events?.length) return i.handler;
  const best = i.events
    .filter((e) => eventMatches(e.type, event))
    .sort((a, b) => compareSpecificity(specificity(b.type, b.type.includes('*') ? 'glob' : 'exact'), specificity(a.type, a.type.includes('*') ? 'glob' : 'exact')))[0];
  return best?.handler ?? null;
}

const cache = new WeakMap<GraphIndex, EventReport>();
const ck = (service: string, id: string) => `${service}\u0000${id}`;

export function eventReport(g: GraphIndex): EventReport {
  const hit = cache.get(g);
  if (hit) return hit;
  const deliveries: Delivery[] = [];
  const undelivered: EventReport['undelivered'] = [];
  const dangling = new Set(g.resolution.dangling.map((e) => sid(e.service, e.id)));

  for (const e of g.model.egress) {
    const candidates = (e.unresolved ?? []).filter((u) => u.what === 'event').flatMap((u) => u.candidates ?? []);
    const own = egressEvents(g, e);
    const types: [string, boolean][] = [...own.map((t): [string, boolean] => [t, false]),
      ...candidates.filter((t) => !own.includes(t)).map((t): [string, boolean] => [t, true])];
    for (const [event, possible] of types) {
      const seen = new Set<string>();
      let n = 0;
      const walk = (r: Ref, via: string[]) => {
        for (const l of linksFrom(g, r)) {
          if (!passes(g, l, event)) continue;
          const k = refKey(l.to);
          if (seen.has(k)) continue;
          seen.add(k);
          if (l.to.type === 'ingress') {
            const i = g.ingress.get(sid(l.to.service, l.to.id))!;
            deliveries.push({ event, producer: { service: e.service, egress: e.id }, consumer: { service: i.service, ingress: i.id }, handler: handlerFor(i, event), via, ...(possible ? { possible } : {}) });
            n++;
          } else walk(l.to, l.to.type === 'channel' ? [...via, l.to.key] : via);
        }
      };
      walk({ type: 'egress', service: e.service, id: e.id }, []);
      if (!n && !possible && !dangling.has(sid(e.service, e.id))) undelivered.push({ service: e.service, egress: e.id, bindKey: e.bindKey, event });
    }
  }

  const neverArrives: EventReport['neverArrives'] = [];
  const declaredNotSeen: EventReport['declaredNotSeen'] = [];
  const toConsumer = new Map<string, Delivery[]>();
  for (const d of deliveries) { const k = ck(d.consumer.service, d.consumer.ingress); const l = toConsumer.get(k); if (l) l.push(d); else toConsumer.set(k, [d]); }
  for (const i of g.model.ingress) {
    for (const ie of i.events ?? []) {
      const derived = (toConsumer.get(ck(i.service, i.id)) ?? []).filter((d) => eventMatches(ie.type, d.event));
      for (const p of ie.producers ?? []) {
        if (g.services.has(p) && !derived.some((d) => d.producer.service === p)) declaredNotSeen.push({ service: i.service, ingress: i.id, event: ie.type, producer: p });
      }
      if (!derived.length && !ie.producers?.length) neverArrives.push({ service: i.service, ingress: i.id, bindKey: i.bindKey, event: ie.type });
    }
  }

  const report = {
    deliveries, undelivered, neverArrives, declaredNotSeen,
    unhandled: deliveries.filter((d) => d.handler === null && !d.possible),
    conflicts: subscriptionConflicts(g.model.bindings),
  };
  cache.set(g, report);
  return report;
}

export interface EventRow {
  type: string;               // event type, or the declared pattern when nothing matching arrives
  pattern: string | null;     // the consumer entry that matched, when it is a glob
  handler: string | null;
  status: 'ok' | 'possible' | 'declared-only' | 'never' | 'unhandled';
  /** derived: found from harvested data. declared: listed by the consumer. harvested: Flow-Mapper knows the service. */
  producers: { service: string; egress?: string; derived: boolean; declared: boolean; harvested: boolean; possible?: boolean }[];
}

/** Every event type at one consumer: what it declares to handle and what actually arrives. */
export function ingressEvents(g: GraphIndex, i: Ingress): EventRow[] {
  const mine = eventReport(g).deliveries.filter((d) => d.consumer.service === i.service && d.consumer.ingress === i.id);
  if (!i.events?.length && !mine.length) return [];
  const rows = new Map<string, EventRow>();
  const row = (type: string, pattern: string | null, handler: string | null): EventRow => {
    if (!rows.has(type)) rows.set(type, { type, pattern, handler, status: 'ok', producers: [] });
    return rows.get(type)!;
  };
  for (const d of mine) {
    const entry = i.events?.find((e) => e.handler === d.handler && eventMatches(e.type, d.event));
    const r = row(d.event, entry && entry.type !== d.event ? entry.type : null, d.handler);
    if (!r.producers.some((p) => p.service === d.producer.service && p.egress === d.producer.egress)) {
      r.producers.push({ service: d.producer.service, egress: d.producer.egress, derived: true, declared: false, harvested: true, ...(d.possible ? { possible: true } : {}) });
    }
  }
  for (const ie of i.events ?? []) {
    const matching = [...rows.values()].filter((r) => eventMatches(ie.type, r.type));
    const targets = matching.length ? matching : [row(ie.type, ie.type.includes('*') ? ie.type : null, ie.handler)];
    for (const p of ie.producers ?? []) for (const r of targets) {
      const has = r.producers.find((x) => x.service === p);
      if (has) has.declared = true;
      else r.producers.push({ service: p, derived: false, declared: true, harvested: g.services.has(p) });
    }
  }
  for (const r of rows.values()) {
    const confirmed = r.producers.some((p) => p.derived && !p.possible);
    r.status = confirmed ? (r.handler === null ? 'unhandled' : 'ok')
      : r.producers.some((p) => p.possible) ? 'possible'
      : r.handler === null ? 'unhandled'
      : r.producers.length ? 'declared-only' : 'never';
  }
  return [...rows.values()].sort((a, b) => order(a) - order(b) || a.type.localeCompare(b.type));
}
const order = (r: EventRow) => ({ unhandled: 0, never: 1, possible: 2, 'declared-only': 3, ok: 4 })[r.status];

type EventTypeRow = { type: string; producers: { service: string; egress: string }[]; consumers: { service: string; ingress: string; handler: string | null }[] };
const typesCache = new WeakMap<GraphIndex, EventTypeRow[]>();
/** All event types in the environment with who produces and who consumes them (memoised per graph: do not mutate). */
export function eventTypes(g: GraphIndex): EventTypeRow[] {
  const hit = typesCache.get(g);
  if (hit) return hit;
  const types = new Map<string, { type: string; producers: { service: string; egress: string }[]; consumers: { service: string; ingress: string; handler: string | null }[] }>();
  const t = (type: string) => { if (!types.has(type)) types.set(type, { type, producers: [], consumers: [] }); return types.get(type)!; };
  for (const e of g.model.egress) {
    const own = egressEvents(g, e);
    for (const ev of own) t(ev).producers.push({ service: e.service, egress: e.id });
    for (const u of e.unresolved ?? []) if (u.what === 'event') {
      for (const ev of u.candidates ?? []) if (!e.events?.includes(ev)) t(ev).producers.push({ service: e.service, egress: e.id, possible: true } as any);
    }
  }
  for (const i of g.model.ingress) for (const ie of i.events ?? []) if (!ie.type.includes('*')) t(ie.type);
  for (const d of eventReport(g).deliveries) {
    const c = t(d.event).consumers;
    if (!c.some((x) => x.service === d.consumer.service && x.ingress === d.consumer.ingress)) c.push({ ...d.consumer, handler: d.handler });
  }
  for (const i of g.model.ingress) for (const ie of i.events ?? []) {
    const x = types.get(ie.type);
    if (x && !x.consumers.some((c) => c.service === i.service && c.ingress === i.id)) x.consumers.push({ service: i.service, ingress: i.id, handler: ie.handler });
  }
  const out = [...types.values()].sort((a, b) => a.type.localeCompare(b.type));
  typesCache.set(g, out);
  return out;
}

/** One event type: who publishes it, every delivery (consumer, handler, route), and its problems. */
export function eventView(g: GraphIndex, type: string) {
  const r = eventReport(g);
  const summary = eventTypes(g).find((t) => t.type === type);
  if (!summary) return null;
  const mine = <T extends { event: string }>(xs: T[]) => xs.filter((x) => x.event === type);
  return {
    ...summary,
    deliveries: mine(r.deliveries),
    problems: {
      unhandled: mine(r.unhandled), undelivered: mine(r.undelivered), neverArrives: mine(r.neverArrives), declaredNotSeen: mine(r.declaredNotSeen),
    },
  };
}
