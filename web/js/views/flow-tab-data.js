// What a tab shows, loaded by key. Every tab traces its own flow; a sub-flow tab is a full flow that starts at the
// consumer (its ingress and the delivered event, so only that handler runs): the same request as "Full flow", so the two
// match. The origin (loaded by key too, open or not) only supplies the row and its publish for the breadcrumb.
// Traces are cached by request (tabs and expanded cards share them, a consumer is traced once); clear() forgets them.

import { api } from '../api.js';
import { asyncTree } from './flow-async.js';
import { parseKey, findRow, groupOfRow } from './flow-tabs-state.js';
import { subRequest, requestKey } from './flow-sub.js';

const colorOf = (transport) => `var(--t-${String(transport ?? 'sqs').replace('amqp-queue', 'amqp')}, var(--t-res))`;

/** createTabData(env, getOpts) -> { load(key), traceFor(request), clear(), describe(key), peek(key) }; getOpts(): { frontier } */
export function createTabData(env, getOpts) {
  const cache = new Map(), done = new Map(), traces = new Map();
  let running = 0;
  const waiting = [];
  const pump = () => { while (running < 4 && waiting.length) { running++; waiting.shift()(); } }; // at most 4 traces in flight ("Expand all")
  /** The trace of a request, once per distinct request. */
  const traceFor = (q) => {
    const k = requestKey(q);
    if (!traces.has(k)) {
      traces.set(k, new Promise((ok, no) => { waiting.push(() => api.trace(env, q).then(ok, no).finally(() => { running--; pump(); })); pump(); }));
      traces.get(k).catch(() => traces.delete(k));
    }
    return traces.get(k);
  };
  const load = (key) => {
    if (!cache.has(key)) cache.set(key, resolve(key).then((d) => { done.set(key, d); return d; }));
    return cache.get(key);
  };
  const triggerOf = (p) => api.endpoint(env, p.service, p.ingress).then((e) => e?.ingress?.details?.trigger ?? null, () => null);
  async function resolve(key) {
    const p = parseKey(key);
    if (!p) throw new Error('This tab is not a flow.');
    if (p.kind === 'sub') {
      const origin = await load(p.origin);
      const row = findRow(origin.tree.rows, p.queue, p.handler);
      if (!row) throw new Error(`${p.handler} is not in the flow it was opened from (${p.origin}), at the scope that flow has now.`);
      const trace = await traceFor(subRequest(row, getOpts()));
      return { key, kind: 'sub', originKey: p.origin, trace, tree: asyncTree(trace.messages), row, group: groupOfRow(origin.tree, row), label: row.label, service: row.service, name: row.handler, scope: 'full', start: subRequest(row) };
    }
    const q = { service: p.service, maxMessages: 800, frontier: getOpts().frontier ? '1' : null };
    if (p.kind === 'fn') Object.assign(q, { fn: p.fn, event: p.event, scope: p.scope });
    else if (p.kind === 'full') Object.assign(q, { ingress: p.ingress, event: p.event, scope: 'full' });
    else Object.assign(q, { ingress: p.ingress, event: p.event, scope: p.scope });
    const trace = await traceFor(q);
    const trigger = p.ingress && trace.participants?.some((x) => x.serviceKind === 'client-app' && x.service === p.service) ? await triggerOf(p) : null; // a client app's head says what starts it
    return { key, kind: p.kind, trigger, originKey: p.origin ?? null, trace, tree: asyncTree(trace.messages), service: p.service, name: p.ingress ?? p.fn, scope: p.kind === 'full' ? 'full' : p.scope,
      start: p.ingress && (p.kind === 'full' || p.scope === 'full') ? { service: p.service, ingress: p.ingress, event: p.event ?? null, scope: 'full' } : null };
  }
  /** The tab's label parts, from the loaded data or (before it arrives) from the key alone. */
  function describe(key) {
    const p = parseKey(key), d = done.get(key);
    if (!p) return { kind: 'entry', title: key, sub: '', tip: key, color: 'var(--t-res)' };
    if (p.kind === 'sub') {
      const t = d ? d.row.transport : p.queue.split(':')[0];
      return { kind: 'sub', tn: d?.label ?? '…', title: d?.service ?? p.handler, sub: d ? d.name : '', color: colorOf(t), tip: d ? `${d.label} · ${d.service} · ${d.name} (from ${p.queue.replace(/^[^:]+:/, '')})` : p.handler };
    }
    const name = p.ingress ?? p.fn;
    return { kind: p.kind, title: p.service, sub: name, color: p.kind === 'full' ? 'var(--accent)' : 'var(--t-http)',
      tip: p.kind === 'full' ? `Full flow from ${p.service} · ${name}` : `${p.service} · ${name}${p.event ? ` (${p.event})` : ''}`, scope: p.scope };
  }
  return { load, describe, traceFor, peek: (key) => done.get(key) ?? null, clear: () => { cache.clear(); done.clear(); traces.clear(); } };
}
