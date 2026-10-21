// Re-read the links of a draft's kept plan (`drafts.plan.links`) into an open draft: how a draft imported before 0.28 gets its abstract links.
// Ops whose item already equals the overlay are skipped; nothing left is 409 NO_CHANGE.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { conflict, notFound } from '../errors.ts';
import { stableJson } from '../../core/diff/normalise.ts';
import { planLinks } from '../../core/import-plan-links.ts';
import { rowId } from '../../core/item-rows.ts';
import { opRow } from '../../core/draft-ops.ts';
import { guardEnv } from './envs.ts';
import { appendOps, draftView, getDraft } from './drafts.ts';

export function replanLinks(db: DB, env: string, slug: string, who: { from?: string; author?: string; byAi?: boolean } = {}) {
  return tx(db, () => {
    guardEnv(db, env, 'draft');
    const { rows } = draftView(db, env, slug);
    const src = getDraft(db, env, who.from ?? slug, { any: !!who.from });
    if (!src.plan) throw notFound(`a kept plan on draft '${src.slug}'`);
    const plan = JSON.parse(src.plan);
    const planned = planLinks(plan.links, rows);
    const have = new Map(rows.map((r) => [rowId(r), r.data]));
    const ops = planned.ops.filter((o) => { const r = opRow(o); const cur = have.get(rowId(r)); return cur === undefined || stableJson(cur) !== stableJson(o.data); });
    if (!ops.length) throw conflict('NO_CHANGE', `the plan's links of '${src.slug}' are already in draft '${slug}'${planned.counts.skipped ? ` (${planned.counts.skipped} skipped: ${planned.warnings[0]})` : ''}`);
    const out = appendOps(db, env, slug, ops, { author: who.author ?? (who.byAi ? 'assistant' : 'anonymous'), byAi: who.byAi });
    return { ...out, from: src.slug, to: slug, ops: ops.length, links: planned.counts, warnings: planned.warnings };
  });
}
