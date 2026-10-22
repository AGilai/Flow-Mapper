// Builds lookup maps over a Model plus its Resolution. Every query module takes a GraphIndex,
// so the expensive resolve() runs once per model change (server caches it per environment).

import type { Binding, Channel, Egress, Fn, Ingress, Link, Model, Ref, Resolution, Resource, Service, Step } from './types.ts';
import { mergedChannels, refKey, resolve, withPlaceholderKeys } from './resolve.ts';
import { keyMatches } from './glob.ts';

/** One service's items, each list in model order (the order of `model.<list>.filter(x => x.service === s)`). */
export interface ServiceItems { functions: Fn[]; ingress: Ingress[]; egress: Egress[]; resources: Resource[]; channels: Channel[]; bindings: Binding[] }
const NONE: ServiceItems = { functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [] };

export interface GraphIndex {
  model: Model;
  resolution: Resolution;
  services: Map<string, Service>;
  fns: Map<string, Fn>;              // `${service}:${id}`
  ingress: Map<string, Ingress>;     // `${service}:${id}`
  egress: Map<string, Egress>;
  resources: Map<string, Resource>;
  channels: Map<string, Channel>;    // by bindKey (merged)
  bindings: Map<string, Binding>;    // `${service}:${id}`
  out: Map<string, Link[]>;          // refKey(from) → links
  into: Map<string, Link[]>;         // refKey(to) → links
  byService: Map<string, ServiceItems>;  // per-service lists of the model (read-only: shared by every caller)
  egressByKey: Map<string, Egress[]>;   // bindKey → egress with that bind key, in model order
  stepsToEgress: Map<string, { fn: Fn; step: Step }[]>; // `${service}:${egress id}` → the egress steps that target it, in function then step order
}

export const sid = (service: string, id: string) => `${service}:${id}`;

export function buildIndex(raw: Model): GraphIndex {
  const model = withPlaceholderKeys(raw);
  const resolution = resolve(model);
  const by = <T extends { service: string; id: string }>(xs: T[]) => new Map(xs.map((x) => [sid(x.service, x.id), x]));
  const out = new Map<string, Link[]>();
  const into = new Map<string, Link[]>();
  for (const l of resolution.links) {
    const a = refKey(l.from), b = refKey(l.to);
    if (!out.has(a)) out.set(a, []);
    if (!into.has(b)) into.set(b, []);
    out.get(a)!.push(l);
    into.get(b)!.push(l);
  }
  const byService = new Map<string, ServiceItems>();
  const of = (service: string) => { let x = byService.get(service); if (!x) byService.set(service, (x = { functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [] })); return x; };
  const egressByKey = new Map<string, Egress[]>();
  for (const e of model.egress) { const l = egressByKey.get(e.bindKey); if (l) l.push(e); else egressByKey.set(e.bindKey, [e]); }
  const stepsToEgress = new Map<string, { fn: Fn; step: Step }[]>();
  for (const f of model.functions) {
    of(f.service).functions.push(f);
    for (const step of f.steps) if (step.type === 'egress' && step.target !== undefined) {
      const k = sid(f.service, step.target);
      let l = stepsToEgress.get(k);
      if (!l) stepsToEgress.set(k, (l = []));
      l.push({ fn: f, step });
    }
  }
  for (const l of ['ingress', 'egress', 'resources', 'channels', 'bindings'] as const) for (const x of model[l] as { service: string }[]) (of(x.service)[l] as unknown[]).push(x);
  return {
    model, resolution, byService, egressByKey, stepsToEgress,
    services: new Map(model.services.map((s) => [s.name, s])),
    fns: by(model.functions), ingress: by(model.ingress), egress: by(model.egress), resources: by(model.resources),
    channels: mergedChannels(model), bindings: by(model.bindings), out, into,
  };
}

const subs = new WeakMap<GraphIndex, { exact: Map<string, { b: Binding; i: number }[]>; patterns: { b: Binding; i: number }[] }>();
/** The bindings that leave a channel key: `model.bindings.filter(b => keyMatches(b.from, b.match, key))`, in model order, without the scan. */
export function subscriptionsOf(g: GraphIndex, key: string): Binding[] {
  let ix = subs.get(g);
  if (!ix) {
    ix = { exact: new Map(), patterns: [] };
    g.model.bindings.forEach((b, i) => {
      if (b.match === 'glob' || b.match === 'amqp-topic') { ix!.patterns.push({ b, i }); return; }
      const l = ix!.exact.get(b.from);
      if (l) l.push({ b, i }); else ix!.exact.set(b.from, [{ b, i }]);
    });
    subs.set(g, ix);
  }
  const hit = ix.exact.get(key) ?? [];
  const pats = ix.patterns.filter((x) => keyMatches(x.b.from, x.b.match, key));
  return (pats.length ? [...hit, ...pats].sort((a, b) => a.i - b.i) : hit).map((x) => x.b);
}

/** The items of one service (empty lists for an unknown service). Never mutate them. */
export const itemsOf = (g: GraphIndex, service: string): ServiceItems => g.byService.get(service) ?? NONE;
export const linksFrom = (g: GraphIndex, r: Ref) => g.out.get(refKey(r)) ?? [];
export const linksInto = (g: GraphIndex, r: Ref) => g.into.get(refKey(r)) ?? [];

/** Follow links from a ref through channels until reaching ingress. Returns the ingress hops with the path taken. */
export function downstreamIngress(g: GraphIndex, start: Ref): { ingress: Ingress; via: Ref[] }[] {
  const res: { ingress: Ingress; via: Ref[] }[] = [];
  const seen = new Set<string>();
  const walk = (r: Ref, path: Ref[]) => {
    for (const l of linksFrom(g, r)) {
      const k = refKey(l.to);
      if (seen.has(k)) continue;
      seen.add(k);
      if (l.to.type === 'ingress') res.push({ ingress: g.ingress.get(sid(l.to.service, l.to.id))!, via: path });
      else walk(l.to, [...path, l.to]);
    }
  };
  walk(start, []);
  return res;
}

/** Follow links backwards from an ingress to the egress that reach it. */
export function upstreamEgress(g: GraphIndex, ingress: Ingress): { egress: Egress; via: Ref[] }[] {
  const res: { egress: Egress; via: Ref[] }[] = [];
  const seen = new Set<string>();
  const walk = (r: Ref, path: Ref[]) => {
    for (const l of linksInto(g, r)) {
      const k = refKey(l.from);
      if (seen.has(k)) continue;
      seen.add(k);
      if (l.from.type === 'egress') res.push({ egress: g.egress.get(sid(l.from.service, l.from.id))!, via: path });
      else walk(l.from, [l.from, ...path]);
    }
  };
  walk({ type: 'ingress', service: ingress.service, id: ingress.id }, []);
  return res;
}
