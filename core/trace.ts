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
import type { Mode, Ref } from './types.ts';
import { handlerFor, passes } from './events.ts';
import { sourceLink, type SourceLink } from './endpoint-info.ts';

export interface Participant {
  id: string; label: string; kind: 'client' | 'function' | 'service' | 'channel' | 'resource' | 'missing'; service?: string;
  /** Service lifelines: function calls inside that service on this trace (what expanding would show). */
  internalCalls?: number;
}
export interface Message {
  from: string; to: string; label: string; mode: Mode;
  kind: 'entry' | 'call' | 'egress' | 'deliver' | 'resource';
  depth: number; internal?: boolean; broken?: boolean; cycle?: boolean;
  condition?: string; loop?: boolean; note?: string; fn?: string; service?: string; transport?: string;
  event?: string; unhandled?: boolean;
  seq?: number;                                              // step number in the calling function
  target?: { service: string; ingress: string; fn?: string }; // ingress reached, and the handler that runs
  store?: string;                                            // data-store key, for resource steps
  calls?: string;                                            // function called, for call steps (same service)
}
export interface Trace {
  start: { service: string; ingress?: string; fn: string; event?: string }; scope: 'intra' | 'full';
  participants: Participant[]; messages: Message[]; truncated: boolean;
  /** Code location of every function on the trace, by `${service}:${fn}`. */
  code: Record<string, SourceLink | null>;
}

export interface TraceOptions { scope?: 'intra' | 'full'; maxDepth?: number; maxMessages?: number; expand?: string[] }

export function trace(g: GraphIndex, start: { service: string; ingress?: string; fn?: string; event?: string }, opts: TraceOptions = {}): Trace | null {
  const scope = opts.scope ?? 'full';
  const maxDepth = opts.maxDepth ?? 25;
  const maxMessages = opts.maxMessages ?? 500;
  const expand = new Set(opts.expand ?? []);
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
  const push = (m: Message) => {
    if (messages.length >= maxMessages) { truncated = true; return false; }
    messages.push(m);
    return true;
  };

  const visitFn = (service: string, fn: string, depth: number, stack: string[]) => {
    const f = g.fns.get(sid(service, fn));
    if (!f) return;
    const me = fnPart(service, fn);
    for (const st of [...f.steps].sort((a, b) => a.seq - b.seq)) {
      if (truncated) return;
      const base = { depth, condition: st.condition, loop: st.loop, note: st.note, fn: f.id, service, seq: st.seq };
      if (st.type === 'call') {
        const key = sid(service, st.target);
        const cycle = stack.includes(key);
        const target = g.fns.get(key);
        if (!push({ ...base, from: me, to: fnPart(service, st.target), label: target?.name ?? st.target, mode: st.mode ?? 'sync', kind: 'call', internal: true, cycle, calls: st.target })) return;
        if (!cycle && depth < maxDepth) visitFn(service, st.target, depth + 1, [...stack, key]);
      } else if (st.type === 'resource') {
        const r = g.resources.get(sid(service, st.target));
        const to = part({ id: `res:${r?.bindKey ?? sid(service, st.target)}`, label: r?.name ?? st.target, kind: 'resource' });
        push({ ...base, from: me, to, label: st.operation ?? 'use', mode: st.mode ?? 'sync', kind: 'resource', transport: 'res', store: r?.bindKey ?? sid(service, st.target) });
      } else {
        const e = g.egress.get(sid(service, st.target));
        if (!e) continue;
        const mode = st.mode ?? e.mode ?? 'sync';
        const event = st.event ?? (e.events?.length === 1 ? e.events[0] : undefined);
        const label = (st.operation && !e.bindKey.includes(st.operation) ? `${st.operation} ${e.bindKey}` : e.bindKey) + (event ? ` · ${event}` : '');
        const links = linksFrom(g, { type: 'egress', service, id: e.id }).filter((l) => passes(g, l, event));
        if (!links.length) {
          const to = part({ id: `missing:${e.bindKey}`, label: e.bindKey, kind: 'missing' });
          push({ ...base, from: me, to, label, mode, kind: 'egress', broken: true, transport: e.transport });
          continue;
        }
        for (const l of links) follow(me, l.to, label, mode, depth, stack, { ...base, transport: e.transport, event });
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
      const next = linksFrom(g, to).filter((l) => passes(g, l, base.event));
      if (!next.length) return;
      for (const l of next) follow(ch, l.to, to.key + (base.event ? ` · ${base.event}` : ''), 'async', depth, stack, { ...base, transport: l.transport }, [...seenCh, to.key]);
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
  }
  return { code, start: { service: root, ingress: ing?.id, fn: fnId, event: start.event }, scope, participants: [...participants.values()], messages, truncated };
}

/** Entry points to start a trace from: ingress marked entryPoint, else ingress nothing reaches. */
export function entryPoints(g: GraphIndex) {
  const orphan = new Set(g.resolution.orphans.map((i) => sid(i.service, i.id)));
  return g.model.ingress
    .filter((i) => i.entryPoint || orphan.has(sid(i.service, i.id)))
    .map((i) => ({ service: i.service, id: i.id, bindKey: i.bindKey, transport: i.transport, handler: i.handler, entryPoint: !!i.entryPoint }));
}
