// Apply of a draft: what the draft imported becomes baseline rows of the environment (the frozen "what it was taken from", source env and
// version per row), so the imported items read as unchanged until someone edits them. Runs inside the apply's transaction.

import type { DB } from '../db/connection.ts';
import type { DraftOp } from '../../core/draft-ops.ts';
import { importBaseline } from '../../core/import-baseline.ts';
import { rowId } from '../../core/item-rows.ts';
import { envItemRows } from './item-rows.ts';

/** Returns how many rows were written. Call after the environment's own rows are written (only rows that exist there are kept). */
export function writeImportBaseline(db: DB, env: string, ops: DraftOp[]): number {
  const rows = importBaseline(ops, new Set(envItemRows(db, env).map(rowId)));
  const ins = db.prepare('INSERT OR REPLACE INTO baseline_items (env, service, list, key, data, source_env, source_version, taken_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const r of rows) ins.run(env, r.service, r.list, r.key, JSON.stringify(r.data), r.sourceEnv, r.sourceVersion, r.takenAt);
  return rows.length;
}
