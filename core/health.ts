// Link-health summary per environment and per service. See docs/DESIGN.md §5.

import type { GraphIndex } from './graph-index.ts';
import { eventReport } from './events.ts';
import { stores } from './stores.ts';
import { drift, mixedCommits, unresolvedItems, type UnresolvedItem } from './harvest-quality.ts';

export interface ServiceHealth {
  service: string;
  version: number;
  egress: number;
  dangling: number;
  orphans: number;
  unbound: number;
  ambiguous: number;
  eventIssues: number;     // unhandled, undelivered, never-arriving and declared-not-seen event types
  storeIssues: number;     // stores it shares writes to, or declares and never uses
  unresolved: number;      // items its harvester could not resolve (reported, with a reason)
  coverage: number | null; // resolved egress / egress, null when the service has no egress
}

export interface HealthReport {
  env: string;
  totals: Omit<ServiceHealth, 'service' | 'version' | 'eventIssues' | 'storeIssues' | 'unresolved'> & { services: number; links: number; brokenBindings: number } & Record<EventKind, number>;
  services: ServiceHealth[];
  items: {
    dangling: { service: string; id: string; bindKey: string; transport: string }[];
    orphans: { service: string; id: string; bindKey: string; transport: string }[];
    unbound: { service: string; bindKey: string; kind: string; reason: string }[];
    brokenBindings: { service: string; id: string; from: string; to: string }[];
    ambiguous: { service: string; id: string; bindKey: string; candidates: string[] }[];
    unhandledEvents: { service: string; ingress: string; event: string; producer: string; egress: string }[];
    undeliveredEvents: { service: string; egress: string; bindKey: string; event: string }[];
    neverArrives: { service: string; ingress: string; bindKey: string; event: string }[];
    declaredNotSeen: { service: string; ingress: string; event: string; producer: string }[];
    subscriptionConflicts: { service: string; from: string; to: string; declarations: { service: string; id: string; events: '*' | string[] }[] }[];
    multipleWriters: { service: string; key: string; kind: string; writers: string[] }[];
    unusedStores: { service: string; key: string; kind: string }[];
    unresolved: UnresolvedItem[];
    mixedCommits: { service: string; commit?: string; others: { commit: string; items: number }[] }[];
    drift: { service: string; kind: string; id: string; provenance: unknown }[];
  };
}

export const EVENT_KINDS = ['unhandledEvents', 'undeliveredEvents', 'neverArrives', 'declaredNotSeen', 'subscriptionConflicts'] as const;
export const STORE_KINDS = ['multipleWriters', 'unusedStores'] as const;
/** Reported by the harvesters themselves; shown apart from link problems. */
export const HARVEST_KINDS = ['unresolved', 'mixedCommits', 'drift'] as const;
type EventKind = (typeof EVENT_KINDS)[number] | (typeof STORE_KINDS)[number] | (typeof HARVEST_KINDS)[number];

export function health(g: GraphIndex): HealthReport {
  const r = g.resolution;
  const ev = eventReport(g);
  const items: HealthReport['items'] = {
    unhandledEvents: ev.unhandled.map((d) => ({ service: d.consumer.service, ingress: d.consumer.ingress, event: d.event, producer: d.producer.service, egress: d.producer.egress })),
    undeliveredEvents: ev.undelivered,
    neverArrives: ev.neverArrives,
    declaredNotSeen: ev.declaredNotSeen,
    // listed under the first declaring service so per-service counts include it
    subscriptionConflicts: ev.conflicts.map((c) => ({ service: c.declarations[0].service, ...c })),
    // A store written by more than one service couples them through its data; listed under each writer.
    multipleWriters: stores(g).filter((s) => s.writers.length > 1)
      .flatMap((s) => s.writers.map((w) => ({ service: w, key: s.key, kind: s.kind, writers: s.writers }))),
    unusedStores: stores(g).filter((s) => !s.used && !s.keyUnknown).flatMap((s) => s.services.map((svc) => ({ service: svc, key: s.key, kind: s.kind }))),
    // what=detail entries (#45, an unknown field of a resource or step) stay in the API data and on the Redis page; they are not link problems
    unresolved: unresolvedItems(g).filter((u) => u.what !== 'detail'),
    mixedCommits: mixedCommits(g),
    drift: drift(g),
    dangling: r.dangling.map((e) => ({ service: e.service, id: e.id, bindKey: e.bindKey, transport: e.transport })),
    orphans: r.orphans.map((i) => ({ service: i.service, id: i.id, bindKey: i.bindKey, transport: i.transport })),
    unbound: r.unbound.map((u) => ({ service: u.channel.service, bindKey: u.channel.bindKey, kind: u.channel.kind, reason: u.reason })),
    brokenBindings: r.brokenBindings.map((b) => ({ service: b.service, id: b.id, from: b.from, to: b.to })),
    ambiguous: r.ambiguous.map((a) => ({
      service: a.egress.service, id: a.egress.id, bindKey: a.egress.bindKey,
      candidates: a.candidates.map((c) => `${c.service}:${c.id}`),
    })),
  };
  const count = (xs: { service: string }[], s: string) => xs.filter((x) => x.service === s).length;
  const services: ServiceHealth[] = g.model.services.map((s) => {
    const egress = g.model.egress.filter((e) => e.service === s.name).length;
    const dangling = count(items.dangling, s.name);
    return {
      service: s.name, version: s.version, egress, dangling,
      orphans: count(items.orphans, s.name),
      unbound: count(items.unbound, s.name),
      ambiguous: count(items.ambiguous, s.name),
      eventIssues: EVENT_KINDS.reduce((n, k) => n + count(items[k], s.name), 0),
      storeIssues: STORE_KINDS.reduce((n, k) => n + count(items[k], s.name), 0),
      unresolved: count(items.unresolved, s.name),
      coverage: egress ? (egress - dangling) / egress : null,
    };
  });
  const egressTotal = g.model.egress.length;
  return {
    env: g.model.env,
    totals: {
      services: services.length,
      links: r.links.length,
      egress: egressTotal,
      dangling: items.dangling.length,
      orphans: items.orphans.length,
      unbound: items.unbound.length,
      ambiguous: items.ambiguous.length,
      brokenBindings: items.brokenBindings.length,
      ...Object.fromEntries(EVENT_KINDS.map((k) => [k, items[k].length])) as Record<EventKind, number>,
      multipleWriters: new Set(items.multipleWriters.map((x) => x.key)).size,
      unusedStores: new Set(items.unusedStores.map((x) => x.key)).size,
      unresolved: items.unresolved.length, mixedCommits: items.mixedCommits.length, drift: items.drift.length,
      coverage: egressTotal ? (egressTotal - items.dangling.length) / egressTotal : null,
    },
    services: services.sort((a, b) => (a.coverage ?? 2) - (b.coverage ?? 2) || a.service.localeCompare(b.service)),
    items,
  };
}
