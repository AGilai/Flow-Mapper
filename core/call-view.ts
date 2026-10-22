// What the call form reads before it opens: which steps use an egress and which endpoints it reaches, with the reference flag of each
// (an endpoint whose behaviour lives in another environment: editing the call changes the call only).

import type { GraphIndex } from './graph-index.ts';
import { downstreamIngress, sid } from './graph-index.ts';
import type { EnvRefs, RefEndpoint } from './references.ts';

export interface CallView {
  egress: { service: string; id: string; bindKey: string; transport: string; mode?: string };
  steps: { fn: string; seq: number; operation?: string; mark?: 'new' | 'changed' }[];
  targets: { service: string; ingress: string; bindKey: string; reference?: RefEndpoint }[];
}

export function callView(g: GraphIndex, refs: EnvRefs, service: string, egressId: string): CallView | null {
  const e = g.egress.get(sid(service, egressId));
  if (!e) return null;
  const steps = g.model.functions.filter((f) => f.service === service).flatMap((f) => f.steps
    .filter((s) => s.type === 'egress' && s.target === egressId).map((s) => ({ fn: f.id, seq: s.seq, ...(s.operation ? { operation: s.operation } : {}), ...(s.mark ? { mark: s.mark } : {}) })));
  const targets = downstreamIngress(g, { type: 'egress', service, id: egressId }).map(({ ingress: i }) => {
    const reference = refs.endpoints[`ing:${i.service}/${i.id}`];
    return { service: i.service, ingress: i.id, bindKey: i.bindKey, ...(reference ? { reference } : {}) };
  });
  return { egress: { service, id: e.id, bindKey: e.bindKey, transport: e.transport, ...(e.mode ? { mode: e.mode } : {}) }, steps, targets };
}
