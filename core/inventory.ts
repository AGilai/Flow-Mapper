// Inventory: every object in one list — services (incl. gateways and Lambdas), topics/queues/buses,
// data stores and event types — with a short "connections" line and a problem count for filtering.

import type { GraphIndex } from './graph-index.ts';
import { health } from './health.ts';
import { channelSummaries } from './channels.ts';
import { eventReport, eventTypes } from './events.ts';
import { stores } from './stores.ts';

export type InventoryType = 'service' | 'channel' | 'store' | 'event';
export interface InventoryItem {
  type: InventoryType; id: string; label: string; kind: string;
  group?: string; team?: string; connections: string; size: number; problems: number;
  /** Event types only: whether the event type has a message DTO. */
  hasDto?: boolean;
}

const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;

/** `dtoEvents`: the event types that have a message DTO (sets `hasDto` on event items). */
export function inventory(g: GraphIndex, dtoEvents: Iterable<string> = []): InventoryItem[] {
  const withDto = new Set(dtoEvents);
  const h = health(g);
  const ev = eventReport(g);
  const out: InventoryItem[] = [];
  for (const s of h.services) {
    const svc = g.services.get(s.service)!;
    if (svc.kind === 'infra') continue;
    const ingress = g.model.ingress.filter((i) => i.service === s.service).length;
    out.push({
      type: 'service', id: s.service, label: s.service, kind: svc.kind, team: svc.team,
      connections: `${n(ingress, 'endpoint')}, ${n(s.egress, 'call')}`, size: ingress + s.egress,
      problems: s.dangling + s.orphans + s.unbound + s.ambiguous + s.eventIssues,
    });
  }
  for (const c of channelSummaries(g)) {
    out.push({
      type: 'channel', id: c.key, label: c.name, kind: c.kind, group: c.key,
      connections: `${n(c.publishers, 'publisher')}, ${n(c.subscriptions, 'subscription')}, ${n(c.consumers, 'consumer')}`,
      size: c.publishers + c.consumers + c.subscriptions, problems: c.problems,
    });
  }
  const multi = new Set(h.items.multipleWriters.map((x) => x.key));
  const unused = new Set(h.items.unusedStores.map((x) => x.key));
  for (const s of stores(g)) {
    out.push({
      type: 'store', id: s.key, label: s.name, kind: s.kind, group: s.group,
      connections: `${n(s.readers.length, 'reader')}, ${n(s.writers.length, 'writer')}`, size: s.services.length,
      problems: (multi.has(s.key) ? 1 : 0) + (unused.has(s.key) ? 1 : 0),
    });
  }
  for (const t of eventTypes(g)) {
    const bad = [ev.unhandled, ev.undelivered, ev.neverArrives, ev.declaredNotSeen].reduce((x, xs) => x + xs.filter((d) => d.event === t.type).length, 0);
    out.push({
      type: 'event', id: t.type, label: t.type, kind: 'event type',
      connections: `${n(t.producers.length, 'producer')}, ${n(t.consumers.length, 'consumer')}`,
      size: t.producers.length + t.consumers.length, problems: bad, hasDto: withDto.has(t.type),
    });
  }
  return out;
}
