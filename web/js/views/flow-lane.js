// The sequence "lane": one activation bar per call into a service, spanning the whole call. Pure layout rules,
// no DOM, so tests can import it. Input is a list of trace messages (the whole trace, or one async flow: its
// delivery first, then what the consumer does); output is columns, events (one row each, in order) and bars.
//
//  - a call into a service (entry, or a sync/async egress to a service) opens a bar; the bar closes when the trace
//    returns to a message at its depth or above; a second call is a second bar;
//  - calls inside a service ("call" steps) are not drawn: they are counted on the bar (the pill);
//  - a publish ends at the "published events" rail; the async work below it is not in the lane (flow-async.js);
//  - a call that matches nothing ends at the "unresolved" column, without a bar or a return;
//  - middleware (m.middlewareChain on the call) is a run of segments on top of the bar: one "mw" row per segment, then the rows of
//    its calls; the handler's part (and the internal-calls pill) follow. Chains over 3 fold into one segment unless its key is in `mwOpen` (a Set of bar keys, or true for all);
//  - a callee reuses its service's column unless the arrow would cross another open bar, then it gets a new column.

import { scanLane, isPublish } from './flow-scan.js';
import { mwSegments, segmentOf, mwSpans } from './flow-mw.js';

const SYNC_TRANSPORT = new Set(['http', 'rpc', 'grpc']);
export const svcOf = (id) => (id.startsWith('svc:') ? id.slice(4) : id.startsWith('fn:') ? id.split(':')[1] : null);

/** "http:POST orders-svc/orders" -> "POST /orders"; other transports show their event or label. */
export function callLabel(m) {
  if (m.kind === 'deliver') { const hd = m.target?.fn ?? m.label.match(/→\s*(.+)$/)?.[1] ?? ''; return m.event ? `${m.event} → ${hd}` : hd; }
  if (m.transport === 'http' || m.transport === 'rpc') {
    const t = m.label.replace(/^\w+:/, '');
    const k = t.match(/^(\S+) [^/\s]*(\/.*)$/);
    return k ? `${k[1]} ${k[2]}` : t;
  }
  return m.event ?? m.label.replace(/^.*→\s*/, '').replace(/^\w+:/, '');
}
/** Event name on a publish arrow. */
export const publishLabel = (m) => m.event ?? m.label.split(' · ')[1] ?? 'publish';
/** Verb and store name of a data-store stub: "UpdateItem" over "inventory-stock". */
export const storeLabel = (m) => ({ verb: m.label, name: (m.store ?? '').replace(/^[^:]+:/, '').replace('/', '.') });

/**
 * buildLane(msgs, { stores, scope, participants })
 * -> { columns: [{ id, label, sub, kind }], events, bars, altMsgs, altRows }
 * Event types: call (opens a bar, or an arrow to a plain lifeline), return, store, publish, unresolved, pill, frontier.
 * Every event has `row` (its index). Bars: { id, service, col, level, transport, sync, msg, depth, internal: {n, gaps}, msgs, start, end }.
 */
export function buildLane(msgs, { stores = true, scope = 'full', participants = [], mwOpen = false } = {}) {
  const kind = new Map(participants.map((p) => [p.id, p.kind]));
  const cols = [], byService = new Map(), stack = [], bars = [], events = [];
  const keys = new Map();
  const mk = (c) => { c.ci = cols.length; cols.push(c); return c; };
  const special = (id, label, sub, k) => cols.find((c) => c.id === id) ?? mk({ id, label, sub, kind: k, ci: Infinity });
  const unresolvedCol = () => special('unresolved', 'unresolved', 'no match / gap', 'unresolved');
  const railCol = () => special('rail', 'published events', 'topics, queues', 'rail');
  if (!msgs.length) return { columns: [], events, bars, altMsgs: [], altRows: [] };

  const first = msgs[0];
  const source = mk(first.kind === 'deliver'
    ? { id: 'src', label: first.from.replace(/^ch:/, ''), sub: 'queue delivery', kind: 'source' }
    : { id: 'client', label: 'client', sub: 'browser', kind: 'client' });
  const root = svcOf(first.to);

  const between = (c, a, b) => c.ci > Math.min(a.ci, b.ci) && c.ci < Math.max(a.ci, b.ci);
  const pickCol = (service, caller) => {
    const ex = byService.get(service);
    if (ex && !stack.some((b) => b.col !== caller && b.col !== ex && between(b.col, caller, ex))) return ex;
    const c = mk({ id: `svc:${service}:${cols.length}`, label: service, sub: scope === 'intra' && service !== root ? 'not followed' : ex ? 'called again' : 'service', kind: scope === 'intra' && service !== root ? 'plain' : 'service', service });
    byService.set(service, c);
    return c;
  };
  const push = (e) => { e.row = events.length; events.push(e); return e; };
  // Middleware rows are emitted lazily, so each segment's row sits just before its own calls; the pill waits for the handler's part.
  const emitMw = (bar, pos) => {
    const mw = bar.mw;
    while (mw.labels.length <= pos) mw.labels.push(push({ type: 'mw', bar, seg: mw.segs[mw.labels.length], internal: 0, gaps: 0 }));
    return mw.labels[pos];
  };
  const endMw = (bar) => {
    const mw = bar.mw;
    if (!mw || mw.done) return;
    emitMw(bar, mw.segs.length - 1);
    mw.done = true; mw.endIdx = events.length - 1;
    push({ type: 'pill', bar });
  };
  const close = (b) => {
    endMw(b);
    if (b.sync && b.caller) push({ type: 'return', bar: b, to: b.caller, label: 'return' });
    b.end = events.length - 1;
  };
  const open = (m, caller, parent, service, col, sync) => {
    const bar = { id: bars.length, service, col, level: stack.filter((b) => b.col === col).length, transport: m.transport, sync, msg: m, depth: m.depth, internal: { n: 0, gaps: 0 }, msgs: [m], caller, parent };
    bars.push(bar);
    bar.start = push({ type: 'call', msg: m, from: caller, to: col, bar, label: callLabel(m), fromBar: parent }).row;
    const chain = m.middlewareChain ?? [];
    const kb = `${service}/${m.target?.ingress ?? ''}`, nth = (keys.get(kb) ?? 0) + 1;
    keys.set(kb, nth);
    const key = `${kb}#${nth}`; // stable across redraws: service, ingress, nth bar of it
    if (chain.length) bar.mw = { chain, key, segs: mwSegments(chain, mwOpen === true || (mwOpen instanceof Set && mwOpen.has(key))), labels: [], done: false, endIdx: -1 };
    else push({ type: 'pill', bar });
    stack.push(bar);
    return bar;
  };

  const rootCol = mk({ id: `svc:${root}`, label: root, sub: 'service', kind: 'service', service: root });
  byService.set(root, rootCol);
  const { lane, publishes } = scanLane(msgs);
  const pubAt = new Map(publishes.map((p) => [p.i, p]));
  lane.forEach((idx, n) => {
    const m = msgs[idx];
    if (n === 0) { open(m, source, null, root, rootCol, SYNC_TRANSPORT.has(m.transport) && m.mode === 'sync'); return; }
    while (stack.length && stack[stack.length - 1].depth >= m.depth) close(stack.pop());
    const top = stack[stack.length - 1];
    if (!top) return;
    top.msgs.push(m);
    if (top.mw && !top.mw.done) {
      if (!m.middleware) endMw(top);
      else {
        const seg = emitMw(top, Math.max(0, segmentOf(top.mw.segs, m.middleware.index)));
        if (m.kind === 'call') { seg.internal++; if (m.gap || m.broken) seg.gaps++; return; }
      }
    }
    if (m.kind === 'call') { top.internal.n++; if (m.gap || m.broken) top.internal.gaps++; return; }
    if (m.kind === 'leaf') return;
    if (m.kind === 'resource') { if (stores) push({ type: 'store', msg: m, bar: top, ...storeLabel(m) }); return; }
    if (m.kind === 'frontier') { push({ type: 'frontier', msg: m, bar: top }); return; }
    if (isPublish(m)) { push({ type: 'publish', msg: m, bar: top, col: railCol(), topic: m.to.slice(3), label: publishLabel(m), flows: pubAt.get(idx)?.delivers.length ?? 0 }); return; }
    const k = kind.get(m.to), service = svcOf(m.to);
    if (m.broken || m.gap || !service || k === 'missing' || k === 'unresolved') { push({ type: 'unresolved', msg: m, bar: top, col: unresolvedCol(), label: callLabel(m) }); return; }
    if (scope === 'intra' && service !== root) { push({ type: 'call', msg: m, from: top.col, fromBar: top, to: pickCol(service, top.col), bar: null, label: callLabel(m) }); return; }
    open(m, top.col, top, service, pickCol(service, top.col), SYNC_TRANSPORT.has(m.transport) && m.mode === 'sync');
  });
  while (stack.length) close(stack.pop());

  // Pills only where something was folded; rows follow the order of what is left.
  const kept = events.filter((e) => e.type !== 'pill' || e.bar.internal.n);
  const remap = new Map(events.map((e) => [e, kept.indexOf(e)]));
  kept.forEach((e, i) => { e.row = i; });
  for (const b of bars) { b.start = remap.get(events[b.start]) ?? b.start; }
  for (const b of bars) { // end: last kept event at or before the old end
    let e = b.end; while (e > 0 && remap.get(events[e]) < 0) e--; b.end = remap.get(events[e]);
  }
  for (const b of bars) { // segments: from their label row to the row before the next one; the last ends where the handler's part starts
    if (!b.mw) continue;
    let e = b.mw.endIdx; while (e > 0 && remap.get(events[e]) < 0) e--;
    b.mw.spans = mwSpans(b.mw.labels.map((ev) => ev.row), remap.get(events[e]));
  }
  const rank = (c) => (c.kind === 'unresolved' ? 1 : c.kind === 'rail' ? 2 : 0);
  const columns = cols.filter((c) => events.some((e) => e.from === c || e.to === c || e.col === c) || c === source || c === rootCol)
    .sort((a, b) => rank(a) - rank(b) || a.ci - b.ci);
  const altEvents = kept.filter((e) => e.msg);
  return { columns, events: kept, bars, altMsgs: altEvents.map((e) => e.msg), altRows: altEvents.map((e) => e.row) };
}

/** Arrows that pass over a bar they do not belong to: [{ event, bar }]. Calls and returns only (the rail and unresolved lie at the far right). */
export function crossings(lane) {
  const order = new Map(lane.columns.map((c, i) => [c, i]));
  const out = [];
  for (const e of lane.events) {
    const a = e.type === 'return' ? e.bar.col : e.from, b = e.type === 'return' ? e.to : e.to;
    if (!a || !b || !order.has(a) || !order.has(b)) continue;
    for (const bar of lane.bars) {
      if (bar.col === a || bar.col === b || bar.start >= e.row || bar.end < e.row) continue;
      const o = order.get(bar.col);
      if (o > Math.min(order.get(a), order.get(b)) && o < Math.max(order.get(a), order.get(b))) out.push({ event: e, bar });
    }
  }
  return out;
}
