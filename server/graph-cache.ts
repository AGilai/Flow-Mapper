// Caches the resolved GraphIndex per environment, and per open draft (key `env#draft:<slug>`), in ONE LRU; any write
// invalidates that environment and every draft view of it. Writes by another process (a seed script, a second server on
// the same file) are noticed through SQLite's data_version, which changes when another connection commits; then everything
// is rebuilt. Also keeps a small memo (the marks of an environment, keyed by what they depend on) and records per-service
// health after each write so the UI can show a trend per version.

import type { DB } from './db/connection.ts';
import { buildIndex, type GraphIndex } from '../core/graph-index.ts';
import { healthCounts } from '../core/health.ts';
import { rowsToModel } from '../core/item-rows.ts';
import { dbReader, rowsReader, type DataReader } from './draft-reader.ts';
import { draftView } from './store/drafts.ts';
import { loadModel } from './store/snapshots.ts';
import { config } from './config.ts';

interface Entry { g: GraphIndex; reader?: DataReader; weight: number }
const weightOf = (g: GraphIndex) => g.model.functions.length + g.model.ingress.length + g.model.egress.length;
const cache = new Map<string, Entry>();
const memo = new Map<string, { value: unknown; deps: Set<string> }>();
const MEMO_MAX = 64;
let max = config.graphCacheMax; // LRU bound by count: the Map keeps insertion order, a hit re-inserts
let budget = config.graphCacheItems; // and by weight; the newest entry always stays, even if it alone is over budget
const weight = () => { let w = 0; for (const e of cache.values()) w += e.weight; return w; };
let seenVersion: number | null = null;

/** Drop everything cached if another process wrote to the database since we last looked. Reads that cache on their own (the marks memo) call this first. */
export function checkFresh(db: DB) { dropIfChangedElsewhere(db); }

function dropIfChangedElsewhere(db: DB) {
  const v = (db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
  if (seenVersion !== null && v !== seenVersion) { cache.clear(); memo.clear(); }
  seenVersion = v;
}

function lru(key: string, build: () => Entry): Entry {
  let e = cache.get(key);
  if (e) cache.delete(key);
  else e = build();
  cache.set(key, e);
  trim();
  return e;
}

/** Evict the least recently used graphs while over the count or the weight budget (logged), never the newest. */
function trim() {
  while (cache.size > 1 && (cache.size > max || weight() > budget)) {
    const [k, e] = cache.entries().next().value!;
    cache.delete(k);
    console.log(`flow-mapper: graph cache evicted ${k} (${e.weight} items; ${cache.size} cached, ${weight()} of ${budget} items)`);
  }
}

export function graphFor(db: DB, env: string): GraphIndex {
  dropIfChangedElsewhere(db);
  return lru(env, () => { const g = buildIndex(loadModel(db, env)); return { g, weight: weightOf(g) }; }).g;
}

/** The graph and the non-graph reader of an environment, or of an environment as an open draft would leave it. */
export function viewFor(db: DB, env: string, slug: string | null): { g: GraphIndex; reader: DataReader } {
  if (!slug) return { g: graphFor(db, env), reader: dbReader(db, env) };
  dropIfChangedElsewhere(db);
  const e = lru(`${env}#draft:${slug}`, () => { const { rows } = draftView(db, env, slug); const g = buildIndex(rowsToModel(env, rows)); return { g, weight: weightOf(g), reader: rowsReader(rows, dbReader(db, env)) }; });
  return { g: e.g, reader: e.reader! };
}

/** Number of cached graphs (environments and drafts). */
export const size = () => cache.size;

/** Change the LRU bound (tests; the default comes from FLOW_GRAPH_CACHE_MAX). */
export function setMax(n: number) { max = Math.max(1, n); trim(); }

/** Change the weight budget (tests; the default comes from FLOW_GRAPH_CACHE_ITEMS). */
export function setBudget(items: number) { budget = Math.max(1, items); trim(); }

/** Total weight of the cached graphs (functions + ingress + egress). */
export const cachedItems = weight;

/** An environment changed: its graph, every draft view of it and every memo that depends on it are dropped. */
export function invalidate(env: string) {
  for (const k of [...cache.keys()]) if (k === env || k.startsWith(`${env}#`)) cache.delete(k);
  for (const [k, m] of [...memo]) if (m.deps.has(env)) memo.delete(k);
}
/** Everything cached is stale (a user merge re-points owners and About mentions in every environment). */
export function invalidateAll() { cache.clear(); memo.clear(); }
export function invalidateDraft(env: string, slug: string) {
  cache.delete(`${env}#draft:${slug}`);
  for (const [k, m] of [...memo]) if (k.startsWith(`${env}|${slug}|`)) memo.delete(k);
}

/** A memoised value with the environments it depends on (dropped by `invalidate` of any of them). */
export function memoGet<T>(key: string): T | undefined { return memo.get(key)?.value as T | undefined; }
export function memoSet<T>(key: string, value: T, deps: string[]): T {
  memo.set(key, { value, deps: new Set(deps) });
  while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value!);
  return value;
}

/**
 * Call after a write to `env`. Stores health for every service whose numbers changed.
 * `built`: the graph the writer already built from the committed data (an ingest does, for its contract report);
 * it goes into the cache instead of being built a second time. Never pass one built from uncommitted or dry-run data.
 */
export function afterWrite(db: DB, env: string, built?: GraphIndex) {
  invalidate(env);
  if (built) dropIfChangedElsewhere(db);
  const g = built ? lru(env, () => ({ g: built, weight: weightOf(built) })).g : graphFor(db, env);
  const services = healthCounts(g);
  const at = new Date().toISOString();
  const last = db.prepare('SELECT egress, dangling, orphans, unbound FROM health_history WHERE env = ? AND service = ? ORDER BY version DESC LIMIT 1');
  const ins = db.prepare(`INSERT INTO health_history (env, service, version, at, egress, dangling, orphans, unbound) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (env, service, version) DO UPDATE SET at = excluded.at, egress = excluded.egress, dangling = excluded.dangling, orphans = excluded.orphans, unbound = excluded.unbound`);
  for (const s of services) {
    const prev = last.get(env, s.service) as any;
    if (prev && prev.egress === s.egress && prev.dangling === s.dangling && prev.orphans === s.orphans && prev.unbound === s.unbound) continue;
    ins.run(env, s.service, s.version, at, s.egress, s.dangling, s.orphans, s.unbound);
  }
}

export function healthHistory(db: DB, env: string, service?: string) {
  return service
    ? db.prepare('SELECT * FROM health_history WHERE env = ? AND service = ? ORDER BY version').all(env, service)
    : db.prepare('SELECT * FROM health_history WHERE env = ? ORDER BY service, version').all(env);
}
