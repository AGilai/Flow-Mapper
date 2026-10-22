// DB-op grouping of a trace view (0.37.1, #82), pure. A maximal run of consecutive `resource` messages of one function / service with the
// same store (the bind key up to the collection), the same `of` and the same arm path becomes one row `DB: 3 ops (users, devices)`.
// Anything else between them (an internal call that is visible, an external call, a delivery, an async start `n`) breaks the run, so the order
// of the flow is kept. In the external view internal calls are hidden, so one service's ops merge across its functions. A run that
// starts at a key in `dbOpen` stays expanded. The row is the first member's (its `to`, `key`, `stepId`), with `dbGroup` naming the members.

import type { DbGroup, Message } from './trace-types.ts';

const storeOf = (m: Message) => { const k = m.store ?? m.to; const i = k.indexOf('/'); return i < 0 ? k : k.slice(0, i); };
const collectionOf = (m: Message) => { const k = m.store ?? m.to; const i = k.indexOf('/'); return i < 0 ? k.replace(/^[^:]+:/, '') : k.slice(i + 1); };
const same = (a: Message, b: Message) => a.service === b.service && a.from === b.from && storeOf(a) === storeOf(b) && a.of === b.of && (a.arms ?? []).join() === (b.arms ?? []).join();
const groupable = (m: Message) => m.kind === 'resource' && !m.gap && !m.broken && m.n === undefined && !m.alternatives && !m.fixes && !m.mark;

const access = (ms: Message[]): DbGroup['access'] => {
  const set = new Set(ms.map((m) => m.access ?? 'unknown'));
  return set.size === 1 ? [...set][0] : set.has('read_write') || (set.has('read') && set.has('write')) ? 'read_write' : set.has('unknown') ? [...set].find((x) => x !== 'unknown')! : 'unknown';
};

/** `items`: the view's messages with their canonical index `i` (the first member's index stands for the row). Returns the list with runs folded. */
export function groupDbOps<T extends { m: Message; i: number }>(items: T[], dbOpen: ReadonlySet<string> = new Set()): T[] {
  const out: T[] = [];
  for (let k = 0; k < items.length; k++) {
    const first = items[k];
    if (!groupable(first.m)) { out.push(first); continue; }
    let end = k + 1;
    while (end < items.length && groupable(items[end].m) && same(first.m, items[end].m)) end++;
    const run = items.slice(k, end);
    if (run.length < 2 || dbOpen.has(first.m.key ?? '')) { out.push(...run); k = end - 1; continue; }
    const ms = run.map((x) => x.m), collections = [...new Set(ms.map(collectionOf))];
    const { fields: _f, operation: _o, unknown: _u, assumed: _a, returns: _r, ...rest } = first.m;
    const dbGroup: DbGroup = { count: ms.length, collections, access: access(ms), members: ms.map((m) => m.key ?? '') };
    out.push({ ...first, m: { ...rest, label: `DB: ${ms.length} ops (${collections.join(', ')})`, access: dbGroup.access, dbGroup } });
    k = end - 1;
  }
  return out;
}
