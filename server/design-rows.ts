// The rows a design environment is read from: its baseline (frozen at copy time, plus what an open draft's import ops brought) and
// its current rows (with the draft laid over them if asked). Shared by marks and references; the loads are memoised per environment.

import type { Ctx } from './context.ts';
import { netOps, overlayRows } from '../core/draft-ops.ts';
import { importBaseline, type OriginRow } from '../core/import-baseline.ts';
import { rowId, type ItemRow } from '../core/item-rows.ts';
import { memoGet, memoSet } from './graph-cache.ts';
import { getDraft, loadOps } from './store/drafts.ts';
import { baselineRows, envItemRows, type BaselineRow } from './store/item-rows.ts';

export const cached = <T>(key: string, deps: string[], load: () => T): T => memoGet<T>(key) ?? memoSet(key, load(), deps);

export interface DesignRows {
  /** The baseline as stored. */
  stored: BaselineRow[];
  /** What the draft's import ops brought (their baseline until the draft is applied). */
  imported: OriginRow[];
  /** `stored`, with the imported rows laid over it (by row). */
  base: BaselineRow[];
  /** The environment's rows, with the draft laid over them. */
  cur: ItemRow[];
  /** Environments these rows came from: marks and references depend on them. */
  deps: string[];
}

export function designRows(ctx: Ctx, env: string, draft: string | null): DesignRows {
  const { db } = ctx;
  const stored = cached<BaselineRow[]>(`baseline:${env}`, [env], () => baselineRows(db, env));
  const envRows = cached<ItemRow[]>(`rows:${env}`, [env], () => envItemRows(db, env));
  let cur = envRows, imported: OriginRow[] = [], base = stored;
  if (draft) {
    const ops = loadOps(db, getDraft(db, env, draft).id);
    cur = overlayRows(envRows, netOps(ops));
    imported = importBaseline(ops, new Set(cur.map(rowId)));
    if (imported.length) { const own = new Set(imported.map(rowId)); base = [...stored.filter((r) => !own.has(rowId(r))), ...imported]; }
  }
  return { stored, imported, base, cur, deps: [...new Set([env, ...base.map((r) => r.sourceEnv)])] };
}
