// External services (#87): a service whose header carries `details.external: true` is a third-party host.
// One classification and the counts split, shared by the server, MCP and the browser. Pure: no node: imports.

import type { GraphIndex } from './graph-index.ts';

/** Only the boolean `true` counts (any other value, or none, is internal). */
export const isExternal = (details: { external?: unknown } | undefined | null): boolean => details?.external === true;

const cache = new WeakMap<GraphIndex, Set<string>>();
/** The names of the external services of a graph (memoised per graph: do not mutate). */
export function externalSet(g: GraphIndex): Set<string> {
  let s = cache.get(g);
  if (!s) cache.set(g, (s = new Set(g.model.services.filter((x) => isExternal(x.details)).map((x) => x.name))));
  return s;
}

/** `{ external: true }` for an external service, else nothing, so the field is omitted on internal ones. */
export const externalField = (g: GraphIndex, service: string | undefined): { external?: true } => (service && externalSet(g).has(service) ? { external: true } : {});

/** Splits service names into internal and external counts. */
export function splitCount(names: Iterable<string>, ext: ReadonlySet<string>): { internal: number; external: number } {
  let internal = 0, external = 0;
  for (const n of names) if (ext.has(n)) external++; else internal++;
  return { internal, external };
}

/** "4 services", "4 services · 1 external" (M omitted when 0). `noun` is "service" or "component". */
export function servicesText(internal: number, external: number, noun = 'service'): string {
  return `${internal} ${noun}${internal === 1 ? '' : 's'}${external ? ` · ${external} external` : ''}`;
}
