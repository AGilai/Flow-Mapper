// Marks of a design environment: new / changed / removed per anchor, against the frozen baseline or against the source as it
// is now, with an open draft laid over the environment if asked. Marks are their own endpoint (traces, service views and the
// inventory stay as they are); the pages decorate themselves from this. A sealed environment has no baseline: empty result.
// The environment's rows and the baseline are memoised (a draft edit then costs the overlay and the diff, not a reload).

import type { Ctx } from './context.ts';
import { diffEnv, type DiffOpts, type EnvMarks } from '../core/diff/index.ts';
import { calleeIndex } from '../core/diff/callee.ts';
import { netOps, overlayRows } from '../core/draft-ops.ts';
import type { ItemRow } from '../core/item-rows.ts';
import { badRequest, conflict, notFound } from './errors.ts';
import { checkFresh, memoGet, memoSet } from './graph-cache.ts';
import { getEnvRow } from './store/envs.ts';
import { getDraft, loadOps } from './store/drafts.ts';
import { baselineRows, envItemRows, sourceNowRows, type BaselineRow } from './store/item-rows.ts';

export type Against = 'baseline' | 'source';
export const againstOf = (v: string | null | undefined): Against => {
  if (v === undefined || v === null || v === '' || v === 'baseline') return 'baseline';
  if (v === 'source') return 'source';
  throw badRequest("against must be 'baseline' or 'source'");
};

const cached = <T>(key: string, deps: string[], load: () => T): T => memoGet<T>(key) ?? memoSet(key, load(), deps);

export function marksFor(ctx: Ctx, env: string, opts: { against?: Against; draft?: string | null } = {}): EnvMarks {
  const { db } = ctx, against = opts.against ?? 'baseline', draft = opts.draft || null;
  checkFresh(db);
  const row = getEnvRow(db, env);
  if (!row) throw notFound(`environment '${env}'`);
  const d = draft ? getDraft(db, env, draft) : null;
  const key = `${env}|${draft ?? ''}|${against}`;
  const hit = memoGet<EnvMarks>(key);
  if (hit) return hit;
  const dopts: DiffOpts = { against, draft, source: row.source, baselineAt: row.copied_at };
  if (row.kind === 'sealed') return memoSet(key, diffEnv([], [], { ...dopts, source: null, baselineAt: null }), [env]);

  const base = cached<BaselineRow[]>(`baseline:${env}`, [env], () => baselineRows(db, env));
  const envRows = cached<ItemRow[]>(`rows:${env}`, [env], () => envItemRows(db, env));
  const cur = d ? overlayRows(envRows, netOps(loadOps(db, d.id))) : envRows;
  const deps = new Set([env, ...base.map((r) => r.sourceEnv)]);
  let reference: ItemRow[] = base;
  if (against === 'source') {
    if (!row.source || !db.prepare('SELECT 1 FROM envs WHERE name = ?').get(row.source)) throw conflict('NO_SOURCE', `the source environment '${row.source ?? ''}' of '${env}' no longer exists: compare against the baseline instead`);
    const now = sourceNowRows(db, env, base);
    reference = now.rows;
    dopts.vanished = now.vanished;
  }
  dopts.calleeOf = calleeIndex(cur);
  return memoSet(key, diffEnv(reference, cur, dopts), [...deps]);
}

