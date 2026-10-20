// What a tab shows, loaded by key. An entry / fn / full tab traces its own flow. A sub-flow tab needs no request: it is
// one row of its origin's async tree (the origin is loaded by key too, whether or not that tab is open), drawn with
// the origin's trace. Results are cached by key; clear() forgets them (scope or frontier changed).

import { api } from '../api.js';
import { asyncTree } from './flow-async.js';
import { parseKey, findRow, subTree, groupOfRow } from './flow-tabs-state.js';

const colorOf = (transport) => `var(--t-${String(transport ?? 'sqs').replace('amqp-queue', 'amqp')}, var(--t-res))`;

/** createTabData(env, getOpts) -> { load(key), clear(), describe(key), peek(key) }; getOpts(): { frontier } */
export function createTabData(env, getOpts) {
  const cache = new Map(), done = new Map();
  const load = (key) => {
    if (!cache.has(key)) cache.set(key, resolve(key).then((d) => { done.set(key, d); return d; }));
    return cache.get(key);
  };
  async function resolve(key) {
    const p = parseKey(key);
    if (!p) throw new Error('This tab is not a flow.');
    if (p.kind === 'sub') {
      const origin = await load(p.origin);
      const row = findRow(origin.tree.rows, p.queue, p.handler);
      if (!row) throw new Error(`${p.handler} is not in the flow it was opened from (${p.origin}), at the scope that flow has now.`);
      return { key, kind: 'sub', originKey: p.origin, trace: origin.trace, tree: subTree(row), row, group: groupOfRow(origin.tree, row), msgs: row.msgs, label: row.label, service: row.service, name: row.handler };
    }
    const q = { service: p.service, maxMessages: 800, frontier: getOpts().frontier ? '1' : null };
    if (p.kind === 'fn') Object.assign(q, { fn: p.fn, event: p.event, scope: p.scope });
    else if (p.kind === 'full') Object.assign(q, { ingress: p.ingress, scope: 'full' });
    else Object.assign(q, { ingress: p.ingress, event: p.event, scope: p.scope });
    const trace = await api.trace(env, q);
    return { key, kind: p.kind, originKey: p.origin ?? null, trace, tree: asyncTree(trace.messages), service: p.service, name: p.ingress ?? p.fn, scope: p.kind === 'full' ? 'full' : p.scope };
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
  return { load, describe, peek: (key) => done.get(key) ?? null, clear: () => { cache.clear(); done.clear(); } };
}
