// A small memo of read results that is valid until the database is written (perf batch 3, F11). The key: `total_changes()` (every row this
// connection changed, kept by a rollback too) and `PRAGMA data_version` (another connection committed) must be what they were when the value was
// computed. Nothing has to call an invalidation, so no writer can forget to. A value computed inside a transaction is not kept.

import type { DB } from '../db/connection.ts';

interface Entry { tc: number; dv: number; value: unknown }
const memos = new WeakMap<DB, Map<string, Entry>>();
const MAX = 64;

export const stamp = (db: DB) => ({
  tc: Number((db.prepare('SELECT total_changes() AS n').get() as { n: number | bigint }).n),
  dv: Number((db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version),
});

/** `compute()` once per `key` between writes. The value is shared: callers must not change it. */
export function sinceWrite<T>(db: DB, key: string, compute: () => T): T {
  let m = memos.get(db);
  if (!m) memos.set(db, (m = new Map()));
  const s = stamp(db), hit = m.get(key);
  if (hit && hit.tc === s.tc && hit.dv === s.dv) return hit.value as T;
  m.delete(key);
  const value = compute();
  if (!(db as any).isTransaction) { m.set(key, { ...s, value }); while (m.size > MAX) m.delete(m.keys().next().value!); }
  return value;
}
