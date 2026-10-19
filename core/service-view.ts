// Service view data: one service's ingress (with callers), egress (with targets),
// resources (with operations), channels it declares, and its functions.

import type { GraphIndex } from './graph-index.ts';
import { downstreamIngress, sid, upstreamEgress } from './graph-index.ts';
import type { Ref } from './types.ts';
import { codeLink } from './endpoint-info.ts';
import { eventReport } from './events.ts';

const viaText = (via: Ref[]) => via.map((v) => (v.type === 'channel' ? v.key : '')).filter(Boolean);

export function serviceView(g: GraphIndex, name: string) {
  const s = g.services.get(name);
  if (!s) return null;
  const mine = <T extends { service: string }>(xs: T[]) => xs.filter((x) => x.service === name);
  const dangling = new Set(g.resolution.dangling.map((e) => sid(e.service, e.id)));
  const orphans = new Set(g.resolution.orphans.map((i) => sid(i.service, i.id)));
  const fns = mine(g.model.functions);

  const deliveries = eventReport(g).deliveries;
  const ingress = mine(g.model.ingress).map((i) => {
    const all = upstreamEgress(g, i).map((u) => {
      const e = u.egress;
      const mineD = deliveries.filter((d) => d.producer.service === e.service && d.producer.egress === e.id && d.consumer.service === i.service && d.consumer.ingress === i.id);
      const gaps = (e.unresolved ?? []).filter((x) => x.what === 'event');
      const blind = gaps.some((x) => !x.candidates?.length); // an event type with no candidates: could be anything
      // Callers whose events the subscription filters out are dropped; unknown events are 'maybe'.
      const state = mineD.some((d) => !d.possible) ? 'yes' : mineD.length || blind ? 'maybe' : e.events?.length || gaps.length ? 'no' : 'yes';
      return { state, caller: { service: e.service, egress: e.id, bindKey: e.bindKey, transport: e.transport, via: viaText(u.via) } };
    });
    return {
      ...i,
      at: codeLink(s, i.source),
      orphan: orphans.has(sid(i.service, i.id)),
      callers: all.filter((c) => c.state === 'yes').map((c) => c.caller),
      maybeCallers: all.filter((c) => c.state === 'maybe').map((c) => c.caller),
    };
  });

  const egress = mine(g.model.egress).map((e) => ({
    ...e,
    at: codeLink(s, e.source),
    dangling: dangling.has(sid(e.service, e.id)),
    usedBy: fns.filter((f) => f.steps.some((st) => st.type === 'egress' && st.target === e.id)).map((f) => f.id),
    targets: downstreamIngress(g, { type: 'egress', service: e.service, id: e.id }).map((d) => ({
      service: d.ingress.service, ingress: d.ingress.id, bindKey: d.ingress.bindKey, handler: d.ingress.handler, via: viaText(d.via),
    })),
  }));

  const resources = mine(g.model.resources).map((r) => ({
    ...r,
    operations: fns.flatMap((f) =>
      f.steps.filter((st) => st.type === 'resource' && st.target === r.id).map((st) => ({ fn: f.id, operation: st.operation ?? 'use' }))),
    sharedWith: g.model.resources.filter((o) => o.bindKey && o.bindKey === r.bindKey && o.service !== name).map((o) => o.service),
  }));

  return {
    service: s,
    ingress,
    egress,
    resources,
    channels: mine(g.model.channels),
    bindings: mine(g.model.bindings),
    functions: fns.map((f) => ({ id: f.id, name: f.name, file: f.file, line: f.line, steps: f.steps.length })),
  };
}
