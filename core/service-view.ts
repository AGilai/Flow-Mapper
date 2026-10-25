// Service view data: one service's ingress (with callers), egress (with targets),
// resources (with operations), channels it declares, and its functions.

import type { GraphIndex } from './graph-index.ts';
import { downstreamIngress, itemsOf, sid, upstreamEgress } from './graph-index.ts';
import type { Ref } from './types.ts';
import { externalField } from './external.ts';
import { codeLink } from './endpoint-info.ts';
import { deliveriesBetween } from './event-pairs.ts';
import { egressVia, ingressVia } from './via.ts';
import { rpcOf, rpcServed, routeKey } from './amqp-route.ts';
import { bindingKeyOf, splitAmqpKey } from './amqp.ts';

const viaText = (via: Ref[]) => via.map((v) => (v.type === 'channel' ? v.key : '')).filter(Boolean);

export function serviceView(g: GraphIndex, name: string) {
  const s = g.services.get(name);
  if (!s) return null;
  const dangling = new Set(g.resolution.dangling.map((e) => sid(e.service, e.id)));
  const orphans = new Set(g.resolution.orphans.map((i) => sid(i.service, i.id)));
  const mine = itemsOf(g, name);
  const fns = mine.functions;

  const ingress = mine.ingress.map((i) => {
    const all = upstreamEgress(g, i).map((u) => {
      const e = u.egress;
      const mineD = deliveriesBetween(g, { service: e.service, egress: e.id }, { service: i.service, ingress: i.id });
      const gaps = (e.unresolved ?? []).filter((x) => x.what === 'event');
      const blind = gaps.some((x) => !x.candidates?.length); // an event type with no candidates: could be anything
      // Callers whose events the subscription filters out are dropped; unknown events are 'maybe'.
      const state = mineD.some((d) => !d.possible) ? 'yes' : mineD.length || blind ? 'maybe' : e.events?.length || gaps.length ? 'no' : 'yes';
      return { state, caller: { service: e.service, egress: e.id, bindKey: e.bindKey, transport: e.transport, via: viaText(u.via) } };
    });
    const rpc = rpcServed(i);
    const callers = all.filter((c) => c.state === 'yes').map((c) => c.caller);
    return {
      ...i,
      ...(rpc ? { rpc, noCaller: !callers.length } : {}), // an RPC command (0.19.0): a command nobody harvested calls is not a problem
      at: codeLink(s, i.source),
      via: ingressVia(s, i), // how the handler was resolved (registration / bind hops), with code links
      orphan: orphans.has(sid(i.service, i.id)) && !rpc && !externalField(g, name).external, // #87: an external service's endpoint is a target, not an orphan
      callers,
      maybeCallers: all.filter((c) => c.state === 'maybe').map((c) => c.caller),
    };
  });

  const egress = mine.egress.map((e) => {
    const gaps = (e.unresolved ?? []).filter((x) => x.what === 'event');
    const blind = gaps.some((x) => !x.candidates?.length);
    // Targets whose subscription filter rejects every event of this egress are dropped; unknown events are 'maybe'.
    const all = downstreamIngress(g, { type: 'egress', service: e.service, id: e.id }).map((d) => {
      const mineD = deliveriesBetween(g, { service: e.service, egress: e.id }, { service: d.ingress.service, ingress: d.ingress.id });
      const state = mineD.some((x) => !x.possible) ? 'yes' : mineD.length || blind ? 'maybe' : e.events?.length || gaps.length ? 'no' : 'yes';
      return { state, target: { service: d.ingress.service, ingress: d.ingress.id, bindKey: d.ingress.bindKey, handler: d.ingress.handler, via: viaText(d.via) } };
    });
    const rpc = rpcOf(e), ex = !rpc && e.transport === 'amqp' ? splitAmqpKey(e.bindKey) : null;
    const route = ex?.exchange ? routeKey(g.model.bindings, g.channels.get(`amqp:${ex.exchange}`)?.details, e.bindKey, e.details) : null; // a publish to an exchange: what it reaches
    return {
      ...e,
      ...(rpc ? { rpc } : {}),
      ...(route ? { amqp: { exchange: route.exchange, routingKey: route.routingKey ?? '', bindings: [...route.matched, ...route.possible].map((b) => bindingKeyOf(b)) } } : {}),
      ...egressVia(s, e), // normalised `via` and `callSites` (from fields or details), with code links
      at: codeLink(s, e.source),
      dangling: dangling.has(sid(e.service, e.id)),
      usedBy: fns.filter((f) => f.steps.some((st) => st.type === 'egress' && st.target === e.id)).map((f) => f.id),
      targets: all.filter((t) => t.state === 'yes').map((t) => t.target),
      maybeTargets: all.filter((t) => t.state === 'maybe').map((t) => t.target),
    };
  });

  const resources = mine.resources.map((r) => ({
    ...r,
    operations: fns.flatMap((f) =>
      f.steps.filter((st) => st.type === 'resource' && st.target === r.id).map((st) => ({ fn: f.id, operation: st.operation ?? 'use' }))),
    sharedWith: g.model.resources.filter((o) => o.bindKey && o.bindKey === r.bindKey && o.service !== name).map((o) => o.service),
  }));

  return {
    service: s,
    ...externalField(g, name),
    ingress,
    egress,
    resources,
    channels: mine.channels,
    bindings: mine.bindings,
    functions: fns.map((f) => ({ id: f.id, name: f.name, file: f.file, line: f.line, steps: f.steps.length, unresolved: f.unresolved ?? [] })),
  };
}
