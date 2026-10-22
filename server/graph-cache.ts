// Caches the resolved GraphIndex per environment, and per open draft (key `env#draft:<slug>`), in ONE LRU; any write
// invalidates that environment and every draft view of it. Writes by another process (a seed script, a second server on
// the same file) are noticed through SQLite's data_version, which changes when another connection commits; then everything
// is rebuilt. Also keeps a small memo (the marks of an environment, keyed by what they depend on) and records per-service
// health after each write so the UI can show a trend per version.

import type { DB } from './db/connection.ts';
import { buildIndex, type GraphIndex } from '../core/graph-index.ts';
import { health } from '../core/health.ts';
import { rowsToModel } from '../core/item-rows.ts';
import { dbReader, rowsReader, type DataReader } from './draft-reader.ts';
import { draftView } from './store/drafts.ts';
import { loadModel } from './store/snapshots.ts';
import { config } from './config.ts';

interface Entry { g: GraphIndex; reader?: DataReader }
const cache = new Map<string, Entry>();
const memo = new Map<string, { value: unknown; deps: Set<string> }>();
const MEMO_MAX = 64;
let max = config.graphCacheMax; // LRU bound: the Map keeps insertion order, a hit re-inserts
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
  while (cache.size > max) cache.delete(cache.keys().next().value!);
  return e;
}

export function graphFor(db: DB, env: string): GraphIndex {
  dropIfChangedElsewhere(db);
  return lru(env, () => ({ g: buildIndex(loadModel(db, env)) })).g;
}

/** The graph and the non-graph reader of an environment, or of an environment as an open draft would leave it. */
export function viewFor(db: DB, env: string, slug: string | null): { g: GraphIndex; reader: DataReader } {
  if (!slug) return { g: graphFor(db, env), reader: dbReader(db, env) };
  dropIfChangedElsewhere(db);
  const e = lru(`${env}#draft:${slug}`, () => { const { rows } = draftView(db, env, slug); return { g: buildIndex(rowsToModel(env, rows)), reader: rowsReader(rows, dbReader(db, env)) }; });
  return { g: e.g, reader: e.reader! };
}

/** Number of cached graphs (environments and drafts). */
export const size = () => cache.size;

/** Change the LRU bound (tests; the default comes from FLOW_GRAPH_CACHE_MAX). */
export function setMax(n: number) { max = Math.max(1, n); while (cache.size > max) cache.delete(cache.keys().next().value!); }

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

/** Call after a write to `service` in `env`. Stores health for every service whose numbers changed. */
export function afterWrite(db: DB, env: string) {
  invalidate(env);
  const report = health(graphFor(db, env));
  const at = new Date().toISOString();
  const last = db.prepare('SELECT egress, dangling, orphans, unbound FROM health_history WHERE env = ? AND service = ? ORDER BY version DESC LIMIT 1');
  const ins = db.prepare(`INSERT INTO health_history (env, service, version, at, egress, dangling, orphans, unbound) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (env, service, version) DO UPDATE SET at = excluded.at, egress = excluded.egress, dangling = excluded.dangling, orphans = excluded.orphans, unbound = excluded.unbound`);
  for (const s of report.services) {
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
