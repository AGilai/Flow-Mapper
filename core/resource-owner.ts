// Who owns a data store in a flow diagram (0.30.1, bug #67): the component that declares the resource. Several components can declare one bind key
// (`redis:cache-main`); the owner is the first one that is not an infra component, else the first. The sequence view draws the store in the owner's
// subsystem band. A store nobody declares has no owner.

import type { GraphIndex } from './graph-index.ts';

const cache = new WeakMap<GraphIndex, Map<string, string>>();

/** resourceOwner(g, bindKey) -> the owning component's name, or undefined. */
export function resourceOwner(g: GraphIndex, bindKey: string | undefined): string | undefined {
  if (!bindKey) return undefined;
  let m = cache.get(g);
  if (!m) {
    m = new Map();
    for (const r of g.model.resources) {
      if (!r.bindKey) continue;
      const have = m.get(r.bindKey);
      if (!have || (g.services.get(have)?.kind === 'infra' && g.services.get(r.service)?.kind !== 'infra')) m.set(r.bindKey, r.service);
    }
    cache.set(g, m);
  }
  return m.get(bindKey);
}
