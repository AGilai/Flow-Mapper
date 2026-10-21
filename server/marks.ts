// Marks of a design environment: new / changed / removed per anchor, against the frozen baseline or against the source as it
// is now, with an open draft laid over the environment if asked. Marks are their own endpoint (traces, service views and the
// inventory stay as they are); the pages decorate themselves from this, and from `refs` (references: core/references.ts).
// A sealed environment has no baseline: empty result. The environment's rows and the baseline are memoised (a draft edit then
// costs the overlay and the diff, not a reload).

import type { Ctx } from './context.ts';
import { diffEnv, type DiffOpts, type EnvMarks } from '../core/diff/index.ts';
import { calleeIndex } from '../core/diff/callee.ts';
import { badRequest, conflict, notFound } from './errors.ts';
import { checkFresh, memoGet, memoSet } from './graph-cache.ts';
import { designRows } from './design-rows.ts';
import { refsFor } from './refs.ts';
import { getEnvRow } from './store/envs.ts';
import { getDraft } from './store/drafts.ts';
import { sourceNowRows } from './store/item-rows.ts';

export { cached } from './design-rows.ts';
export type Against = 'baseline' | 'source';
export const againstOf = (v: string | null | undefined): Against => {
  if (v === undefined || v === null || v === '' || v === 'baseline') return 'baseline';
  if (v === 'source') return 'source';
  throw badRequest("against must be 'baseline' or 'source'");
};

export function marksFor(ctx: Ctx, env: string, opts: { against?: Against; draft?: string | null } = {}): EnvMarks {
  const { db } = ctx, against = opts.against ?? 'baseline', draft = opts.draft || null;
  checkFresh(db);
  const row = getEnvRow(db, env);
  if (!row) throw notFound(`environment '${env}'`);
  if (draft) getDraft(db, env, draft);
  const key = `${env}|${draft ?? ''}|${against}`;
  const hit = memoGet<EnvMarks>(key);
  if (hit) return hit;
  const dopts: DiffOpts = { against, draft, source: row.source, baselineAt: row.copied_at };
  if (row.kind === 'sealed') return memoSet(key, { ...diffEnv([], [], { ...dopts, source: null, baselineAt: null }), refs: refsFor(ctx, env, draft) }, [env]);

  const d = designRows(ctx, env, draft);
  let reference = d.base;
  if (against === 'source') {
    if (!row.source || !db.prepare('SELECT 1 FROM envs WHERE name = ?').get(row.source)) throw conflict('NO_SOURCE', `the source environment '${row.source ?? ''}' of '${env}' no longer exists: compare against the baseline instead`);
    const now = sourceNowRows(db, env, d.base, row.copied_at);
    reference = now.rows;
    dopts.vanished = now.vanished;
  }
  dopts.calleeOf = calleeIndex(d.cur);
  return memoSet(key, { ...diffEnv(reference, d.cur, dopts), refs: refsFor(ctx, env, draft) }, d.deps);
}
