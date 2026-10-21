// Suggestions for refining an abstract link: the existing calls from its `from` scope into its `to` scope (same mode first, then the same
// transport), then components of an open end that have no such call yet. At most 5. Pure.

import { downstreamIngress, type GraphIndex } from './graph-index.ts';
import { inside, worldOfGraph, type AbstractView } from './abstract-links.ts';
import type { SubsystemMap } from './subsystem-rollup.ts';
import { callInfo } from './subsystems.ts';

export interface Suggestion { use?: { service: string; egress: string }; from?: string; to?: string; reason: string }

/** `http:POST auth-svc/token` -> `POST /token`; other bind keys as they are. */
const operationOf = (bindKey: string) => {
  const m = /^http:([A-Z]+) [^/]+(\/.*)$/.exec(bindKey);
  return m ? `${m[1]} ${m[2]}` : bindKey;
};

export function suggestRefinements(view: AbstractView, map: SubsystemMap, g: GraphIndex, subRows: { key: string }[] = []): Suggestion[] {
  if (view.state === 'refined') return [];
  const w = worldOfGraph(g, subRows as any);
  const from = view.from.anchor, to = view.to.anchor;
  const found: { s: Suggestion; rank: number }[] = [];
  const callers = new Set<string>();
  for (const e of g.model.egress) {
    if (!inside(from, `egr:${e.service}/${e.id}`, w) || (view.from.level === 'endpoint' && from !== `egr:${e.service}/${e.id}`)) continue;
    for (const d of downstreamIngress(g, { type: 'egress', service: e.service, id: e.id })) {
      if (!inside(to, `ing:${d.ingress.service}/${d.ingress.id}`, w)) continue;
      const c = callInfo(e, d.ingress, d.via.length > 0, w.svc);
      callers.add(e.service);
      const rank = (view.mode && c.mode !== view.mode ? 2 : 0) + (view.transport && c.transport !== view.transport ? 1 : 0);
      found.push({ rank, s: { use: { service: e.service, egress: e.id }, reason: `${e.service} already calls ${d.ingress.service} over ${c.transport}${c.mode === 'async' ? ' (async)' : ''} (${operationOf(e.bindKey)})` } });
    }
  }
  found.sort((a, b) => a.rank - b.rank);
  const out = found.map((f) => f.s);
  // Components of an open end (a subsystem) that make no such call yet: narrowing the end to one of them is the next step.
  for (const [end, side] of [[view.from, 'from'], [view.to, 'to']] as const) {
    if (end.level !== 'subsystem') continue;
    const box = map.boxes.find((b) => b.key === end.subsystem);
    for (const c of box?.components ?? []) {
      if (side === 'from' && callers.has(c.name)) continue;
      out.push({ [side]: `svc:${c.name}`, reason: `${c.name} is in ${box!.label}${side === 'from' ? ' and makes no call into the other end yet' : ''}` });
    }
  }
  return out.slice(0, 5);
}
