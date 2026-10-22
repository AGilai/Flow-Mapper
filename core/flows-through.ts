// "Flows through it" (0.33.0, the info pane): which entry points' flows run through a component, or through any component of a subsystem.
// Built on the same reachability the Flows list counts with (flow-counts.ts `componentSets`: 's:<service>' ids), so it agrees with those counts.

import type { GraphIndex } from './graph-index.ts';
import { sid } from './graph-index.ts';
import { componentSets } from './flow-counts.ts';
import { entryPoints } from './entry-points.ts';

/** The `<service>:<ingress>` keys of the entry points whose flows reach any of `services` (a flow starting in one of them counts). */
export function flowsThrough(g: GraphIndex, services: string[]): Set<string> {
  const want = new Set(services.map((s) => `s:${s}`)), sets = componentSets(g), out = new Set<string>();
  for (const e of entryPoints(g)) {
    if (want.has(`s:${e.service}`)) { out.add(`${e.service}:${e.id}`); continue; } // an entry with no handler still starts in its own component
    for (const fn of [e.handler, ...(e.middleware ?? [])]) {
      if ((sets.get(sid(e.service, fn)) ?? []).some((c) => want.has(c))) { out.add(`${e.service}:${e.id}`); break; }
    }
  }
  return out;
}
