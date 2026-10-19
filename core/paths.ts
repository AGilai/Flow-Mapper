// Service-level paths between two services (through REST and through channel chains).

import type { GraphIndex } from './graph-index.ts';
import { downstreamIngress } from './graph-index.ts';

export interface Hop { from: string; to: string; egress: string; ingress: string; bindKey: string; via: string[] }

/** Up to `limit` shortest simple paths from service `a` to service `b`, at most `maxHops` hops. */
export function findPaths(g: GraphIndex, a: string, b: string, limit = 5, maxHops = 8): Hop[][] {
  const adj = new Map<string, Hop[]>();
  for (const e of g.model.egress) {
    for (const d of downstreamIngress(g, { type: 'egress', service: e.service, id: e.id })) {
      if (d.ingress.service === e.service) continue;
      const hop: Hop = {
        from: e.service, to: d.ingress.service, egress: e.id, ingress: d.ingress.id, bindKey: e.bindKey,
        via: d.via.map((v) => (v.type === 'channel' ? v.key : '')).filter(Boolean),
      };
      if (!adj.has(e.service)) adj.set(e.service, []);
      adj.get(e.service)!.push(hop);
    }
  }
  const out: Hop[][] = [];
  const queue: { at: string; path: Hop[] }[] = [{ at: a, path: [] }];
  while (queue.length && out.length < limit) {
    const { at, path } = queue.shift()!;
    if (path.length >= maxHops) continue;
    for (const h of adj.get(at) ?? []) {
      if (h.to !== b && (h.to === a || path.some((p) => p.to === h.to))) continue;
      const next = [...path, h];
      if (h.to === b) { out.push(next); if (out.length >= limit) break; }
      else queue.push({ at: h.to, path: next });
    }
  }
  return out;
}
