// Import a plan (docs/DESIGN-IMPORT.md) into an open draft: the plan becomes whole-item ops (core/import-plan.ts), appended in one
// transaction. The plan itself (without the manifests) stays on the draft for review. A dry run appends, applies and rolls back,
// and returns what the apply would report, contract findings included.

import type { DB } from '../db/connection.ts';
import { HttpError } from '../errors.ts';
import { PlanError, planToOps, type PlannedOps } from '../../core/import-plan.ts';
import { validateManifest } from '../schema.ts';
import { getEnv, guardEnv } from './envs.ts';
import { appendOps, draftView } from './drafts.ts';
import { applyDraftIn } from './draft-apply.ts';
import { baselineRows } from './item-rows.ts';
import { withDry } from './dry-run.ts';

export interface PlanResult extends Omit<PlannedOps, 'ops'> { ops: number; counts: { added: number; removed: number; changed: number }; dryRun?: boolean; results?: unknown[]; replaced?: unknown[] }

export function ingestPlan(db: DB, env: string, slug: string, plan: unknown, who: { author?: string; byAi?: boolean; dryRun?: boolean } = {}): PlanResult {
  guardEnv(db, env, 'draft');
  return withDry(db, !!who.dryRun, () => {
    const { draft, rows } = draftView(db, env, slug);
    const base = new Map(baselineRows(db, env).filter((r) => r.list === 'header').map((r) => [r.service, r.sourceVersion]));
    let planned: PlannedOps;
    try {
      planned = planToOps(plan, rows, { env, groups: getEnv(db, env).groups, baselineVersion: (s) => base.get(s), validateManifest: (m) => validateManifest(m) });
    } catch (e) {
      if (!(e instanceof PlanError)) throw e;
      const codes = new Set(e.issues.map((i) => i.code ?? 'INVALID'));
      throw new HttpError(422, codes.size === 1 ? [...codes][0] : 'INVALID', `${e.issues.length} problem(s) in the plan: ${e.issues[0].path ? `${e.issues[0].path}: ` : ''}${e.issues[0].message}`, e.issues);
    }
    const { ops, ...rest } = planned;
    const out = appendOps(db, env, slug, ops, { author: who.author ?? (who.byAi ? 'assistant' : 'anonymous'), byAi: who.byAi });
    const { manifests: _m, ...kept } = plan as any;
    db.prepare('UPDATE drafts SET plan = ? WHERE id = ?').run(JSON.stringify(kept), draft.id);
    const res: PlanResult = { ...rest, ops: ops.length, counts: out.counts };
    if (!who.dryRun) return res;
    const applied = applyDraftIn(db, env, slug, { by: who.author ?? 'dry-run', source: 'api', dryRun: true });
    return { ...res, dryRun: true, results: applied.results, replaced: applied.replaced };
  });
}
