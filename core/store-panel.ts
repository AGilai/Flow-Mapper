// #86, the store panel of an open flow (docs/plans/store-panel.md), pure: what ONE flow touches in one Redis instance or one Mongo store,
// grouped per key template (Redis) or collection (Mongo), with the operations, steps, code links, TTL and fields, and the join to the keys registry.
// The panel is drawn by web/js/views/store-panel*.js; nothing here knows the DOM. Shared with the browser (the static preview), so no `node:` imports.

import type { Message as BaseMessage, Trace } from './trace-types.ts';

/** A resource message as 0.42.1 sends it: top-level `keyTemplate` (details.keyTemplate, else its alias keyPattern), `dbIndex`, `ttlSeconds` and `keyUnresolved` (why no key was read). */
type Message = BaseMessage & { keyTemplate?: string; dbIndex?: number; ttlSeconds?: number; keyUnresolved?: unknown };
import type { StepField } from './types.ts';

export type Access = 'read' | 'write' | 'delete' | 'rw' | 'unknown';
export const CHIP_CAP = 8; // step chips shown per op row before "+N more" (not a setting)
/** Op names (compared case-insensitively, by the first word) that make a write a delete: the data has only read / write / read_write. */
export const DELETE_OPS = new Set(['del', 'unlink', 'deleteone', 'deletemany', 'remove', 'findoneanddelete', 'findonedelete', 'hdel', 'srem', 'zrem', 'lrem', 'xdel']);
const ROLES = ['filter', 'projection', 'update', 'sort'] as const;
const ROLE_WORD: Record<string, string> = { filter: 'filter', projection: 'project', update: 'update', sort: 'sort' };

export interface Target { group: string; collection?: string | null }
export interface CodeLink { key: string; file: string; line?: number; url: string | null; steps: number[] }
export interface FieldGroup { role: string; label: string; items: { path: string; operator?: string; inDdl?: boolean }[] }
export interface OpRow { access: Access; op: string; steps: number[]; links: CodeLink[]; fields: FieldGroup[] }
export interface Ttl { values: number[] }
export interface Card { id: string; kind: 'key' | 'collection' | 'unreported'; title: string | null; template: string | null; dbs: number[]; ttl: Ttl; ops: OpRow[]; steps: number[]; reason: string | null }
export interface Panel { kind: 'redis' | 'mongodb'; group: string; store: string; title: string; sub: string; db: number | null; cards: Card[]; stepCount: number; total: number; keyCount: number; unreported: boolean; folded: boolean }

/** A resource step's store key `mongodb:users-db/users` -> group `mongodb:users-db`, store name `users-db`, collection `users` (same rule as the flow view's `splitStore`). */
export function storeParts(m: Pick<Message, 'store' | 'storeKind'>) {
  const key = String(m.store ?? ''), i = key.indexOf('/'), group = i < 0 ? key : key.slice(0, i), collection = i < 0 ? null : key.slice(i + 1) || null;
  return { group, store: group.replace(/^[^:]+:/, '') || group, kind: m.storeKind ?? (group.includes(':') ? group.split(':')[0] : 'store'), collection };
}
/** The URL / lifeline key of a target: the group, plus `/collection` for one Mongo collection. */
export const targetKey = (t: Target) => (t.collection ? `${t.group}/${t.collection}` : t.group);
export const panelKind = (m: Pick<Message, 'store' | 'storeKind'>): 'redis' | 'mongodb' | null => { const k = storeParts(m).kind; return k === 'redis' || k === 'mongodb' ? k : null; };
/** `store=` of a link -> a target, or null when the trace has no Redis or Mongo step of that store (a stale link is ignored). */
export function targetOf(trace: Pick<Trace, 'messages'>, key: string | null | undefined): Target | null {
  if (!key) return null;
  const i = key.indexOf('/'), group = i < 0 ? key : key.slice(0, i), collection = i < 0 ? null : key.slice(i + 1) || null;
  const hit = trace.messages.some((m) => m.kind === 'resource' && panelKind(m) && storeParts(m).group === group && (!collection || storeParts(m).collection === collection));
  return hit ? { group, collection } : null;
}

/** The operation as harvested; a step with none (`use`) says its access mode, as the step pane does. */
export function opName(m: Message): string {
  if (m.label !== 'use') return m.label;
  return m.access === 'read' || m.access === 'write' ? m.access : m.access === 'read_write' ? 'read/write' : 'access';
}
/** read, write, delete, rw (read and write) or unknown. Delete = a write (or read_write) whose op name is on the DELETE list. */
export function accessClass(m: Message): Access {
  const word = opName(m).trim().split(/\s+/)[0].toLowerCase();
  if ((m.access === 'write' || m.access === 'read_write') && DELETE_OPS.has(word)) return 'delete';
  return m.access === 'read' ? 'read' : m.access === 'write' ? 'write' : m.access === 'read_write' ? 'rw' : 'unknown';
}

const asc = (a: number[]) => [...new Set(a)].sort((x, y) => x - y);
const why = (r: string) => { const x = r.replace(/^key_unresolved:/, ''); return x === 'computed' ? 'computed at runtime' : x; };
/** The reason(s) a step has no key: `keyUnresolved` (a string, a list of strings, or entries with a `reason`). */
const reasonText = (m: Message): string | null => {
  const k = m.keyUnresolved, list = (Array.isArray(k) ? k : k == null ? [] : [k]).map((x: any) => (typeof x === 'string' ? x : x?.reason ?? x?.why ?? '')).filter(Boolean) as string[];
  return list.length ? [...new Set(list.map(why))].join(', ') : null;
};
function fieldsOf(msgs: Message[]): FieldGroup[] {
  const seen = new Set<string>(), by = new Map<string, FieldGroup>();
  for (const m of msgs) for (const f of (m.fields ?? []) as StepField[]) {
    const k = `${f.role}\u0000${f.path}\u0000${f.operator ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!by.has(f.role)) by.set(f.role, { role: f.role, label: ROLE_WORD[f.role] ?? f.role, items: [] });
    by.get(f.role)!.items.push({ path: f.path, ...(f.operator ? { operator: f.operator } : {}), ...(f.inDdl === false ? { inDdl: false } : {}) });
  }
  return [...ROLES.filter((r) => by.has(r)).map((r) => by.get(r)!), ...[...by.values()].filter((g) => !(ROLES as readonly string[]).includes(g.role))];
}
type Row = { m: Message; n: number };
function linksOf(trace: Trace, rows: Row[]): CodeLink[] {
  const by = new Map<string, CodeLink>();
  for (const { m, n } of rows) {
    const c = m.service && m.fn && m.seq ? trace.code?.[`step:${m.service}:${m.fn}#${m.seq}`] : null;
    if (!c?.file) continue;
    const key = `${c.file}${c.line ? `:${c.line}` : ''}`;
    if (!by.has(key)) by.set(key, { key, file: c.file, ...(c.line ? { line: c.line } : {}), url: /^https?:\/\//i.test(c.url ?? '') ? c.url : null, steps: [] });
    by.get(key)!.steps.push(n);
  }
  return [...by.values()].map((l) => ({ ...l, steps: asc(l.steps) })).sort((a, b) => a.steps[0] - b.steps[0]);
}

/**
 * storePanel(trace, target, { stepNo, total }) -> Panel | null
 * target: the lifeline clicked: { group, collection } (collection null: the folded lifeline, or every collection). stepNo(m, i): the number of the arrow the diagram draws for message `m` (index `i` in trace.messages),
 * null when it draws none; the default is the message's place in the trace (the step pane's "Step"). total: how many steps the diagram numbers.
 */
export function storePanel(trace: Trace, target: Target, { stepNo = (_m: Message, i: number) => i + 1, total = trace.messages.length }: { stepNo?: (m: Message, i: number) => number | null; total?: number } = {}): Panel | null {
  const rows: Row[] = [];
  trace.messages.forEach((m, i) => {
    if (m.kind !== 'resource' || !panelKind(m)) return;
    const p = storeParts(m);
    if (p.group !== target.group || (target.collection && p.collection !== target.collection)) return;
    const n = stepNo(m, i);
    if (n != null) rows.push({ m, n });
  });
  if (!rows.length) return null;
  const { store } = storeParts(rows[0].m), kind = panelKind(rows[0].m)!, redis = kind === 'redis';
  const colls = new Set(rows.map((r) => storeParts(r.m).collection ?? store));
  const folded = !redis && !target.collection && colls.size > 1;
  const cards = new Map<string, { head: { kind: Card['kind']; title: string | null; template: string | null }; rows: Row[] }>();
  for (const r of rows) {
    const t = redis ? r.m.keyTemplate ?? null : storeParts(r.m).collection ?? store;
    const id = redis ? (t == null ? '\u0000unreported' : `key:${t}`) : `coll:${t}`;
    if (!cards.has(id)) cards.set(id, { head: redis ? { kind: t == null ? 'unreported' : 'key', title: t, template: t } : { kind: 'collection', title: t, template: null }, rows: [] });
    cards.get(id)!.rows.push(r);
  }
  const out: Card[] = [...cards].map(([id, c]) => {
    const ops = new Map<string, { access: Access; op: string; rows: Row[] }>();
    for (const r of c.rows) {
      const access = accessClass(r.m), op = opName(r.m), k = `${access}\u0000${op.toLowerCase()}`;
      if (!ops.has(k)) ops.set(k, { access, op, rows: [] });
      ops.get(k)!.rows.push(r);
    }
    const reasons = [...new Set(c.rows.map((r) => reasonText(r.m)).filter((x): x is string => !!x))];
    return { id, ...c.head, dbs: asc(c.rows.flatMap((r) => (r.m.dbIndex != null ? [r.m.dbIndex] : []))), ttl: { values: asc(c.rows.flatMap((r) => (r.m.ttlSeconds != null ? [r.m.ttlSeconds] : []))) },
      steps: asc(c.rows.map((r) => r.n)), reason: c.head.kind === 'unreported' ? reasons.join(', ') || null : null,
      ops: [...ops.values()].map((o) => ({ access: o.access, op: o.op, steps: asc(o.rows.map((r) => r.n)), fields: redis ? [] : fieldsOf(o.rows.map((r) => r.m)), links: linksOf(trace, o.rows) }))
        .sort((a, b) => a.steps[0] - b.steps[0]) };
  }).sort((a, b) => a.steps[0] - b.steps[0]);
  if (redis) { const u = out.findIndex((c) => c.kind === 'unreported'); if (u >= 0) out.push(...out.splice(u, 1)); } // "Key not reported" is last
  const dbs = asc(out.flatMap((c) => c.dbs)), one = [...colls][0] ?? store;
  return { kind, group: target.group, store, folded, cards: out, db: dbs.length === 1 ? dbs[0] : null, total, stepCount: asc(rows.map((r) => r.n)).length,
    keyCount: out.filter((c) => c.kind !== 'unreported').length, unreported: out.some((c) => c.kind === 'unreported'),
    title: redis ? store : folded ? `${store} (${colls.size} collections)` : one,
    sub: redis ? `Redis instance${dbs.length === 1 ? ` · db ${dbs[0]}` : dbs.length > 1 ? ` · db ${dbs.join(', ')}` : ''}` : folded ? `${store} · ${colls.size} collections` : `${store} · collection ${one}` };
}

/** The first CHIP_CAP steps, or all of them when expanded; `more` is how many are hidden. */
export const capSteps = (steps: number[], expanded: boolean, cap = CHIP_CAP) => (expanded || steps.length <= cap ? { shown: steps, more: 0 } : { shown: steps.slice(0, cap), more: steps.length - cap });

/** "1 h", "30 min", "90 s": the whole-unit form of a TTL in seconds. */
export const humanTtl = (s: number) => (s >= 3600 && s % 3600 === 0 ? `${s / 3600} h` : s >= 120 && s % 60 === 0 ? `${s / 60} min` : `${s} s`);
/** The TTL of a Redis card header: `text` ("60 s", "1 h", "60 s / 3600 s", "not reported") and `note` ("3600 s" after a human form; "steps disagree"). */
export function ttlLine(t: Ttl): { text: string; note: string | null } {
  if (!t.values.length) return { text: 'not reported', note: null };
  if (t.values.length > 1) return { text: t.values.map((v) => `${v} s`).join(' / '), note: 'steps disagree' };
  const v = t.values[0], h = humanTtl(v);
  return { text: h, note: h === `${v} s` ? null : `${v} s` };
}

/** The summary line as segments (`{ b }` is bold). */
export function summary(p: Panel): (string | { b: string })[] {
  const steps = { b: `${p.stepCount} of ${p.total} steps` }, n = p.keyCount, noun = p.kind === 'redis' ? 'key' : 'collection';
  if (p.kind === 'redis' && n === 0) return ['This flow touches this store in ', steps, ', with no key reported.'];
  return ['This flow touches ', { b: `${n} ${noun}${n === 1 ? '' : 's'}` }, ' in this store, in ', steps, '.', ...(p.unreported ? [' ', { b: '1 key' }, ' not reported.'] : [])];
}

// ---- the keys registry join ----
export interface RegUse { service: string; access: string }
export interface RegRow { keyTemplate: string; dbIndex?: number; description?: string; ttl?: { seconds: number | null; values?: { service: string; ttlSeconds: number }[]; disagree?: boolean }; writers?: RegUse[]; readers?: RegUse[] }
export interface RegGroup { kind?: string; owner?: string; rows: RegRow[] }
export interface RegMatch { owner: string; shared: boolean; description: string | null; ttl: string | null; usedBy: string }

/** The registry row of a key template: exact, case-sensitive equality; the db must agree when both sides have one. No fuzzy or prefix matching. */
export function matchRegistry(groups: RegGroup[] | null | undefined, template: string | null, dbs: number[] = []): RegMatch | null {
  if (!template) return null;
  for (const g of groups ?? []) for (const r of g.rows ?? []) {
    if (r.keyTemplate !== template || (dbs.length && r.dbIndex != null && !dbs.includes(r.dbIndex))) continue;
    const uses = new Map<string, Set<string>>(), order = ['read', 'write'];
    for (const u of [...(r.writers ?? []), ...(r.readers ?? [])]) { if (!uses.has(u.service)) uses.set(u.service, new Set()); (u.access === 'read_write' ? ['read', 'write'] : [u.access]).forEach((a) => uses.get(u.service)!.add(a)); }
    const vals = [...new Set((r.ttl?.values ?? []).map((v) => v.ttlSeconds))].sort((a, b) => a - b);
    return { owner: g.kind === 'shared' ? 'shared' : g.owner ?? '', shared: g.kind === 'shared', description: r.description?.trim() || null,
      ttl: r.ttl?.disagree ? `writers disagree: ${vals.map((v) => `${v} s`).join(', ')}` : r.ttl?.seconds != null ? `${r.ttl.seconds} s, all writers agree` : null,
      usedBy: [...uses].map(([s, a]) => `${s} (${[...a].sort((x, y) => order.indexOf(x) - order.indexOf(y)).join(', ')})`).join(', ') };
  }
  return null;
}
