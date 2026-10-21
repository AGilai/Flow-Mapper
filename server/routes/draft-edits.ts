// What goes into a draft besides raw ops: an import from another environment (one level) and, from 0.25.0, edit forms.
// See docs/API.md "Import into a draft". Both are validated and appended through appendOps (all or nothing); sealed environments refuse (409 ENV_SEALED).

import type { Router } from '../http/router.ts';
import { created } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { importIntoDraft, importPreview } from '../store/draft-import.ts';
import { editDraft } from '../store/draft-edit.ts';
import { replanLinks } from '../store/draft-plan-links.ts';
import { callView } from '../../core/call-view.ts';
import { badRequest, notFound } from '../errors.ts';
import { refsFor } from '../refs.ts';

export function registerDraftEdits(r: Router, ctx: Ctx) {
  const base = '/api/envs/:env/drafts/:slug';

  r.get(`${base}/import/preview`, (req) => importPreview(ctx, req.params.env, req.params.slug,
    { source: req.query.get('source') as string, anchor: req.query.get('anchor') as string, groupPath: req.query.get('groupPath') ?? undefined }));

  r.post(`${base}/import`, async (req) => {
    const b = await req.json();
    const out = importIntoDraft(ctx, req.params.env, req.params.slug, { source: b?.source, anchor: b?.anchor, groupPath: b?.groupPath }, { author: b?.author });
    ctx.changedDraft(req.params.env, req.params.slug);
    return created(out);
  });

  /** An edit form (docs/API.md "Edits"): {edit: DesignEdit, author?} becomes whole-item ops of the draft. */
  r.post(`${base}/edits`, async (req) => {
    const b = await req.json();
    const out = editDraft(ctx.db, req.params.env, req.params.slug, b?.edit, { author: b?.author });
    ctx.changedDraft(req.params.env, req.params.slug);
    return created(out);
  });

  /** The links of a kept plan (this draft's, or `from`'s) into this draft: how a draft imported before 0.28 gets its abstract links. */
  r.post(`${base}/plan/links`, async (req) => {
    const b = await req.json().catch(() => ({}));
    const out = replanLinks(ctx.db, req.params.env, req.params.slug, { from: b?.from, author: b?.author });
    ctx.changedDraft(req.params.env, req.params.slug);
    return created(out);
  });

  /** What the call form reads: the steps that use an egress and the endpoints it reaches (`reference` when their behaviour is in another environment). */
  r.get('/api/envs/:env/call', (req) => {
    const service = req.query.get('service'), egress = req.query.get('egress'), draft = req.query.get('draft');
    if (!service || !egress) throw badRequest('service and egress are required');
    return callView(ctx.view(req.params.env, draft).g, refsFor(ctx, req.params.env, draft), service, egress) ?? (() => { throw notFound(`egress '${egress}' of '${service}'`); })();
  });
}
