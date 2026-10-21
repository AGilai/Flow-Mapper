// What harvesters say about their own data: items they could not resolve (with the reason and
// candidates), services scanned at more than one commit, and items that drift from the live system.

import type { GraphIndex } from './graph-index.ts';
import { keyMatches } from './glob.ts';
import { unresolvedTarget } from './resolve.ts';
import type { Assumed, Provenance, Unresolved } from './types.ts';

export interface UnresolvedItem {
  service: string; kind: 'ingress' | 'egress' | 'step' | 'resource' | 'function'; id: string; fn?: string;
  what: Unresolved['what']; reason: string; detail?: string; candidates: string[];
  /** For target candidates: the endpoints each candidate key would reach. */
  possible: { candidate: string; service: string; ingress: string }[];
}

export function unresolvedItems(g: GraphIndex): UnresolvedItem[] {
  const consumers = g.model.ingress.filter((i) => !unresolvedTarget(i));
  const possible = (u: Unresolved) => (u.what !== 'target' ? [] : (u.candidates ?? []).flatMap((c) =>
    consumers.filter((i) => keyMatches(i.bindKey, i.match, c)).map((i) => ({ candidate: c, service: i.service, ingress: i.id }))));
  const item = (base: Omit<UnresolvedItem, 'what' | 'reason' | 'detail' | 'candidates' | 'possible'>, u: Unresolved): UnresolvedItem =>
    ({ ...base, what: u.what, reason: u.reason, detail: u.detail, candidates: u.candidates ?? [], possible: possible(u) });
  return [
    ...g.model.ingress.flatMap((i) => (i.unresolved ?? []).map((u) => item({ service: i.service, kind: 'ingress', id: i.id }, u))),
    ...g.model.egress.flatMap((e) => (e.unresolved ?? []).map((u) => item({ service: e.service, kind: 'egress', id: e.id }, u))),
    ...g.model.resources.flatMap((r) => (r.unresolved ?? []).map((u) => item({ service: r.service, kind: 'resource', id: r.id }, u))),
    ...g.model.functions.flatMap((f) => (f.unresolved ?? []).map((u) => item({ service: f.service, kind: 'function', id: f.id, fn: f.id }, u))),
    ...g.model.functions.flatMap((f) => f.steps.flatMap((s) => (s.unresolved ?? []).map((u) =>
      item({ service: f.service, kind: 'step', id: `${f.id}#${s.seq}`, fn: f.id }, u)))),
  ];
}

/** Services whose items were scanned at a commit other than the manifest's. */
export function mixedCommits(g: GraphIndex): { service: string; commit?: string; others: { commit: string; items: number }[] }[] {
  const out = [];
  for (const s of g.model.services) {
    const counts = new Map<string, number>();
    const add = (c?: string) => { if (c && c !== s.commit) counts.set(c, (counts.get(c) ?? 0) + 1); };
    const mine = <T extends { service: string }>(xs: T[]) => xs.filter((x) => x.service === s.name);
    for (const f of mine(g.model.functions)) add(f.commit);
    for (const x of [...mine(g.model.ingress), ...mine(g.model.egress), ...mine(g.model.resources), ...mine(g.model.channels), ...mine(g.model.bindings)]) add(x.source?.commit);
    if (counts.size) out.push({ service: s.name, commit: s.commit, others: [...counts].map(([commit, items]) => ({ commit, items })) });
  }
  return out;
}

/** Items the harvester checked against the live system and found different. */
export function drift(g: GraphIndex): { service: string; kind: string; id: string; provenance: Provenance }[] {
  const m = g.model;
  const rows: { service: string; kind: string; id: string; provenance?: Provenance }[] = [
    ...m.ingress.map((x) => ({ service: x.service, kind: 'ingress', id: x.id, provenance: x.provenance })),
    ...m.egress.map((x) => ({ service: x.service, kind: 'egress', id: x.id, provenance: x.provenance })),
    ...m.resources.map((x) => ({ service: x.service, kind: 'resource', id: x.id, provenance: x.provenance })),
    ...m.channels.map((x) => ({ service: x.service, kind: 'channel', id: x.bindKey, provenance: x.provenance })),
    ...m.bindings.map((x) => ({ service: x.service, kind: 'binding', id: x.id, provenance: x.provenance })),
  ];
  return rows.filter((r) => r.provenance?.verified === 'drift') as any;
}

/** A value a harvester filled by a rule (#47). Informational: shown beside `unresolved`, never a problem. */
export interface AssumedItem {
  service: string; kind: 'ingress' | 'egress' | 'step' | 'resource' | 'function'; id: string; fn?: string;
  what: string; detail?: string; value: unknown; basis: string; reason: string;
}

export function assumedItems(g: GraphIndex): AssumedItem[] {
  const item = (base: Pick<AssumedItem, 'service' | 'kind' | 'id' | 'fn'>, a: Assumed): AssumedItem =>
    ({ ...base, what: a.what, ...(a.detail !== undefined ? { detail: a.detail } : {}), value: a.value, basis: a.basis, reason: a.reason });
  return [
    ...g.model.ingress.flatMap((i) => (i.assumed ?? []).map((a) => item({ service: i.service, kind: 'ingress', id: i.id }, a))),
    ...g.model.egress.flatMap((e) => (e.assumed ?? []).map((a) => item({ service: e.service, kind: 'egress', id: e.id }, a))),
    ...g.model.resources.flatMap((r) => (r.assumed ?? []).map((a) => item({ service: r.service, kind: 'resource', id: r.id }, a))),
    ...g.model.functions.flatMap((f) => (f.assumed ?? []).map((a) => item({ service: f.service, kind: 'function', id: f.id, fn: f.id }, a))),
    ...g.model.functions.flatMap((f) => f.steps.flatMap((s) => (s.assumed ?? []).map((a) => item({ service: f.service, kind: 'step', id: `${f.id}#${s.seq}`, fn: f.id }, a)))),
  ];
}
