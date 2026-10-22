// REFERENCE: the O(egress x ingress) resolver as it was before 0.38.2 (perf F1). Kept only so tests/resolve-equal.test.ts can compare.
//
// Hops:
//   egress  → ingress   (key or pattern match on the ingress)
//   egress  → channel   (egress key equals a declared channel key)
//   egress  → target    (binding whose `from` matches the egress key, when no channel has that key)
//   channel → target    (binding whose `from` matches the channel key)
//   channel → ingress   (queue consumed by an ingress with a matching key)
// A binding target is a declared channel if one has that key, otherwise matching ingress.

import type { Binding, Channel, Delivery, Egress, Mode, Ingress, Link, Model, Ref, Resolution, Transport, Unresolved } from '../core/types.ts';
import { compareSpecificity, keyMatches, specificity } from '../core/glob.ts';
import { routeKey, rpcServed } from '../core/amqp-route.ts';

export const DEFAULT_DELIVERY: Record<string, Delivery> = {
  http: 'unicast', rpc: 'unicast', grpc: 'unicast', sqs: 'unicast', sns: 'multicast', amqp: 'multicast', eventbridge: 'multicast',
};

/** The harvester could not resolve this item's target (call target or consumed key); it takes no part in matching. */
export const unresolvedTarget = (x: { unresolved?: Unresolved[] }) => x.unresolved?.find((u) => u.what === 'target');

/** A socket ingress has no producer inside the system, so it is an entry point unless the harvester says `entryPoint: false`. */
const socketEntry = (i: Ingress): Ingress => (i.transport === 'socket' && i.entryPoint === undefined ? { ...i, entryPoint: true } : i);

/** Unresolved items may come without a bind key; give them a readable placeholder that matches nothing. */
export function withPlaceholderKeys(model: Model): Model {
  const fill = <T extends { bindKey?: string; unresolved?: Unresolved[] }>(x: T): T =>
    (x.bindKey ? x : { ...x, bindKey: `unresolved:${unresolvedTarget(x)?.reason ?? 'unknown'}` });
  return { ...model, ingress: model.ingress.map(fill).map(socketEntry), egress: model.egress.map(fill) };
}

/** Request/reply transports: calls are synchronous unless the egress says otherwise (an undecided transport reads as a plain call). */
export const SYNC = new Set<Transport>(['http', 'rpc', 'grpc', 'undecided']);

/** A sync call over AMQP (an RPC) goes to one server; a publish goes to every matching binding. */
/** An RPC over AMQP: sync amqp with an `amqp-rpc:` key or `details.rpc`. */
const isRpcEgress = (e: { transport: Transport; mode?: Mode; bindKey?: string; details?: Record<string, unknown> }) =>
  e.transport === 'amqp' && e.mode === 'sync' && (!!e.details?.rpc || String(e.bindKey ?? '').startsWith('amqp-rpc:'));
export const deliveryOf = (e: { delivery?: Delivery; transport: Transport; mode?: Mode; bindKey?: string; details?: Record<string, unknown> }): Delivery =>
  e.delivery ?? (isRpcEgress(e) ? 'unicast' : DEFAULT_DELIVERY[e.transport]) ?? 'unicast';

export const refKey = (r: Ref): string =>
  r.type === 'channel' ? `channel|${r.key}` : `${r.type}|${r.service}|${r.id}`;

const ingressRef = (i: Ingress): Ref => ({ type: 'ingress', service: i.service, id: i.id });
const channelTransport = (c: Channel): Transport =>
  c.kind === 'sns-topic' ? 'sns' : c.kind === 'sqs-queue' ? 'sqs' : c.kind.startsWith('amqp') ? 'amqp' : c.kind === 'eventbridge-bus' ? 'eventbridge' : 'other';

/** Merge channel declarations that share a key (several manifests may declare the same topic). */
export function mergedChannels(model: Model): Map<string, Channel> {
  const out = new Map<string, Channel>();
  for (const c of model.channels) {
    const prev = out.get(c.bindKey);
    out.set(c.bindKey, prev ? { ...c, ...prev, details: { ...c.details, ...prev.details } } : c);
  }
  return out;
}

export function resolve(model: Model): Resolution {
  const channels = mergedChannels(model);
  const consumers = model.ingress.filter((i) => !unresolvedTarget(i));
  const links: Link[] = [];
  const ambiguous: Resolution['ambiguous'] = [];
  const brokenBindings: Binding[] = [];

  const matchIngress = (key: string, delivery: Delivery) => {
    const cands = consumers.filter((i) => keyMatches(i.bindKey, i.match, key));
    if (delivery === 'multicast' || cands.length <= 1) return { picked: cands, tied: [] as Ingress[] };
    const ranked = cands
      .map((c) => ({ c, s: specificity(c.bindKey, c.match) }))
      .sort((a, b) => compareSpecificity(b.s, a.s));
    const tied = ranked.filter((r) => compareSpecificity(r.s, ranked[0].s) === 0).map((r) => r.c);
    return { picked: [ranked[0].c], tied: tied.length > 1 ? tied : [] };
  };

  // A publish to an AMQP exchange is routed by the exchange's type (core/amqp-route.ts); other keys match bindings by their own `match`.
  const bindingsFrom = (key: string, e?: Egress) => {
    const r = e ? routeKey(model.bindings, channels.get(`amqp:${key.slice(5).split('/')[0]}`)?.details, key, e.details) : null;
    return r ? [...r.matched, ...r.possible] : model.bindings.filter((b) => keyMatches(b.from, b.match, key));
  };

  // Binding target → refs
  const targetsOfBinding = new Map<Binding, Ref[]>();
  for (const b of model.bindings) {
    const ch = channels.get(b.to);
    const refs: Ref[] = ch ? [{ type: 'channel', key: b.to }] : consumers.filter((i) => keyMatches(i.bindKey, i.match, b.to)).map(ingressRef);
    targetsOfBinding.set(b, refs);
    if (!refs.length) brokenBindings.push(b);
  }

  const addBindingLinks = (from: Ref, key: string, mode: Link['mode'], transport: Transport, e?: Egress) => {
    const bs = bindingsFrom(key, e);
    for (const b of bs) for (const to of targetsOfBinding.get(b)!) links.push({ from, to, via: 'binding', mode, transport, binding: { service: b.service, id: b.id } });
    return bs.length;
  };

  for (const e of model.egress) {
    if (unresolvedTarget(e)) continue; // reported as unresolved, with the harvester's reason
    const from: Ref = { type: 'egress', service: e.service, id: e.id };
    const mode = e.mode ?? (SYNC.has(e.transport) ? 'sync' : 'async');
    const { picked, tied } = matchIngress(e.bindKey, deliveryOf(e));
    if (tied.length) ambiguous.push({ egress: e, candidates: tied });
    for (const i of picked) links.push({ from, to: ingressRef(i), via: i.match && i.match !== 'exact' ? 'pattern' : 'key', mode, transport: e.transport });
    if (channels.has(e.bindKey)) links.push({ from, to: { type: 'channel', key: e.bindKey }, via: 'key', mode, transport: e.transport });
    else addBindingLinks(from, e.bindKey, mode, e.transport, e);
  }

  for (const [key, c] of channels) {
    const from: Ref = { type: 'channel', key };
    const t = channelTransport(c);
    addBindingLinks(from, key, 'async', t);
    if (c.kind === 'sqs-queue' || c.kind === 'amqp-queue') {
      for (const i of consumers.filter((i) => keyMatches(i.bindKey, i.match, key)))
        links.push({ from, to: ingressRef(i), via: i.match && i.match !== 'exact' ? 'pattern' : 'key', mode: 'async', transport: t });
    }
  }

  // Reachability: which ingress does each egress eventually reach?
  const out = new Map<string, Ref[]>();
  for (const l of links) {
    const k = refKey(l.from);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(l.to);
  }
  const reached = new Set<string>();
  const reachesIngress = (start: Ref): boolean => {
    const seen = new Set<string>();
    const stack = [start];
    let found = false;
    while (stack.length) {
      const r = stack.pop()!;
      const k = refKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      if (r.type === 'ingress') { reached.add(k); found = true; continue; }
      for (const n of out.get(k) ?? []) stack.push(n);
    }
    return found;
  };
  const dangling = model.egress.filter((e) => !unresolvedTarget(e) && !reachesIngress({ type: 'egress', service: e.service, id: e.id }));
  for (const [key] of channels) reachesIngress({ type: 'channel', key });
  for (const b of model.bindings) for (const r of targetsOfBinding.get(b)!) if (r.type === 'ingress') reached.add(refKey(r));

  const orphans = consumers.filter((i) => !i.entryPoint && !rpcServed(i) && !reached.has(refKey(ingressRef(i))));

  const unbound: Resolution['unbound'] = [];
  for (const [key, c] of channels) {
    if (c.kind === 'sns-topic' && !bindingsFrom(key).length) unbound.push({ channel: c, reason: 'topic has no subscription' });
    if (c.kind === 'eventbridge-bus' && !bindingsFrom(key).length) unbound.push({ channel: c, reason: 'bus has no rule' });
    // an RPC command or reply queue is read by the RPC library, not by an ingress of its own: its commands are `amqp-rpc:` ingress
    if ((c.kind === 'sqs-queue' || c.kind === 'amqp-queue') && !String(c.details?.role).startsWith('rpc-') && !consumers.some((i) => keyMatches(i.bindKey, i.match, key)))
      unbound.push({ channel: c, reason: 'queue has no consumer' });
    if (c.kind === 'amqp-exchange' && !model.bindings.some((b) => b.from === key || b.from.startsWith(key + '/')))
      unbound.push({ channel: c, reason: 'exchange has no binding' });
  }

  return { links, dangling, orphans, unbound, brokenBindings, ambiguous };
}
