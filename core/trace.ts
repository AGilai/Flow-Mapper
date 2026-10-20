// Flow tracing for the sequence view and the MCP `trace_flow` tool.
//
// scope 'intra': lifelines are the functions of the start service; anything outside is one lifeline
//                per service / channel / resource and is not expanded.
// expand       : services drawn as one lifeline per function in either scope (zoom in place).
// scope 'full' : lifelines are services, channels and resources; the flow is followed across
//                services through REST, queues and topics. Function calls inside a service are
//                kept as `internal` self-messages so the UI can show or hide them.
// Events: a publish step that names an event type (or an egress with only one) carries that type
// along; subscriptions that filter it out are not followed, and a consumer runs the handler for
// that type. A trace can also start from one event type at an ingress.

import type { GraphIndex } from './graph-index.ts';
import { linksFrom, sid } from './graph-index.ts';
import { isLeaf } from './types.ts';
import type { Mode, Ref } from './types.ts';
import { handlerFor, passes } from './events.ts';
import { codeLink, sourceLink, type SourceLink } from './endpoint-info.ts';
import { refKey, unresolvedTarget } from './resolve.ts';
import type { StepField, Unresolved } from './types.ts';
import { egressVia, ingressVia, type LinkedHop } from './via.ts';

export interface Participant {
  id: string; label: string; kind: 'client' | 'function' | 'service' | 'channel' | 'resource' | 'missing' | 'unresolved'; service?: string;
  /** Service lifelines: function calls inside that service on this trace (what expanding would show). */
  internalCalls?: number;
}
export interface Message {
  from: string; to: string; label: string; mode: Mode;
  kind: 'entry' | 'call' | 'egress' | 'deliver' | 'resource' | 'leaf' | 'frontier';
  depth: number; internal?: boolean; broken?: boolean; cycle?: boolean;
  condition?: string; loop?: boolean; note?: string; fn?: string; service?: string; transport?: string;
  event?: string; unhandled?: boolean;
  seq?: number;                                              // step number in the calling function
  target?: { service: string; ingress: string; fn?: string }; // ingress reached, and the handler that runs
  store?: string;                                            // data-store key, for resource steps
  fields?: StepField[];                                      // fields a resource step touches (role, path, operator, inDdl)
  calls?: string;                                            // function called, for call steps (same service)
  egress?: string;                                           // egress id, for calls out (its call site is in `code`)
  via?: LinkedHop[];                                         // wrappers the call goes through (last one calls the SDK); display only
  handlerVia?: LinkedHop[];                                  // how the ingress resolved to its handler (registration / bind hops); display only
  origin?: 'frontier';                                       // a step the harvester marked as frontier (shown because the trace was asked to expand them)
  frontierSteps?: number;                                    // on a kind 'frontier' marker: frontier steps folded into it (this function's and those of the frontier calls below it)
  gap?: Unresolved;                                          // the harvester could not resolve this call; why
  group?: string;                                            // SNS fan-out: id of the publish (`m<index of the publish message>`), on the publish and on each of its deliveries
  deliveries?: number;                                       // on the publish message of a fan-out: how many deliveries follow it
  delivery?: number;                                         // on the topic -> queue and queue -> consumer messages of one delivery: 1-based ordinal within the group
}
export interface Trace {
  start: { service: string; ingress?: string; fn: string; event?: string }; scope: 'intra' | 'full';
  participants: Participant[]; messages: Message[]; truncated: boolean;
  /** Code location of every function on the trace, by `${service}:${fn}`, of call sites, by `egress:${service}:${id}`, and of steps that carry a `source`, by `step:${service}:${fn}#${seq}`. */
  code: Record<string, SourceLink | null>;
}

export interface TraceOptions { scope?: 'intra' | 'full'; maxDepth?: number; maxMessages?: number; expand?: string[];
  /** Show steps marked `origin: 'frontier'`. Off by default: each function gets one collapsed marker and they do not count toward maxMessages. */
  frontier?: boolean }

export function trace(g: GraphIndex, start: { service: string; ingress?: string; fn?: string; event?: string }, opts: TraceOptions = {}): Trace | null {
  const scope = opts.scope ?? 'full';
  const maxDepth = opts.maxDepth ?? 25;
  const maxMessages = opts.maxMessages ?? 500;
  const expand = new Set(opts.expand ?? []);
  const showFrontier = !!opts.frontier;
  const ing = start.ingress ? g.ingress.get(sid(start.service, start.ingress)) : undefined;
  const fnId = start.fn ?? (ing && start.event ? handlerFor(ing, start.event) : ing?.handler);
  if (!fnId || !g.fns.get(sid(start.service, fnId))) return null;

  const participants = new Map<string, Participant>();
  const messages: Message[] = [];
  let truncated = false;
  const root = start.service;

  const part = (p: Participant) => { if (!participants.has(p.id)) participants.set(p.id, p); return p.id; };
  const fnPart = (service: string, fn: string) => {
    if ((scope === 'intra' && service === root) || expand.has(service)) {
      const f = g.fns.get(sid(service, fn));
      return part({ id: `fn:${service}:${fn}`, label: f?.name ?? fn, kind: 'function', service });
    }
    return part({ id: `svc:${service}`, label: service, kind: 'service', service });
  };
  const chPart = (key: string) => part({ id: `ch:${key}`, label: g.channels.get(key)?.name ?? key, kind: 'channel' });
  // The same subscription declared twice (by the topic's owner and by the consumer) is one link, one arrow.
  const distinct = <T extends { to: Ref }>(ls: T[]) => ls.filter((l, i) => ls.findIndex((o) => refKey(o.to) === refKey(l.to)) === i);
  let counted = 0; // messages that count toward maxMessages: everything but the folded frontier markers
  const push = (m: Message) => {
    if (m.kind === 'frontier') { messages.push(m); return true; } // markers are free, as documented on TraceOptions.frontier
    if (counted >= maxMessages) { truncated = true; return false; }
    counted++;
    messages.push(m);
    return true;
  };

  // Frontier steps below a function: its own, plus those of the functions its frontier calls reach (each counted once).
  const frontierCount = (service: string, fn: string) => {
    const seen = new Set<string>();
    const walk = (k: string): number => {
      if (seen.has(k)) return 0;
      seen.add(k);
      let n = 0;
      for (const st of g.fns.get(k)?.steps ?? []) {
        if (st.origin !== 'frontier') continue;
        n++;
        if (st.type === 'call' && st.target) n += walk(sid(service, st.target));
      }
      return n;
    };
    return walk(sid(service, fn));
  };

  const visitFn = (service: string, fn: string, depth: number, stack: string[]) => {
    const f = g.fns.get(sid(service, fn));
    if (!f) return;
    const me = fnPart(service, fn);
    let folded = false;
    for (const st of [...f.steps].sort((a, b) => a.seq - b.seq)) {
      if (truncated) return;
      if (st.origin === 'frontier' && !showFrontier) {
        if (!folded) { // one marker per function, where its first frontier step would be
          folded = true;
          push({ from: me, to: me, label: `frontier: ${frontierCount(service, fn)} steps`, mode: 'sync', kind: 'frontier', depth, service, fn: f.id, seq: st.seq, frontierSteps: frontierCount(service, fn) });
        }
        continue;
      }
      const base = { depth, condition: st.condition, loop: st.loop, note: st.note, fn: f.id, service, seq: st.seq, ...(st.origin === 'frontier' ? { origin: 'frontier' as const } : {}) };
      // A gap the harvester reported: the step's own target, or the egress it goes through, is unresolved.
      const out = st.type === 'egress' && st.target ? g.egress.get(sid(service, st.target)) : undefined;
      const gap = (!st.target ? st.unresolved?.find((u) => u.what === 'target') : undefined) ?? (out ? unresolvedTarget(out) : undefined);
      if (gap) {
        const to = part({ id: `gap:${gap.reason}`, label: `unresolved: ${gap.reason}`, kind: 'unresolved' });
        push({ ...base, from: me, to, label: gap.detail ?? st.operation ?? gap.reason, mode: st.mode ?? 'sync', kind: st.type === 'resource' ? 'resource' : st.type === 'call' ? 'call' : 'egress', gap, egress: out?.id, transport: out?.transport });
        continue;
      }
      if (!st.target) {
        // A classified leaf (db access, external package…): shown as a note on the function, never a gap.
        if (isLeaf(st)) push({ ...base, from: me, to: me, label: st.operation && st.note ? `${st.operation} · ${st.note}` : st.operation ?? st.note ?? 'leaf', mode: st.mode ?? 'sync', kind: 'leaf' });
        continue;
      }
      if (st.type === 'call') {
        const key = sid(service, st.target);
        const cycle = stack.includes(key);
        const target = g.fns.get(key);
        if (!push({ ...base, from: me, to: fnPart(service, st.target), label: target?.name ?? st.target, mode: st.mode ?? 'sync', kind: 'call', internal: true, cycle, calls: st.target })) return;
        if (!cycle && depth < maxDepth) visitFn(service, st.target, depth + 1, [...stack, key]);
      } else if (st.type === 'resource') {
        const r = g.resources.get(sid(service, st.target));
        const to = part({ id: `res:${r?.bindKey ?? sid(service, st.target)}`, label: r?.name ?? st.target, kind: 'resource' });
        push({ ...base, from: me, to, label: st.operation ?? 'use', mode: st.mode ?? 'sync', kind: 'resource', transport: 'res', store: r?.bindKey ?? sid(service, st.target), ...(st.fields?.length ? { fields: st.fields } : {}) });
      } else {
        const e = g.egress.get(sid(service, st.target));
        if (!e) continue;
        const mode = st.mode ?? e.mode ?? 'sync';
        const event = st.event ?? (e.events?.length === 1 ? e.events[0] : undefined);
        const label = (st.operation && !e.bindKey.includes(st.operation) ? `${st.operation} ${e.bindKey}` : e.bindKey) + (event ? ` · ${event}` : '');
        const all = distinct(linksFrom(g, { type: 'egress', service, id: e.id }).filter((l) => passes(g, l, event)));
        // A send to a queue that an ingress consumes matches that ingress by key and also goes through the queue: draw the queue path only.
        const viaChannel = new Set<string>();
        const reach = (r: Ref, seen: string[]) => {
          for (const l of distinct(linksFrom(g, r).filter((x) => passes(g, x, event)))) {
            if (l.to.type === 'ingress') viaChannel.add(refKey(l.to));
            else if (!seen.includes(l.to.key)) reach(l.to, [...seen, l.to.key]);
          }
        };
        for (const l of all) if (l.to.type === 'channel') reach(l.to, [l.to.key]);
        const links = all.filter((l) => l.to.type !== 'ingress' || !viaChannel.has(refKey(l.to)));
        if (!links.length) {
          const to = part({ id: `missing:${e.bindKey}`, label: e.bindKey, kind: 'missing' });
          push({ ...base, from: me, to, label, mode, kind: 'egress', broken: true, transport: e.transport, egress: e.id });
          continue;
        }
        for (const l of links) follow(me, l.to, label, mode, depth, stack, { ...base, transport: e.transport, event, egress: e.id });
      }
    }
  };

  // Deliver from `from` to a link target, expanding channels and crossing into other services.
  const follow = (from: string, to: Ref, label: string, mode: Mode, depth: number, stack: string[], base: Partial<Message>, seenCh: string[] = []) => {
    if (truncated) return;
    if (to.type === 'channel') {
      const ch = chPart(to.key);
      if (!push({ ...base, from, to: ch, label, mode, kind: 'egress', depth } as Message)) return;
      if (scope === 'intra' || seenCh.includes(to.key)) return; // intra stops at the service boundary
      const next = distinct(linksFrom(g, to).filter((l) => passes(g, l, base.event)));
      if (!next.length) return;
      // A publish that reaches several links is a fan-out: the publish carries a group id, each delivery an ordinal.
      const group = next.length > 1 ? `m${messages.length - 1}` : undefined;
      if (group) Object.assign(messages[messages.length - 1], { group, deliveries: next.length });
      const { deliveries: _n, ...inherited } = base; // a delivery's ordinal rides along to its queue -> consumer message; an inner fan-out replaces it
      next.forEach((l, k) => follow(ch, l.to, to.key + (base.event ? ` · ${base.event}` : ''), 'async', depth, stack,
        { ...inherited, transport: l.transport, ...(group ? { group, delivery: k + 1 } : {}) }, [...seenCh, to.key]));
      return;
    }
    if (to.type !== 'ingress') return;
    const i = g.ingress.get(sid(to.service, to.id));
    if (!i) return;
    const crossing = from.startsWith('ch:') ? 'deliver' : 'egress';
    const handler = base.event ? handlerFor(i, base.event) : i.handler;
    if (!handler) {
      // The event reaches a consumer that lists event types but has no handler for this one.
      push({ ...base, from, to: part({ id: `svc:${i.service}`, label: i.service, kind: 'service', service: i.service }),
        label: `${label} → no handler`, mode, kind: crossing, depth, broken: true, unhandled: true, target: { service: i.service, ingress: i.id } } as Message);
      return;
    }
    const target = scope === 'intra' && i.service !== root
      ? part({ id: `svc:${i.service}`, label: i.service, kind: 'service', service: i.service })
      : fnPart(i.service, handler);
    if (!push({ ...base, from, to: target, label: crossing === 'deliver' ? `${label} → ${handler}` : label, mode, kind: crossing, depth, target: { service: i.service, ingress: i.id, fn: handler } } as Message)) return;
    const key = sid(i.service, handler);
    if (scope === 'intra' && i.service !== root) return;
    if (stack.includes(key)) { messages[messages.length - 1].cycle = true; return; }
    if (depth < maxDepth) visitFn(i.service, handler, depth + 1, [...stack, key]);
  };

  const client = part({ id: 'client', label: ing?.entryPoint ? 'client' : 'caller', kind: 'client' });
  push({ from: client, to: fnPart(root, fnId), label: (ing?.bindKey ?? fnId) + (start.event ? ` · ${start.event}` : ''), event: start.event, mode: 'sync', kind: 'entry', depth: 0, service: root, fn: fnId, transport: ing?.transport, target: ing ? { service: root, ingress: ing.id, fn: fnId } : undefined });
  visitFn(root, fnId, 1, [sid(root, fnId)]);

  for (const p of participants.values()) {
    if (p.kind === 'service') p.internalCalls = messages.filter((m) => m.kind === 'call' && m.service === p.service).length;
  }
  const code: Trace['code'] = {};
  for (const m of messages) {
    for (const [svc, fn] of [[m.service, m.fn], [m.target?.service, m.target?.fn], [m.service, m.calls]]) {
      const k = svc && fn ? sid(svc, fn) : null;
      if (k && !(k in code)) code[k] = g.services.has(svc!) ? sourceLink(g.services.get(svc!)!, g.fns.get(k) ?? null) : null;
    }
    const stepSrc = m.service && m.fn && m.seq ? g.fns.get(sid(m.service, m.fn))?.steps.find((s) => s.seq === m.seq)?.source : undefined;
    if (stepSrc && g.services.has(m.service!)) code[`step:${m.service}:${m.fn}#${m.seq}`] = codeLink(g.services.get(m.service!)!, stepSrc);
    const ti = m.target ? g.ingress.get(sid(m.target.service, m.target.ingress)) : undefined;
    if (ti && m.target?.fn && g.services.has(ti.service)) { const hv = ingressVia(g.services.get(ti.service)!, ti); if (hv.length) m.handlerVia = hv; }
    const e = m.egress && m.service ? g.egress.get(sid(m.service, m.egress)) : undefined;
    if (e && m.kind === 'egress' && !String(m.from).startsWith('ch:')) { // the call itself, not a hop between channels
      const v = egressVia(g.services.get(m.service!)!, e);
      const via = v.callSites.find((c) => c.function && c.function === m.fn && c.via.length)?.via ?? v.via;
      if (via.length) m.via = via;
    }
    if (e?.source && !(`egress:${m.service}:${e.id}` in code)) code[`egress:${m.service}:${e.id}`] = codeLink(g.services.get(m.service!)!, e.source);
  }
  return { code, start: { service: root, ingress: ing?.id, fn: fnId, event: start.event }, scope, participants: deliveryOrder([...participants.values()], messages), messages, truncated };
}

/** Entry points to start a trace from: ingress marked entryPoint, else ingress nothing reaches. */
export function entryPoints(g: GraphIndex) {
  const orphan = new Set(g.resolution.orphans.map((i) => sid(i.service, i.id)));
  return g.model.ingress
    .filter((i) => i.entryPoint || orphan.has(sid(i.service, i.id)))
    .map((i) => ({ service: i.service, id: i.id, bindKey: i.bindKey, transport: i.transport, handler: i.handler, entryPoint: !!i.entryPoint }));
}

/**
 * Lifelines in delivery order: a topic or queue sits left of whatever it delivers to, so a delivery
 * arrow never points backwards. A channel that is right of its target moves to just before it.
 */
function deliveryOrder(parts: Participant[], messages: Message[]): Participant[] {
  const order = [...parts];
  for (let pass = 0, moved = true; moved && pass < 10; pass++) { // a topic may have to move again after its queue did
    moved = false;
    for (const m of messages) {
      if (!m.from.startsWith('ch:') || m.from === m.to) continue;
      const a = order.findIndex((p) => p.id === m.from), b = order.findIndex((p) => p.id === m.to);
      if (a < 0 || b < 0 || a < b) continue;
      const [ch] = order.splice(a, 1);
      order.splice(b, 0, ch);
      moved = true;
    }
  }
  // A channel a service sends to sits right of that sender (and a queue right of the topic that feeds it), so the
  // publish arrow points right: producer -> topic -> queue. Only moves what is backwards; a consumer further left
  // (a loop back to an earlier service) stays where it is.
  for (const m of messages) {
    if (!m.to.startsWith('ch:') || m.from === m.to) continue;
    const a = order.findIndex((p) => p.id === m.from), b = order.findIndex((p) => p.id === m.to);
    if (a < 0 || b < 0 || b > a) continue;
    const [ch] = order.splice(b, 1);
    order.splice(a, 0, ch); // the sender moved one place left when the channel was taken out
  }
  return order;
}
