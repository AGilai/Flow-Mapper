// Free-text search over services, functions, endpoints, channels and resources.

import type { GraphIndex } from './graph-index.ts';

export interface SearchHit { type: 'service' | 'function' | 'ingress' | 'egress' | 'channel' | 'resource'; service?: string; id: string; label: string; detail?: string; /** An endpoint's flow name, where it has one (the search matches it too). */ name?: string }

/** `names`: flow names by `<service>/<ingress>` (server/refs.ts flowNameMap). */
export function search(g: GraphIndex, q: string, limit = 50, names?: Map<string, string>): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const hit = (...xs: (string | undefined)[]) => xs.some((x) => x?.toLowerCase().includes(needle));
  const m = g.model;
  const hits: SearchHit[] = [
    ...m.services.filter((s) => hit(s.name, s.team, s.description, ...(s.tags ?? [])))
      .map((s) => ({ type: 'service' as const, id: s.name, label: s.name, detail: s.team })),
    ...m.functions.filter((f) => hit(f.id, f.name, f.file))
      .map((f) => ({ type: 'function' as const, service: f.service, id: f.id, label: f.name, detail: f.file })),
    ...m.ingress.filter((i) => hit(i.id, i.bindKey, names?.get(`${i.service}/${i.id}`)))
      .map((i) => ({ type: 'ingress' as const, service: i.service, id: i.id, label: i.bindKey, detail: i.transport, ...(names?.get(`${i.service}/${i.id}`) ? { name: names.get(`${i.service}/${i.id}`) } : {}) })),
    ...m.egress.filter((e) => hit(e.id, e.bindKey))
      .map((e) => ({ type: 'egress' as const, service: e.service, id: e.id, label: e.bindKey, detail: e.transport })),
    ...[...g.channels.values()].filter((c) => hit(c.bindKey, c.name))
      .map((c) => ({ type: 'channel' as const, id: c.bindKey, label: c.name ?? c.bindKey, detail: c.kind })),
    ...m.resources.filter((r) => hit(r.name, r.bindKey, r.kind))
      .map((r) => ({ type: 'resource' as const, service: r.service, id: r.id, label: r.name, detail: r.kind })),
  ];
  return hits.slice(0, limit);
}
