// One-hop neighbours of a set of services, for the New environment page: services that call or are called by a
// picked one, directly or through a channel (topic, queue, exchange). Each neighbour says why. Pure.

import type { GraphIndex } from './graph-index.ts';
import { downstreamIngress } from './graph-index.ts';
import type { Model } from './types.ts';
import { channelsFor } from './channels-for.ts';

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

export interface CarryRow { name: string; kind: string; team?: string; groupPath?: string; /** the channels that come along (the page counts the union of the picked rows) */ channelKeys: string[]; counts: { endpoints: number; calls: number; channels: number; stores: number; dtos: number } }

/** What a component brings into a Components copy: its endpoints, calls, queues and topics (declared, used, and the routing out of them), data stores and DTOs. Functions and flows never come. */
export function carryRows(model: Model, dtosByService: Record<string, number> = {}): CarryRow[] {
  const n = <T extends { service: string }>(xs: T[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x.service, (m.get(x.service) ?? 0) + 1);
    return m;
  };
  const [ing, egr, res] = [n(model.ingress), n(model.egress), n(model.resources)];
  const chans = new Map(model.services.map((s) => [s.name, [...channelsFor(model, new Set([s.name])).all]]));
  return model.services.map((s) => ({
    name: s.name, kind: s.kind, team: s.team, groupPath: s.groupPath, channelKeys: chans.get(s.name)!,
    counts: { endpoints: ing.get(s.name) ?? 0, calls: egr.get(s.name) ?? 0, channels: chans.get(s.name)!.length, stores: res.get(s.name) ?? 0, dtos: dtosByService[s.name] ?? 0 },
  }));
}
