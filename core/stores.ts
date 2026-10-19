// Data stores: MongoDB collections, Redis key patterns, DynamoDB tables, Postgres tables, S3 buckets.
// A store is identified by its bind key; services that declare the same key share it. The part of
// the key before the first '/' is its group: the cluster or database (`mongodb:orders-db`,
// `redis:cache-main`). Each use is classified as a read or a write from its operation.

import type { GraphIndex } from './graph-index.ts';
import { sourceLink, type SourceLink } from './endpoint-info.ts';
import { entryPointsReaching, type EntryHit } from './reach.ts';
import type { Resource, Step } from './types.ts';

export type Access = 'read' | 'write' | 'unknown';

const READ = /^(get|mget|hget|hgetall|hmget|exists|ttl|pttl|keys|scan|smembers|sismember|lrange|zrange|zscore|find|findone|count|countdocuments|aggregate|distinct|query|select|read|list|head|headobject|getobject|getitem|batchgetitem|describe)\b/i;

/** Read or write, from the step's `access` or else its operation's first word. */
export function accessOf(step: Step): Access {
  if (step.access) return step.access;
  const op = step.operation?.trim();
  if (!op) return 'unknown';
  return READ.test(op) ? 'read' : 'write';
}

export const storeKey = (r: Resource) => r.bindKey ?? `${r.service}:${r.id}`;
/** `mongodb:orders-db/orders` → `mongodb:orders-db`; keys without '/' are their own group. */
export const groupOf = (key: string) => (key.includes('/') ? key.slice(0, key.indexOf('/')) : key);
const leafName = (key: string) => (key.includes('/') ? key.slice(key.indexOf('/') + 1) : key);

export interface StoreUse {
  service: string; resource: string; access: Access;
  functions: { fn: string; name: string; source: SourceLink | null; operations: { operation: string; access: Access }[] }[];
}
export interface StoreSummary { key: string; name: string; kind: string; group: string; services: string[]; readers: string[]; writers: string[]; used: boolean }
export interface StoreView extends StoreSummary {
  details: Record<string, unknown>; uses: StoreUse[]; entryPoints: EntryHit[]; siblings: StoreSummary[];
}

const usesOf = (g: GraphIndex, r: Resource) => g.model.functions
  .filter((f) => f.service === r.service)
  .map((f) => ({ f, steps: f.steps.filter((s) => s.type === 'resource' && s.target === r.id) }))
  .filter((x) => x.steps.length);

const merge = (a: Access, b: Access): Access => (a === b ? a : a === 'unknown' ? b : b === 'unknown' ? a : 'write');

/** Every store with who reads and who writes it. */
export function stores(g: GraphIndex): StoreSummary[] {
  const by = new Map<string, StoreSummary>();
  for (const r of g.model.resources) {
    const key = storeKey(r);
    const s = by.get(key) ?? { key, name: r.bindKey ? leafName(key) : r.name, kind: r.kind, group: groupOf(key), services: [], readers: [], writers: [], used: false };
    by.set(key, s);
    if (!s.services.includes(r.service)) s.services.push(r.service);
    for (const { steps } of usesOf(g, r)) {
      s.used = true;
      for (const st of steps) {
        const a = accessOf(st);
        const list = a === 'read' ? s.readers : a === 'write' ? s.writers : null;
        if (list && !list.includes(r.service)) list.push(r.service);
      }
    }
  }
  return [...by.values()].sort((a, b) => a.group.localeCompare(b.group) || a.key.localeCompare(b.key));
}

export function storeView(g: GraphIndex, key: string): StoreView | null {
  const all = stores(g);
  const summary = all.find((s) => s.key === key);
  if (!summary) return null;
  const decls = g.model.resources.filter((r) => storeKey(r) === key);
  const uses: StoreUse[] = decls.map((r) => {
    const svc = g.services.get(r.service)!;
    const functions = usesOf(g, r).map(({ f, steps }) => ({
      fn: f.id, name: f.name, source: sourceLink(svc, f),
      operations: steps.map((s) => ({ operation: s.operation ?? 'use', access: accessOf(s) })),
    }));
    const access = functions.flatMap((f) => f.operations).reduce<Access>((a, o) => merge(a, o.access), 'unknown');
    return { service: r.service, resource: r.id, access, functions };
  });
  return {
    ...summary,
    details: Object.assign({}, ...decls.map((r) => r.details ?? {})),
    uses,
    entryPoints: entryPointsReaching(g, uses.flatMap((u) => u.functions.map((f) => ({ service: u.service, fn: f.fn })))),
    siblings: all.filter((s) => s.group === summary.group && s.key !== key),
  };
}
