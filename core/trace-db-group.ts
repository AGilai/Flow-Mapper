// DB-op grouping of a trace view (0.37.1, #82; the label and the guard / decision rules 0.43.2, #88), pure. A maximal run of consecutive `resource`
// messages of one function / service with the same store (the bind key up to the collection), the same `of` and the same arm path becomes one row
// `*3 get, hget` (the count, then the distinct operations in order of first use). A per-step guard (`onlyWhen`) and a step that carries `alternatives`
// (a decision point) do not split a run; only a different arm path does (an arm boundary).
// Anything else between them (an internal call that is visible, an external call, a delivery, an async start `n`) breaks the run, so the order
// of the flow is kept. In the external view internal calls are hidden, so one service's ops merge across its functions. A run that
// starts at a key in `dbOpen` stays expanded. The row is the first member's (its `to`, `key`, `stepId`), with `dbGroup` naming the members.

import type { DbCall, DbGroup, Message } from './trace-types.ts';

const storeOf = (m: Message) => { const k = m.store ?? m.to; const i = k.indexOf('/'); return i < 0 ? k : k.slice(0, i); };
const collectionOf = (m: Message) => { const k = m.store ?? m.to; const i = k.indexOf('/'); return i < 0 ? k.replace(/^[^:]+:/, '') : k.slice(i + 1); };
const same = (a: Message, b: Message) => a.service === b.service && a.from === b.from && storeOf(a) === storeOf(b) && a.of === b.of && (a.arms ?? []).join() === (b.arms ?? []).join();
const groupable = (m: Message) => m.kind === 'resource' && !m.gap && !m.broken && m.n === undefined && !m.fixes && !m.mark;

const memberOf = (m: Message): Partial<Message> => ({ key: m.key, label: m.label, store: m.store ?? m.to, access: m.access, stepId: m.stepId ?? (m.service && m.fn && m.seq ? `${m.service}:${m.fn}#${m.seq}` : undefined), service: m.service, fn: m.fn, seq: m.seq,
  keyTemplate: m.keyTemplate, dbIndex: m.dbIndex, ttlSeconds: m.ttlSeconds, keyUnresolved: m.keyUnresolved, unknown: m.unknown, fields: m.fields, onlyWhen: m.onlyWhen, canFail: m.canFail });
const compact = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
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
    const dbGroup: DbGroup = { count: ms.length, collections, access: access(ms), members: ms.map((m) => m.key ?? ''), calls: ms.map((m) => compact(memberOf(m)) as DbCall) };
    const fails = ms.flatMap((m) => m.canFail ?? []), guards = [...new Set(ms.flatMap((m) => (m.onlyWhen ? [m.onlyWhen.guard] : [])))], gm = ms.find((m) => m.onlyWhen)?.onlyWhen; // 0.38.1: the members' markers, together
    out.push({ ...first, m: { ...rest, ...(fails.length ? { canFail: fails } : {}), ...(gm ? { onlyWhen: { ...gm, guard: guards.join('; ') } } : {}), label: `*${ms.length} ${[...new Set(ms.map((m) => m.label))].join(', ')}`, access: dbGroup.access, dbGroup } });
    k = end - 1;
  }
  return out;
}
