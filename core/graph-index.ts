// Builds lookup maps over a Model plus its Resolution. Every query module takes a GraphIndex,
// so the expensive resolve() runs once per model change (server caches it per environment).

import type { Channel, Egress, Fn, Ingress, Link, Model, Ref, Resolution, Resource, Service } from './types.ts';
import { mergedChannels, refKey, resolve } from './resolve.ts';

export interface GraphIndex {
  model: Model;
  resolution: Resolution;
  services: Map<string, Service>;
  fns: Map<string, Fn>;              // `${service}:${id}`
  ingress: Map<string, Ingress>;     // `${service}:${id}`
  egress: Map<string, Egress>;
  resources: Map<string, Resource>;
  channels: Map<string, Channel>;    // by bindKey (merged)
  out: Map<string, Link[]>;          // refKey(from) → links
  into: Map<string, Link[]>;         // refKey(to) → links
}

export const sid = (service: string, id: string) => `${service}:${id}`;

export function buildIndex(model: Model): GraphIndex {
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
  return {
    model, resolution,
    services: new Map(model.services.map((s) => [s.name, s])),
    fns: by(model.functions), ingress: by(model.ingress), egress: by(model.egress), resources: by(model.resources),
    channels: mergedChannels(model), out, into,
  };
}

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
