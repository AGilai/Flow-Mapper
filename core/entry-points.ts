// Entry points of a graph and the empty flow of one that has no handler. Re-exported by trace.ts.

import type { GraphIndex } from './graph-index.ts';
import { sid } from './graph-index.ts';
import type { Ingress } from './types.ts';
import { externalField } from './external.ts';
import { rpcServed } from './amqp-route.ts';
import type { Trace, Participant } from './trace.ts';
import { coverageOf } from './incomplete.ts';

/** The flow of an entry point with no handler (#59): the caller and the service, no steps. */
export function emptyFlow(service: string, ing: Ingress, scope: 'intra' | 'full', event?: string): Trace {
  const client: Participant = { id: 'client', label: ing.entryPoint ? 'client' : 'caller', kind: 'client' };
  return { code: {}, start: { service, ingress: ing.id, fn: '', event }, scope, participants: [client, { id: `svc:${service}`, label: service, kind: 'service', service }], messages: [], truncated: false, noHandler: true };
}

/** Entry points to start a trace from: ingress marked `entryPoint: true`, else ingress nothing reaches (a socket ingress counts as marked); `entryPoint: false` is never one (0.25.1, #55). */
export function entryPoints(g: GraphIndex) {
  const orphan = new Set(g.resolution.orphans.map((i) => sid(i.service, i.id)));
  return g.model.ingress
    .filter((i) => i.entryPoint !== false && (i.entryPoint || orphan.has(sid(i.service, i.id)) || !!rpcServed(i))) // an RPC command can always be traced from (0.19.0)
    .map((i) => ({ service: i.service, id: i.id, bindKey: i.bindKey, transport: i.transport, handler: i.handler, ...(i.middleware?.length ? { middleware: i.middleware } : {}), ...(i.links ? { links: i.links } : {}), ...coverageField(i), ...externalField(g, i.service), entryPoint: !!i.entryPoint }));
}


/** #85: the list needs only the status and the count of `details.coverage` (the sites come with the trace). */
const coverageField = (i: Ingress) => { const c = coverageOf(i.details); return c ? { coverage: { ...(c.status ? { status: c.status } : {}), ...(c.blocked != null ? { blocked: c.blocked } : {}) } } : {}; };
