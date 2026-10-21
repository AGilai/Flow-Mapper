// Caches the resolved GraphIndex per environment; any write invalidates that environment. Writes by
// another process (a seed script, a second server on the same file) are noticed through SQLite's
// data_version, which changes when another connection commits; then every environment is rebuilt.
// Also records per-service health after each write so the UI can show a trend per version.

import type { DB } from './db/connection.ts';
import { buildIndex, type GraphIndex } from '../core/graph-index.ts';
import { health } from '../core/health.ts';
import { loadModel } from './store/snapshots.ts';
import { config } from './config.ts';

const cache = new Map<string, GraphIndex>();
let max = config.graphCacheMax; // LRU bound: the Map keeps insertion order, a hit re-inserts
let seenVersion: number | null = null;

function dropIfChangedElsewhere(db: DB) {
  const v = (db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
  if (seenVersion !== null && v !== seenVersion) cache.clear();
  seenVersion = v;
}

export function graphFor(db: DB, env: string): GraphIndex {
  dropIfChangedElsewhere(db);
  let g = cache.get(env);
  if (g) cache.delete(env);
  else g = buildIndex(loadModel(db, env));
  cache.set(env, g);
  while (cache.size > max) cache.delete(cache.keys().next().value!);
  return g;
}

/** Number of cached environments. */
export const size = () => cache.size;

/** Change the LRU bound (tests; the default comes from FLOW_GRAPH_CACHE_MAX). */
export function setMax(n: number) { max = Math.max(1, n); while (cache.size > max) cache.delete(cache.keys().next().value!); }

export function invalidate(env: string) {
  cache.delete(env);
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
