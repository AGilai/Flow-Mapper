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
import { linksFrom, sid } from './graph-index.ts';
import { refKey } from './resolve.ts';
import { compareSpecificity, eventMatches, filterAllows, specificity } from './glob.ts';
import type { Binding, Ingress, Link, Ref } from './types.ts';

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

/** The handler for an event type at a consumer: the most specific matching entry; the ingress handler when it lists none. */
export function handlerFor(i: Ingress, event: string): string | null {
  if (!i.events?.length) return i.handler;
  const best = i.events
    .filter((e) => eventMatches(e.type, event))
    .sort((a, b) => compareSpecificity(specificity(b.type, b.type.includes('*') ? 'glob' : 'exact'), specificity(a.type, a.type.includes('*') ? 'glob' : 'exact')))[0];
  return best?.handler ?? null;
}

const cache = new WeakMap<GraphIndex, EventReport>();

export function eventReport(g: GraphIndex): EventReport {
  const hit = cache.get(g);
  if (hit) return hit;
  const deliveries: Delivery[] = [];
  const undelivered: EventReport['undelivered'] = [];
  const dangling = new Set(g.resolution.dangling.map((e) => sid(e.service, e.id)));

  for (const e of g.model.egress) {
    const candidates = (e.unresolved ?? []).filter((u) => u.what === 'event').flatMap((u) => u.candidates ?? []);
    const types: [string, boolean][] = [...(e.events ?? []).map((t): [string, boolean] => [t, false]),
      ...candidates.filter((t) => !e.events?.includes(t)).map((t): [string, boolean] => [t, true])];
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
  for (const i of g.model.ingress) {
    for (const ie of i.events ?? []) {
      const derived = deliveries.filter((d) => d.consumer.service === i.service && d.consumer.ingress === i.id && eventMatches(ie.type, d.event));
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

function subscriptionConflicts(bindings: Binding[]): EventReport['conflicts'] {
  const norm = (b: Binding) => (!b.events || b.events === '*' ? '*' : [...b.events].sort());
  const groups = new Map<string, Binding[]>();
  for (const b of bindings) {
    const k = `${b.from}\u0000${b.to}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(b);
  }
  return [...groups.values()]
    .filter((bs) => new Set(bs.map((b) => JSON.stringify(norm(b)))).size > 1)
    .map((bs) => ({ from: bs[0].from, to: bs[0].to, declarations: bs.map((b) => ({ service: b.service, id: b.id, events: norm(b) })) }));
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

/** All event types in the environment with who produces and who consumes them. */
export function eventTypes(g: GraphIndex) {
  const types = new Map<string, { type: string; producers: { service: string; egress: string }[]; consumers: { service: string; ingress: string; handler: string | null }[] }>();
  const t = (type: string) => { if (!types.has(type)) types.set(type, { type, producers: [], consumers: [] }); return types.get(type)!; };
  for (const e of g.model.egress) {
    for (const ev of e.events ?? []) t(ev).producers.push({ service: e.service, egress: e.id });
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
  return [...types.values()].sort((a, b) => a.type.localeCompare(b.type));
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
