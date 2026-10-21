// One-hop neighbours of a set of services, for the New environment page: services that call or are called by a
// picked one, directly or through a channel (topic, queue, exchange). Each neighbour says why. Pure.

import type { GraphIndex } from './graph-index.ts';
import { downstreamIngress } from './graph-index.ts';
import type { Model } from './types.ts';

export interface Neighbour { service: string; team?: string; kind: string; groupPath?: string; reasons: string[]; reason: string }

interface Hop { from: string; to: string; via: string | null }

/** Service-to-service hops over the resolved links; a hop through channels names the first channel. */
export function serviceHops(g: GraphIndex): Hop[] {
  const out = new Map<string, Hop>();
  for (const e of g.model.egress) {
    for (const d of downstreamIngress(g, { type: 'egress', service: e.service, id: e.id })) {
      if (d.ingress.service === e.service) continue;
      const via = d.via.find((r) => r.type === 'channel') as { key: string } | undefined;
      const k = `${e.service}>${d.ingress.service}>${via?.key ?? ''}`;
      if (!out.has(k)) out.set(k, { from: e.service, to: d.ingress.service, via: via?.key ?? null });
    }
  }
  return [...out.values()];
}

export function neighbours(g: GraphIndex, picked: string[]): Neighbour[] {
  const set = new Set(picked);
  const found = new Map<string, string[]>();
  const add = (svc: string, why: string) => {
    if (set.has(svc) || g.services.get(svc)?.kind === 'infra') return;
    const l = found.get(svc) ?? [];
    if (!l.includes(why)) l.push(why);
    found.set(svc, l);
  };
  // The queue or topic by its name ("saferx.activitylog"), not its bind key ("amqp-queue:saferx.activitylog")
  const nameOf = (key: string) => g.channels.get(key)?.name ?? key.slice(key.indexOf(':') + 1);
  for (const h of serviceHops(g)) {
    const via = h.via ? ` via ${nameOf(h.via)}` : '';
    if (set.has(h.from)) add(h.to, h.via ? `gets events from ${h.from}${via}` : `is called by ${h.from}`);
    if (set.has(h.to)) add(h.from, h.via ? `sends events to ${h.to}${via}` : `calls ${h.to}`);
  }
  return [...found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([service, reasons]) => {
    const s = g.services.get(service)!;
    return { service, team: s.team, kind: s.kind, groupPath: (s as any).groupPath, reasons, reason: reasons.slice(0, 2).join('; ') + (reasons.length > 2 ? ` (+${reasons.length - 2})` : '') };
  });
}

export interface CarryRow { name: string; kind: string; team?: string; groupPath?: string; counts: { endpoints: number; calls: number; channels: number; stores: number; dtos: number } }

/** What a component brings into a Components copy: its endpoints, calls, queues and topics (declared or used), data stores and DTOs. Functions and flows never come. */
export function carryRows(model: Model, dtosByService: Record<string, number> = {}): CarryRow[] {
  const n = <T extends { service: string }>(xs: T[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x.service, (m.get(x.service) ?? 0) + 1);
    return m;
  };
  const [ing, egr, res] = [n(model.ingress), n(model.egress), n(model.resources)];
  // Queues, topics and exchanges a component declares or uses (publishes to, consumes from): a queue is usually declared by an infra service.
  const keys = new Set(model.channels.map((c) => c.bindKey));
  const used = new Map<string, Set<string>>();
  const touch = (service: string, key?: string) => {
    const k = key && (keys.has(key) ? key : keys.has(key.split('/')[0]) ? key.split('/')[0] : null);
    if (k) used.set(service, (used.get(service) ?? new Set()).add(k));
  };
  for (const c of model.channels) touch(c.service, c.bindKey);
  for (const e of model.egress) touch(e.service, e.bindKey);
  for (const i of model.ingress) touch(i.service, i.bindKey);
  for (const b of model.bindings) { touch(b.service, b.from); touch(b.service, b.to); }
  const ch = new Map([...used].map(([s, set]) => [s, set.size]));
  return model.services.map((s) => ({
    name: s.name, kind: s.kind, team: s.team, groupPath: s.groupPath,
    counts: { endpoints: ing.get(s.name) ?? 0, calls: egr.get(s.name) ?? 0, channels: ch.get(s.name) ?? 0, stores: res.get(s.name) ?? 0, dtos: dtosByService[s.name] ?? 0 },
  }));
}
