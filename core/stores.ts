// Data stores: MongoDB collections, Redis key patterns, DynamoDB tables, Postgres tables, S3 buckets.
// A store is identified by its bind key; services that declare the same key share it. The part of
// the key before the first '/' is its group: the cluster or database (`mongodb:orders-db`,
// `redis:cache-main`). Each use is classified as a read or a write from its operation.

import type { GraphIndex } from './graph-index.ts';
import { codeLink, sourceLink, type SourceLink } from './endpoint-info.ts';
import { entryPointsReaching, type EntryHit } from './reach.ts';
import { unresolvedTarget } from './resolve.ts';
import type { Resource, Step, StepField } from './types.ts';

export type Access = 'read' | 'write' | 'read_write' | 'unknown';

const READ = /^(get|mget|hget|hgetall|hmget|exists|ttl|pttl|keys|scan|smembers|sismember|lrange|zrange|zscore|find|findone|count|countdocuments|aggregate|distinct|query|select|read|list|head|headobject|getobject|getitem|batchgetitem|describe)\b/i;

/** Read or write, from the step's `access` or else its operation's first word. */
export function accessOf(step: Step): Access {
  if (step.access) return step.access;
  const op = step.operation?.trim();
  if (!op) return 'unknown';
  return READ.test(op) ? 'read' : 'write';
}

/** A resource whose harvester says its key is unresolved stands alone (never grouped by a key), like an unresolved ingress matches nothing. */
export const storeKey = (r: Resource) => (unresolvedTarget(r) ? undefined : r.bindKey) ?? `${r.service}:${r.id}`;
/** `mongodb:orders-db/orders` → `mongodb:orders-db`; keys without '/' are their own group. */
export const groupOf = (key: string) => (key.includes('/') ? key.slice(0, key.indexOf('/')) : key);
const leafName = (key: string) => (key.includes('/') ? key.slice(key.indexOf('/') + 1) : key);

export interface StoreUse {
  service: string; resource: string; access: Access; declaredAt: SourceLink | null; verified: string | null;
  functions: { fn: string; name: string; source: SourceLink | null; operations: { operation: string; access: Access; fields?: StepField[] }[] }[];
}
/** The collection is known but the DB instance id is not (`unresolved` what 'instance', or the older `details.instance` {id: null, text, reason}). Does not change the store key. */
export function instanceUnknown(r: Resource): { reason: string; detail?: string } | undefined {
  const u = r.unresolved?.find((x) => x.what === 'instance');
  if (u) return { reason: u.reason, detail: u.detail };
  const d = r.details?.instance as { id?: unknown; text?: string; reason?: string } | undefined;
  return d && typeof d === 'object' && d.id == null && d.reason ? { reason: d.reason, detail: d.text } : undefined;
}

export interface StoreSummary { key: string; name: string; kind: string; group: string; services: string[]; readers: string[]; writers: string[]; used: boolean;
  /** Why the harvester could not give this store a key (its `unresolved` reason). */ keyUnknown?: string;
  /** The DB instance is not known yet; the key is unaffected. */ instanceUnknown?: { reason: string; detail?: string } }
export interface StoreView extends StoreSummary {
  details: Record<string, unknown>; uses: StoreUse[]; entryPoints: EntryHit[]; siblings: StoreSummary[];
}

export const usesOf = (g: GraphIndex, r: Resource) => g.model.functions
  .filter((f) => f.service === r.service)
  .map((f) => ({ f, steps: f.steps.filter((s) => s.type === 'resource' && s.target === r.id) }))
  .filter((x) => x.steps.length);

export const mergeAccess = (a: Access, b: Access): Access => (a === b ? a : a === 'unknown' ? b : b === 'unknown' ? a : a === 'read_write' || b === 'read_write' ? 'read_write' : 'write');

/** A Redis resource whose key names the instance and no key pattern (`redis:cache-main`), declared by an infra service or never used by a step:
 *  it defines the instance (#29), it is not a store, and no service "connects" through it. */
export function instanceDef(g: GraphIndex, r: Resource): boolean {
  if (r.kind !== 'redis' || !r.bindKey || r.bindKey.includes('/') || unresolvedTarget(r)) return false;
  return g.services.get(r.service)?.kind === 'infra' || !usesOf(g, r).length;
}

/** Every store with who reads and who writes it. */
export function stores(g: GraphIndex): StoreSummary[] {
  const by = new Map<string, StoreSummary>();
  for (const r of g.model.resources) {
    if (instanceDef(g, r)) continue;
    const key = storeKey(r);
    const s = by.get(key) ?? { key, name: r.bindKey && !unresolvedTarget(r) ? leafName(key) : r.name, kind: r.kind, group: groupOf(key), services: [], readers: [], writers: [], used: false, keyUnknown: unresolvedTarget(r)?.reason };
    s.instanceUnknown ??= instanceUnknown(r);
    by.set(key, s);
    if (!s.services.includes(r.service)) s.services.push(r.service);
    for (const { steps } of usesOf(g, r)) {
      s.used = true;
      for (const st of steps) {
        const a = accessOf(st);
        for (const [on, list] of [[a === 'read' || a === 'read_write', s.readers], [a === 'write' || a === 'read_write', s.writers]] as const) {
          if (on && !list.includes(r.service)) list.push(r.service);
        }
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
      operations: steps.map((s) => ({ operation: s.operation ?? 'use', access: accessOf(s), ...(s.fields?.length ? { fields: s.fields } : {}) })),
    }));
    const access = functions.flatMap((f) => f.operations).reduce<Access>((a, o) => mergeAccess(a, o.access), 'unknown');
    return { service: r.service, resource: r.id, access, functions, declaredAt: codeLink(svc, r.source), verified: r.provenance?.verified ?? null };
  });
  return {
    ...summary,
    details: Object.assign({}, ...decls.map((r) => r.details ?? {})),
    uses,
    entryPoints: entryPointsReaching(g, uses.flatMap((u) => u.functions.map((f) => ({ service: u.service, fn: f.fn })))),
    siblings: all.filter((s) => s.group === summary.group && s.key !== key),
  };
}
