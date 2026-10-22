// The rows of an environment for the draft operations (perf batch 3, F8). Reading them is 110k entity rows plus a JSON.parse each at 1,000
// services (about 2 s), and appendOps, the draft info, the changes and the list each did it again. This keeps the last rows of two environments.
//
// Freshness is not tracked by invalidation calls (several writers never call them: DTOs, schemas, another process) but by two counters that
// move on every write: `total_changes()` (every row this connection changed, kept even by a rollback) and `PRAGMA data_version` (another
// connection committed). A cached value is used only while both are what they were when it was read. The one write the draft operations
// make themselves (draft_ops, drafts, env colours: never part of the rows) calls `rebase`, so the next operation hits the cache too.
// A read inside a transaction is never stored (a dry run or a failed transaction rolls back, and the counters do not).
// The rows are shared: callers read them, never change them (overlayRows and the diff copy).

import type { DB } from '../db/connection.ts';
import type { ItemRow } from '../../core/item-rows.ts';
import { envItemRows } from './item-rows.ts';

interface Entry { rows: ItemRow[]; tc: number; dv: number }
const caches = new WeakMap<DB, Map<string, Entry>>(); // per connection: two databases in one process never share counters
const cacheOf = (db: DB) => { let m = caches.get(db); if (!m) caches.set(db, (m = new Map())); return m; };
const MAX = 2; // one 1,000-service env is tens of MB of parsed rows

const counters = (db: DB) => ({
  tc: Number((db.prepare('SELECT total_changes() AS n').get() as { n: number | bigint }).n),
  dv: Number((db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version),
});

/** `envItemRows(db, env)`, from the cache while nothing was written since it was read. */
export function envRowsOf(db: DB, env: string): ItemRow[] {
  const cache = cacheOf(db), c = counters(db), hit = cache.get(env);
  if (hit && hit.tc === c.tc && hit.dv === c.dv) { cache.delete(env); cache.set(env, hit); return hit.rows; }
  cache.delete(env);
  const rows = envItemRows(db, env);
  if (!(db as any).isTransaction) { cache.set(env, { rows, ...c }); while (cache.size > MAX) cache.delete(cache.keys().next().value!); }
  return rows;
}

/** The counter right after reading the rows: give it to `rebase` once the caller has written. */
export const changesNow = (db: DB) => counters(db).tc;

/** The caller wrote only rows that are not part of `rows` (draft ops, env colours): they stay valid. A no-op unless `rows` is the cached array and nothing else wrote since `tcBefore`. */
export function rebase(db: DB, env: string, rows: ItemRow[], tcBefore: number) {
  const e = cacheOf(db).get(env), c = counters(db);
  if (e && e.rows === rows && e.tc === tcBefore && e.dv === c.dv) e.tc = c.tc;
}

/** Tests. */
export const cachedEnvRows = (db: DB) => cacheOf(db).size;
