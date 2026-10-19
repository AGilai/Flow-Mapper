// Bug impact and priority. See docs/DESIGN.md §6.
// Impact = number of entry flows that pass through any linked service or function.

import type { GraphIndex } from './graph-index.ts';
import { entryPoints, trace } from './trace.ts';

export type Severity = 'S1' | 'S2' | 'S3' | 'S4';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export interface EntityLink { type: 'service' | 'function' | 'ingress' | 'egress' | 'channel' | 'resource'; service?: string; id: string }

const flowCache = new WeakMap<GraphIndex, { entry: string; services: Set<string>; fns: Set<string> }[]>();

function flows(g: GraphIndex) {
  let f = flowCache.get(g);
  if (!f) {
    f = entryPoints(g).map((e) => {
      const t = trace(g, { service: e.service, ingress: e.id }, { scope: 'full', maxMessages: 2000 });
      const services = new Set<string>(), fns = new Set<string>();
      for (const m of t?.messages ?? []) {
        if (m.service) services.add(m.service);
        if (m.service && m.fn) fns.add(`${m.service}:${m.fn}`);
      }
      return { entry: `${e.service}:${e.id}`, services, fns };
    });
    flowCache.set(g, f);
  }
  return f;
}

export function impact(g: GraphIndex, links: EntityLink[]): { flows: number; totalFlows: number; entries: string[] } {
  const all = flows(g);
  const hits = all.filter((f) => links.some((l) => {
    const svc = l.service ?? (l.type === 'service' ? l.id : undefined);
    if (l.type === 'function') return f.fns.has(`${l.service}:${l.id}`);
    if (l.type === 'ingress' || l.type === 'egress') {
      const ep = l.type === 'ingress' ? g.ingress.get(`${l.service}:${l.id}`) : null;
      return ep ? f.fns.has(`${l.service}:${ep.handler}`) : !!svc && f.services.has(svc);
    }
    return !!svc && f.services.has(svc);
  }));
  return { flows: hits.length, totalFlows: all.length, entries: hits.map((h) => h.entry) };
}

const SEV: Record<Severity, number> = { S1: 4, S2: 3, S3: 2, S4: 1 };

/** score = severity weight + impact boost (0 none, 1 any flow, 2 at least a quarter of all flows). */
export function suggestPriority(severity: Severity, flowsHit: number, totalFlows: number): Priority {
  const boost = flowsHit === 0 ? 0 : totalFlows && flowsHit / totalFlows >= 0.25 ? 2 : 1;
  const score = SEV[severity] + boost;
  return score >= 5 ? 'P0' : score === 4 ? 'P1' : score === 3 ? 'P2' : 'P3';
}
