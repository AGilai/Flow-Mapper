// Link-health summary per environment and per service. See docs/DESIGN.md §5.

import type { GraphIndex } from './graph-index.ts';

export interface ServiceHealth {
  service: string;
  version: number;
  egress: number;
  dangling: number;
  orphans: number;
  unbound: number;
  ambiguous: number;
  coverage: number | null; // resolved egress / egress, null when the service has no egress
}

export interface HealthReport {
  env: string;
  totals: Omit<ServiceHealth, 'service' | 'version'> & { services: number; links: number; brokenBindings: number };
  services: ServiceHealth[];
  items: {
    dangling: { service: string; id: string; bindKey: string; transport: string }[];
    orphans: { service: string; id: string; bindKey: string; transport: string }[];
    unbound: { service: string; bindKey: string; kind: string; reason: string }[];
    brokenBindings: { service: string; id: string; from: string; to: string }[];
    ambiguous: { service: string; id: string; bindKey: string; candidates: string[] }[];
  };
}

export function health(g: GraphIndex): HealthReport {
  const r = g.resolution;
  const items: HealthReport['items'] = {
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
      coverage: egressTotal ? (egressTotal - items.dangling.length) / egressTotal : null,
    },
    services: services.sort((a, b) => (a.coverage ?? 2) - (b.coverage ?? 2) || a.service.localeCompare(b.service)),
    items,
  };
}
