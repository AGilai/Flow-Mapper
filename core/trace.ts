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
// that type. A publish that names no event uses the egress's events and candidates: only matching subscriptions
// are followed (candidate-only ones are `possible`); with none known it stops at the topic (#40). A step with `eventFrom` takes its event from the nearest enclosing call step's `bind` on the path (#42); unbound it is such an untyped publish. A trace can also start from one event type at an ingress.

import type { GraphIndex } from './graph-index.ts';
import { linksFrom, sid } from './graph-index.ts';
import { isLeaf } from './types.ts';
import type { Ingress, Link, Mode, Ref } from './types.ts';
import { handlerFor, passes, passesUntyped, untypedEventSet, type EventSet } from './events.ts';
import { emptyFlow } from './entry-points.ts';
export { entryPoints } from './entry-points.ts';
import { codeLink, sourceLink, type SourceLink } from './endpoint-info.ts';
import { refKey, unresolvedTarget } from './resolve.ts';
import { assumedOn, storeOn, unknownOn } from './step-notes.ts';
import type { Step, StepAlternative, StepFix, StepField, Unresolved } from './types.ts';
import { stepExtras } from './step-marks.ts';
import { altCtxOf, altGroups, type Alt, type AltCtx } from './alt.ts';
import { egressVia, ingressVia, type LinkedHop } from './via.ts';
import { bindingKeyOf, splitAmqpKey } from './amqp.ts';
import { routeInfo, routeKey, rpcOf, rpcServed, withServer, type AmqpRoute, type RpcInfo } from './amqp-route.ts';
import { deferHelpers } from './trace-defer.ts';
import { fanOutOrder } from './trace-order.ts';
import { withAltDecisions } from './alt-decisions.ts'; import { altIndex, armChain, covers, enterStep, newBook, NO_ARMS, withDecisions, type ArmState } from './alternatives.ts';

export type { Participant, Message, HopFilter, Trace, TraceOptions } from './trace-types.ts';
import type { Message, Participant, HopFilter, Trace, TraceOptions } from './trace-types.ts';

export function trace(g: GraphIndex, start: { service: string; ingress?: string; fn?: string; event?: string }, opts: TraceOptions = {}): Trace | null {
  const scope = opts.scope ?? 'full';
  const maxDepth = opts.maxDepth ?? 25;
  const maxMessages = opts.maxMessages ?? 500;
  const expand = new Set(opts.expand ?? []);
  const showFrontier = !!opts.frontier;
  const ing = start.ingress ? g.ingress.get(sid(start.service, start.ingress)) : undefined;
  const fnId = start.fn ?? (ing && start.event ? handlerFor(ing, start.event) : ing?.handler);
  if (ing && !start.fn && !fnId) return emptyFlow(start.service, ing, scope, start.event); // no handler named (for this event): an empty flow, not a 404
  if (!fnId || !g.fns.get(sid(start.service, fnId))) return null;

  const participants = new Map<string, Participant>();
  const messages: Message[] = [];
  let truncated = false;
  const root = start.service;

  const expanded = new Map<string, { n: number; path: string[] }[]>(); // deliveries expanded so far (consumer, ingress, handler, event) -> step number of the first and the arms it sat in (#43; 0.37.0: a later one reuses it only inside the same arms)
  const altIx = altIndex(g), book = newBook(), armCtxs = new Map<string, AltCtx>(); // 0.37.0 (#82): the either/or index (null: none), what the decisions need, the maxMessages tally per group
  let arms: ArmState = NO_ARMS, pushed = 0;
  const part = (p: Participant) => { if (!participants.has(p.id)) participants.set(p.id, p); return p.id; };
  const fnPart = (service: string, fn: string) => {
    if ((scope === 'intra' && service === root) || expand.has(service)) {
      const f = g.fns.get(sid(service, fn));
      return part({ id: `fn:${service}:${fn}`, label: f?.name ?? fn, kind: 'function', service });
    }
    return part({ id: `svc:${service}`, label: service, kind: 'service', service });
  };
  // Event types of an untyped publish that a subscription's own filter lets through (none for a catch-all: it says nothing).
  const matchedTypes = (l: Parameters<typeof passes>[1], set: EventSet): string[] => {
    const b = l.binding ? g.bindings.get(sid(l.binding.service, l.binding.id)) : undefined;
    if (!b?.events || b.events === '*') return [];
    return [...set.known, ...set.candidates].filter((t) => passes(g, l, t));
  };
  const filterOf = (l: Parameters<typeof passes>[1]): { filter: HopFilter } | {} => {
    const b = l.binding ? g.bindings.get(sid(l.binding.service, l.binding.id)) : undefined;
    return b ? { filter: { id: b.id, service: b.service, from: b.from, ...(b.events ? { events: b.events } : {}), ...(b.from.startsWith('amqp:') ? { bindingKey: bindingKeyOf(b), ...(b.match ? { match: b.match } : {}), ...(b.details?.headers ? { headers: b.details.headers as Record<string, unknown>, xMatch: b.details.xMatch === 'any' ? 'any' : 'all' } : {}) } : {}) } } : {};
  };
  const chPart = (key: string) => part({ id: `ch:${key}`, label: g.channels.get(key)?.name ?? key, kind: 'channel' });
  // The same subscription declared twice (by the topic's owner and by the consumer) is one link, one arrow.
  const distinct = <T extends { to: Ref }>(ls: T[]) => ls.filter((l, i) => ls.findIndex((o) => refKey(o.to) === refKey(l.to)) === i);
  let counted = 0; // messages that count toward maxMessages: everything but the folded frontier markers
  // Alternatives are not sequential load (#41): inside an alt group each branch keeps its own tally and only
  // the largest branch counts (toward the enclosing branch, or toward the cap at the top level).
  let altCtx: AltCtx | undefined;
  const wouldCount = (c: AltCtx | undefined): boolean => !c || (c.counts[c.branch] + 1 > c.max && wouldCount(c.parent));
  const tally = (c: AltCtx | undefined) => {
    if (!c) { counted++; return; }
    if (++c.counts[c.branch] > c.max) { c.max = c.counts[c.branch]; tally(c.parent); }
  };
  let curOf: number | undefined; // #73: the message whose work is running (see Message.of)
  /** Wrap `run` so that what it pushes carries `of` = the number of the message just pushed (stamped `n`); it runs later, so the number is taken now. */
  const startedBy = (on: boolean, run: () => void): (() => void) => {
    if (!on) return run;
    const n = messages.length;
    messages[n - 1].n = n;
    return () => { const prev = curOf; curOf = n; try { run(); } finally { curOf = prev; } };
  };
  let mwCtx: { fn: string; index: number } | null = null; // set while an ingress's middleware runs: its messages are marked
  const push = (m: Message) => {
    if (altIx && ++pushed > 4 * maxMessages) { truncated = true; return false; } // a hard ceiling: exclusive arms may expand the same delivery once each
    if (arms.path.length) m = { ...m, arms: [...arms.path] };
    if (mwCtx && !m.middleware) m = { ...m, middleware: mwCtx };
    if (curOf !== undefined && m.of === undefined) m = { ...m, of: curOf };
    if (m.kind === 'frontier' || m.repeatOf) { messages.push(m); return true; } // markers are free, as documented on TraceOptions.frontier (and #43 for repeats)
    if (counted >= maxMessages && wouldCount(altCtx)) { truncated = true; return false; }
    tally(altCtx);
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

  // Values bound by call steps (#42) on the way down: the nearest bind of a name wins. A message to another service starts with none.
  type Binds = ReadonlyMap<string, { value: string; boundAt: string }>;
  const visitFn = (service: string, fn: string, depth: number, stack: string[], binds: Binds = new Map()) => {
    const f = g.fns.get(sid(service, fn));
    if (!f) return;
    const me = fnPart(service, fn);
    let folded = false;
    const ordered = [...f.steps].sort((a, b) => a.seq - b.seq);
    const alts = altGroups(ordered.filter((st) => showFrontier || st.origin !== 'frontier'), f.id);
    const outer = altCtx, ctxs = new Map<string, AltCtx>(), arm0 = arms;
    const later: (() => void)[] = []; // #73: what async calls start runs after the caller's own remaining steps
    try {
    for (const st of ordered) {
      if (truncated) return;
      const alt = alts.get(st.seq);
      altCtx = outer; arms = arm0;
      if (altIx) { // 0.37.0: the arms this step sits in, the locks it adds; an arm a lock excludes is skipped with its subtree
        const r = enterStep(altIx, book, st, `${service}:${f.id}#${st.seq}`, arm0);
        if (r.skip) continue;
        arms = r.state;
        if (arms.path.length > arm0.path.length) altCtx = altCtxOf(armCtxs, armChain(altIx, arms.path)!, outer);
      }
      if (alt) altCtx = altCtxOf(ctxs, alt, altCtx);
      if (st.origin === 'frontier' && !showFrontier) {
        if (!folded) { // one marker per function, where its first frontier step would be
          folded = true;
          push({ from: me, to: me, label: `frontier: ${frontierCount(service, fn)} steps`, mode: 'sync', kind: 'frontier', depth, service, fn: f.id, seq: st.seq, frontierSteps: frontierCount(service, fn) });
        }
        continue;
      }
      const base = { depth, condition: st.condition, ...(alt ? { alt } : {}), loop: st.loop, note: st.note, fn: f.id, service, seq: st.seq, ...stepExtras(st, `${service}:${f.id}#${st.seq}`), ...(st.origin === 'frontier' ? { origin: 'frontier' as const } : {}) };
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
        const down: Binds = st.bind ? new Map([...binds, ...Object.entries(st.bind).map(([k, value]): [string, { value: string; boundAt: string }] => [k, { value, boundAt: `${f.name}:${st.seq}` }])]) : binds;
        if (!cycle && depth < maxDepth) afterCaller(st.mode, later, startedBy(st.mode === 'async', () => visitFn(service, st.target!, depth + 1, [...stack, key], down)));
      } else if (st.type === 'resource') {
        const r = g.resources.get(sid(service, st.target));
        const to = part({ id: `res:${r?.bindKey ?? sid(service, st.target)}`, label: r?.name ?? st.target, kind: 'resource' });
        push({ ...base, from: me, to, label: st.operation ?? 'use', mode: st.mode ?? 'sync', kind: 'resource', transport: 'res', store: r?.bindKey ?? sid(service, st.target), ...storeOn(st, r, g), ...(st.fields?.length ? { fields: st.fields } : {}), ...unknownOn(st), ...assumedOn(st) });
      } else {
        const e = g.egress.get(sid(service, st.target));
        if (!e) continue;
        const mode = st.mode ?? e.mode ?? 'sync';
        // eventFrom: the nearest bind decides; none bound on this path is a publish that names no event (the #40 rule below).
        const from = st.eventFrom ? binds.get(st.eventFrom) : undefined;
        const event = st.eventFrom ? from?.value : st.event ?? (e.events?.length === 1 ? e.events[0] : undefined);
        const eventFrom = st.eventFrom ? { eventFrom: { name: st.eventFrom, ...(from ? { boundAt: from.boundAt } : {}) } } : {};
        const label = (st.operation && !e.bindKey.includes(st.operation) ? `${st.operation} ${e.bindKey}` : e.bindKey) + (event ? ` · ${event}` : '');
        // No single event: the types the egress may send (its events, then the candidates of its unresolved event) decide which subscriptions are followed (#40).
        const set = event ? undefined : untypedEventSet(e);
        // RPC over AMQP, or a publish to an exchange: what the trace adds about the routing (additive fields).
        const rpc = rpcOf(e), ex = splitAmqpKey(e.bindKey)?.exchange;
        const route = !rpc && ex && !g.channels.has(e.bindKey) && (g.channels.has(`amqp:${ex}`) || g.model.bindings.some((b) => splitAmqpKey(b.from)?.exchange === ex)) ? routeKey(g.model.bindings, g.channels.get(`amqp:${ex}`)?.details, e.bindKey, e.details) : null;
        const extra = { ...(st.operation ? { operation: st.operation } : {}), ...(rpc ? { rpc } : route ? { amqp: routeInfo(route, g.channels.get(`amqp:${ex}`)?.details) } : {}) };
        const ok = (l: Parameters<typeof passes>[1]) => (set ? passesUntyped(g, l, set) !== false : passes(g, l, event));
        const all = distinct(linksFrom(g, { type: 'egress', service, id: e.id }).filter(ok));
        // A send to a queue that an ingress consumes matches that ingress by key and also goes through the queue: draw the queue path only.
        const viaChannel = new Set<string>();
        const reach = (r: Ref, seen: string[]) => {
          for (const l of distinct(linksFrom(g, r).filter(ok))) {
            if (l.to.type === 'ingress') viaChannel.add(refKey(l.to));
            else if (!seen.includes(l.to.key)) reach(l.to, [...seen, l.to.key]);
          }
        };
        for (const l of all) if (l.to.type === 'channel') reach(l.to, [l.to.key]);
        const links = all.filter((l) => l.to.type !== 'ingress' || !viaChannel.has(refKey(l.to)));
        if (!links.length && route && !route.matched.length && !route.possible.length) { // the exchange routes it nowhere: the arrow ends at the exchange
          push({ ...base, from: me, to: chPart(`amqp:${route.exchange}`), label, mode, kind: 'egress', transport: e.transport, event, egress: e.id, ...eventFrom, ...extra });
          continue;
        }
        if (!links.length) {
          const to = part({ id: `missing:${e.bindKey}`, label: e.bindKey, kind: 'missing' });
          push({ ...base, from: me, to, label, mode, kind: 'egress', broken: true, transport: e.transport, egress: e.id, ...eventFrom, ...extra });
          continue;
        }
        if (route && links.length > 1 && links.every((l) => l.to.type === 'channel')) { // an exchange that routes to several queues is a fan-out like an SNS topic: publish to the exchange, one hop per binding
          holdAsync(mode, later, () => follow(me, { type: 'channel', key: `amqp:${route.exchange}` }, label, mode, depth, stack, { ...base, transport: e.transport, event, egress: e.id, ...eventFrom, ...extra }, [], set, links));
          continue;
        }
        holdAsync(mode, later, () => { for (const l of links) follow(me, l.to, label, mode, depth, stack, { ...base, transport: e.transport, event, egress: e.id, ...eventFrom, ...extra, ...filterOf(l) }, [], set); });
      }
    }
    for (const run of later) run();
    } finally { altCtx = outer; arms = arm0; }
  };

  // An ingress's middleware (in order) runs before its handler, each as an ordinary function visit; their messages carry `middleware`.
  const chainOf = (i: { service: string; middleware?: string[] }) => (i.middleware ?? []).filter((m) => g.fns.get(sid(i.service, m))).map((m) => ({ fn: m, name: g.fns.get(sid(i.service, m))!.name }));
  const runIngress = (i: { service: string; middleware?: string[] }, handler: string, depth: number, stack: string[]) => {
    const saved = mwCtx;
    chainOf(i).forEach((m, index) => {
      if (truncated || stack.includes(sid(i.service, m.fn))) return;
      mwCtx = { fn: m.fn, index };
      try { visitFn(i.service, m.fn, depth, [...stack, sid(i.service, m.fn)]); } finally { mwCtx = saved; }
    });
    mwCtx = null; // what the handler does (and every other service it reaches) is not middleware
    try { visitFn(i.service, handler, depth, stack); } finally { mwCtx = saved; }
  };

  // Deliver from `from` to a link target, expanding channels and crossing into other services.
  // A fan-out's deliveries are drawn first (publish, then topic -> queue -> consumer for each), and only then what each consumer does
  // (its calls, stores, publishes, nested deliveries), in delivery order: nothing hangs between the deliveries, under the topic's activation bar.
  let deferred: (() => void)[] | null = null;
  const { withAlt, holdAsync, afterCaller } = deferHelpers<{ a: AltCtx | undefined; p: ArmState }>({ alt: { get: () => ({ a: altCtx, p: arms }), set: (x) => { altCtx = x.a; arms = x.p; } }, deferred: { get: () => deferred, set: (d) => { deferred = d; } } });
  const follow = (from: string, to: Ref, label: string, mode: Mode, depth: number, stack: string[], base: Partial<Message>, seenCh: string[] = [], set?: EventSet, only?: Link[]) => {
    if (truncated) return;
    if (to.type === 'channel') {
      const ch = chPart(to.key);
      if (!push({ ...base, from, to: ch, label, mode, kind: 'egress', depth } as Message)) return;
      if (scope === 'intra' || seenCh.includes(to.key)) return; // intra stops at the service boundary
      const subs = distinct(only ?? linksFrom(g, to)); // `only`: the bindings an exchange routed this publish to (they are the egress's own links)
      const next = set ? subs.filter((l) => passesUntyped(g, l, set) !== false) : subs.filter((l) => passes(g, l, base.event));
      if (set && !set.known.length && !set.candidates.length && next.length < subs.length) {
        // Event fully unknown: subscriptions with a filter cannot be told apart, so the publish stops at the topic for them.
        const gap: Unresolved = { what: 'event', reason: 'event_unknown', detail: 'the publisher could not name the event type' };
        push({ ...base, from: ch, to: part({ id: 'gap:event_unknown', label: 'unresolved: event_unknown', kind: 'unresolved' }), label: 'event unknown: not delivered', mode: 'async', kind: 'deliver', depth, gap } as Message);
      }
      if (!next.length) return;
      // A publish that reaches several links is a fan-out: the publish carries a group id, each delivery an ordinal.
      const group = next.length > 1 ? `m${messages.length - 1}` : undefined;
      if (group) Object.assign(messages[messages.length - 1], { group, deliveries: next.length });
      const { deliveries: _n, filter: _f, ...inherited } = base; // a delivery's ordinal rides along to its queue -> consumer message; an inner fan-out replaces it
      const outerDeferred = deferred, later: (() => void)[] = outerDeferred ?? [];
      if (group) deferred = later;
      next.forEach((l, k) => {
        const possible = !!inherited.possible || (!!set && passesUntyped(g, l, set) === 'possible');
        // An untyped publish gets through a filtered subscription by the types of its set that the filter allows: name them (#40).
        const own = set && l.binding ? matchedTypes(l, set) : [];
        const matched = own.length ? own : inherited.matched;
        follow(ch, l.to, to.key + (base.event ? ` · ${base.event}` : matched?.length ? ` · ${matched.join(', ')}` : '') + (possible ? ' · possible' : ''), 'async', depth, stack,
          { ...inherited, transport: l.transport, ...filterOf(l), ...(matched?.length ? { matched } : {}), ...(possible ? { possible } : {}), ...(group ? { group, delivery: k + 1 } : {}) }, [...seenCh, to.key], set);
      });
      if (group) { deferred = outerDeferred; if (!outerDeferred) for (const run of later) run(); }
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
    const key = sid(i.service, handler);
    // One expansion per delivery and trace, wherever it sits (siblings, other alt branches): the first in trace order wins. An ancestor on the path stays a [cycle].
    const seenKey = scope === 'intra' && i.service !== root ? undefined : `${key}|${i.id}|${base.event ?? ''}|${base.matched?.join(',') ?? ''}`;
    const first = seenKey && !stack.includes(key) ? expanded.get(seenKey)?.find((e) => covers(e.path, arms.path))?.n : undefined;
    const text = crossing === 'deliver' ? `${label} → ${handler}` : label;
    if (!push({ ...base, from, to: target, label: first ? `${text} ↩ seen at step ${first}` : text, mode, kind: crossing, depth, target: { service: i.service, ingress: i.id, fn: handler }, ...(base.rpc ? { rpc: withServer(base.rpc, i.details) } : {}), ...(first ? { repeatOf: first } : scope === 'intra' && i.service !== root || !chainOf(i).length ? {} : { middlewareChain: chainOf(i) }) } as Message)) return;
    if (scope === 'intra' && i.service !== root) return;
    if (stack.includes(key)) { messages[messages.length - 1].cycle = true; return; }
    if (first) return;
    if (seenKey) expanded.set(seenKey, [...(expanded.get(seenKey) ?? []), { n: messages.length, path: arms.path }]);
    if (depth < maxDepth) {
      const go = startedBy(crossing === 'deliver' || mode === 'async', () => runIngress(i, handler, depth + 1, [...stack, key]));
      if (deferred) deferred.push(withAlt(go)); else go();
    }
  };

  const client = part({ id: 'client', label: ing?.entryPoint ? 'client' : 'caller', kind: 'client' });
  push({ from: client, to: fnPart(root, fnId), label: (ing?.bindKey ?? fnId) + (start.event ? ` · ${start.event}` : ''), event: start.event, mode: 'sync', kind: 'entry', depth: 0, service: root, fn: fnId, transport: ing?.transport, ...(ing?.transport === 'socket' ? { protocol: socketProtocol(ing) } : {}), target: ing ? { service: root, ingress: ing.id, fn: fnId } : undefined, ...(ing && chainOf(ing).length ? { middlewareChain: chainOf(ing) } : {}) });
  if (ing) runIngress(ing, fnId, 1, [sid(root, fnId)]); else visitFn(root, fnId, 1, [sid(root, fnId)]);

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
  const out: Trace = { code, start: { service: root, ingress: ing?.id, fn: fnId, event: start.event }, scope, participants: deliveryOrder([...participants.values()], messages), messages, truncated };
  return withAltDecisions(altIx && book.places.size ? withDecisions(altIx, book, out) : out); // 0.38.2: alt frames are decisions too
}

/** The wire protocol of a socket ingress (`details.protocol`: tls, tcp or ws); tcp when the harvester gave none. */
const socketProtocol = (i: Ingress): 'tls' | 'tcp' | 'ws' => (['tls', 'tcp', 'ws'].includes(String(i.details?.protocol)) ? i.details!.protocol as 'tls' : 'tcp');

/**
 * Lifelines in delivery order: a topic or queue sits left of whatever it delivers to, so a delivery
 * arrow never points backwards. A channel that is right of its target moves to just before it.
 */
export function deliveryOrder(parts: Participant[], messages: Message[], fanOut = true): Participant[] {
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
  // The pass above can pull a queue right of its consumer (a second topic feeds the same queue and sits further right).
  // A lifeline whose first appearance is as the consumer of a queue (so not an upstream caller) goes right after that queue (#35).
  const first = new Map<string, Message>();
  for (const m of messages) for (const id of [m.from, m.to]) if (!first.has(id)) first.set(id, m);
  for (const m of messages) {
    if (!m.from.startsWith('ch:') || m.to.startsWith('ch:') || first.get(m.to) !== m) continue;
    const a = order.findIndex((p) => p.id === m.from), b = order.findIndex((p) => p.id === m.to);
    if (a < 0 || b < 0 || b > a) continue;
    const [svc] = order.splice(b, 1);
    order.splice(a, 0, svc); // the queue moved one place left when the consumer was taken out, so this is right after it
  }
  return fanOut ? fanOutOrder(order, messages) : order;
}
