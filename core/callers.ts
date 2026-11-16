// #116: the client apps that call an entry ingress. A `client-app` service (no harvested code) may declare an egress whose bind key
// matches a socket ingress (or an http ingress that is an entry point): the trace's caller lifeline then is that app, not a generic "client".
// The link is the one resolution already makes (egress -> ingress by key), so the egress is matched, never dangling, and the ingress stays an entry point.

import type { GraphIndex } from './graph-index.ts';
import { refKey } from './resolve.ts';
import type { Ingress } from './types.ts';

/** Names of the client-app services whose egress resolves to this entry ingress, in model order, once each. Empty for any other ingress. */
export function callersOf(g: GraphIndex, ing: Ingress | undefined): string[] {
  if (!ing || !(ing.transport === 'socket' || (ing.transport === 'http' && ing.entryPoint))) return [];
  const names = new Set<string>();
  for (const l of g.into.get(refKey({ type: 'ingress', service: ing.service, id: ing.id })) ?? [])
    if (l.from.type === 'egress' && g.services.get(l.from.service)?.kind === 'client-app') names.add(l.from.service);
  return [...names];
}
