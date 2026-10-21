// Drafts of a design environment: create, list, rename, discard, append ops, undo / revert, changes, apply, plan import.
// See docs/API.md "Drafts". Writes are guarded as 'draft' (sealed refuses). Reading an environment as a draft is `?draft=<slug>` on any GET.

import type { Router } from '../http/router.ts';
import { created } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { badRequest } from '../errors.ts';
import * as drafts from '../store/drafts.ts';
import { runApply } from '../store/draft-apply.ts';
import { getEnv } from '../store/envs.ts';
import { envItemRows } from '../store/item-rows.ts';

export const flag = (q: URLSearchParams, k: string) => ['1', 'true'].includes(q.get(k) ?? '');

export function registerDrafts(r: Router, ctx: Ctx) {
  const { db } = ctx;
  const base = '/api/envs/:env/drafts';
  r.get(base, (req) => { getEnv(db, req.params.env); return drafts.listDrafts(db, req.params.env, req.query.get('status') === 'all' ? 'all' : 'open'); });
  r.post(base, async (req) => {
    const b = await req.json();
    return created(drafts.createDraft(db, req.params.env, { name: b?.name, slug: b?.slug, createdBy: b?.createdBy }));
  });
  r.get(`${base}/:slug`, (req) => {
    const d = drafts.getDraft(db, req.params.env, req.params.slug, { any: true });
    return { ...drafts.draftInfo(db, req.params.env, d), ops: drafts.loadOps(db, d.id), plan: d.plan ? JSON.parse(d.plan) : null, report: d.report ? JSON.parse(d.report) : null };
  });
  r.patch(`${base}/:slug`, async (req) => drafts.renameDraft(db, req.params.env, req.params.slug, (await req.json())?.name));
  r.delete(`${base}/:slug`, async (req) => {
    const out = drafts.discardDraft(db, req.params.env, req.params.slug, req.query.get('by') ?? 'anonymous');
    ctx.changedDraft(req.params.env, req.params.slug);
    return out;
  });
  r.post(`${base}/:slug/ops`, async (req) => {
    const b = await req.json();
    const out = drafts.appendOps(db, req.params.env, req.params.slug, b?.ops, { author: b?.author, byAi: !!b?.byAi });
    ctx.changedDraft(req.params.env, req.params.slug);
    return created(out);
  });
  r.delete(`${base}/:slug/ops/last`, (req) => {
    const out = drafts.undoLast(db, req.params.env, req.params.slug);
    ctx.changedDraft(req.params.env, req.params.slug);
    return out;
  });
  r.delete(`${base}/:slug/ops`, (req) => {
    const anchor = req.query.get('anchor');
    if (!anchor) throw badRequest('anchor is required: the item whose ops to drop');
    const out = drafts.revertItem(db, req.params.env, req.params.slug, anchor);
    ctx.changedDraft(req.params.env, req.params.slug);
    return out;
  });
  r.get(`${base}/:slug/changes`, (req) => {
    const d = drafts.getDraft(db, req.params.env, req.params.slug);
    return drafts.changesOf(envItemRows(db, req.params.env), drafts.loadOps(db, d.id));
  });
  r.post(`${base}/:slug/apply`, async (req) => {
    const b = await req.json();
    const dryRun = flag(req.query, 'dryRun');
    return runApply(ctx, req.params.env, req.params.slug, { by: b?.by ?? 'anonymous', source: 'ui', dryRun });
  });
}
