// Inventory: every object in one list — services (incl. gateways and Lambdas), topics/queues/buses,
// data stores and event types — with a short "connections" line and a problem count for filtering.

import type { GraphIndex } from './graph-index.ts';
import { health } from './health.ts';
import { channelSummaries } from './channels.ts';
import { eventReport, eventTypes } from './events.ts';
import { groupOf, stores } from './stores.ts';
import { instances } from './instances.ts';
import type { KeySummary } from './keys.ts';
import { amqpRows, type AmqpRow } from './amqp-inventory.ts';

export type InventoryType = 'service' | 'channel' | 'store' | 'event' | 'rpc';
export interface InventoryItem {
  type: InventoryType; id: string; label: string; kind: string;
  group?: string; team?: string; connections: string; size: number; problems: number;
  /** Event types only: whether the event type has a message DTO. */
  hasDto?: boolean;
  /** Data stores: this row is a Redis cluster or instance (its page is /instances/<id>), not one key pattern. `kind` stays 'redis'. */
  instance?: 'cluster' | 'instance';
  /** RabbitMQ (0.19.0): the exchange type; RPC plumbing the page folds; where an RPC command or a reply-queue row opens. */
  exchangeType?: string; plumbing?: boolean; open?: AmqpRow['open'];
}

const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;

/** `dtoEvents`: the event types that have a message DTO (sets `hasDto` on event items). `keySummaries`: the stored key summary per Redis instance key. */
export function inventory(g: GraphIndex, dtoEvents: Iterable<string> = [], keySummaries: Map<string, KeySummary> = new Map()): InventoryItem[] {
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
  const chans = channelSummaries(g);
  for (const c of chans) {
    if (c.kind === 'amqp-exchange' || c.kind === 'amqp-queue') continue; // listed by amqpRows below, in RabbitMQ's own words
    out.push({
      type: 'channel', id: c.key, label: c.name, kind: c.kind, group: c.key,
      connections: `${n(c.publishers, 'publisher')}, ${n(c.subscriptions, 'subscription')}, ${n(c.consumers, 'consumer')}`,
      size: c.publishers + c.consumers + c.subscriptions, problems: c.problems,
    });
  }
  out.push(...amqpRows(g, new Map(chans.map((c) => [c.key, c.problems]))));
  const multi = new Set(h.items.multipleWriters.map((x) => x.key));
  const unused = new Set(h.items.unusedStores.map((x) => x.key));
  const inst = instances(g, keySummaries);
  const instKeys = new Set(inst.map((i) => i.key));
  const storeProblems = (s: { key: string }) => (multi.has(s.key) ? 1 : 0) + (unused.has(s.key) ? 1 : 0);
  const all = stores(g);
  for (const i of inst) {
    const members = all.filter((s) => s.kind === 'redis' && !s.keyUnknown && groupOf(s.key) === i.key);
    const parts = [n(i.services.length, 'service'), i.databases ? n(i.databases, 'db') : null, i.templates ? n(i.templates, 'key template') : null].filter(Boolean);
    out.push({
      type: 'store', id: i.key, label: i.name, kind: 'redis', instance: i.topology, team: i.team,
      connections: parts.join(' · '), size: i.services.length, problems: i.templates ? i.problems : members.reduce((x, s) => x + storeProblems(s), 0), // key problems when keys are known; they cover the shared-writer case the store checks flag
    });
  }
  for (const s of all) {
    if (s.kind === 'redis' && !s.keyUnknown && instKeys.has(groupOf(s.key))) continue;
    out.push({
      type: 'store', id: s.key, label: s.name, kind: s.kind, group: s.group,
      connections: `${n(s.readers.length, 'reader')}, ${n(s.writers.length, 'writer')}`, size: s.services.length,
      problems: storeProblems(s),
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
