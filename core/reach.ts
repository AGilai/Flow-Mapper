// Reverse reachability: which entry points eventually run a given function. Walks backwards from a
// function to its callers in the same service, to the ingress it handles (including per-event
// handlers), and across services through the egress that reach that ingress.

import type { GraphIndex } from './graph-index.ts';
import { sid, upstreamEgress } from './graph-index.ts';
import type { Ingress } from './types.ts';

interface Reverse { callers: Map<string, string[]>; handled: Map<string, Ingress[]>; usesEgress: Map<string, string[]> }
const cache = new WeakMap<GraphIndex, Reverse>();

function reverse(g: GraphIndex): Reverse {
  let r = cache.get(g);
  if (r) return r;
  r = { callers: new Map(), handled: new Map(), usesEgress: new Map() };
  const add = <T>(m: Map<string, T[]>, k: string, v: T) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push(v); };
  for (const f of g.model.functions) for (const s of f.steps) {
    if (s.type === 'call') add(r.callers, sid(f.service, s.target), f.id);
    if (s.type === 'egress') add(r.usesEgress, sid(f.service, s.target), f.id);
  }
  for (const i of g.model.ingress) {
    for (const h of new Set([i.handler, ...(i.events ?? []).map((e) => e.handler)])) add(r.handled, sid(i.service, h), i);
  }
  cache.set(g, r);
  return r;
}

export interface EntryHit { service: string; ingress: string; bindKey: string; transport: string; entryPoint: boolean }

/** Entry points (ingress marked entryPoint, or nothing upstream) whose flows reach any of `fns`. */
export function entryPointsReaching(g: GraphIndex, fns: { service: string; fn: string }[], limit = 500): EntryHit[] {
  const r = reverse(g);
  const seenFn = new Set<string>(), seenIn = new Set<string>();
  const hits: EntryHit[] = [];
  const stack = fns.map((f) => sid(f.service, f.fn));
  while (stack.length && hits.length < limit) {
    const k = stack.pop()!;
    if (seenFn.has(k)) continue;
    seenFn.add(k);
    const service = k.slice(0, k.indexOf(':'));
    for (const caller of r.callers.get(k) ?? []) stack.push(sid(service, caller));
    for (const i of r.handled.get(k) ?? []) {
      const ik = sid(i.service, i.id);
      if (seenIn.has(ik)) continue;
      seenIn.add(ik);
      const up = upstreamEgress(g, i);
      if (i.entryPoint || !up.length) hits.push({ service: i.service, ingress: i.id, bindKey: i.bindKey, transport: i.transport, entryPoint: !!i.entryPoint });
      for (const u of up) for (const fn of r.usesEgress.get(sid(u.egress.service, u.egress.id)) ?? []) stack.push(sid(u.egress.service, fn));
    }
  }
  return hits.sort((a, b) => a.service.localeCompare(b.service) || a.bindKey.localeCompare(b.bindKey));
}
