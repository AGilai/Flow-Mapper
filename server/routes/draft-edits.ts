// What goes into a draft besides raw ops: an import from another environment (one level) and, from 0.25.0, edit forms.
// See docs/API.md "Import into a draft". Both are validated and appended through appendOps (all or nothing); sealed environments refuse (409 ENV_SEALED).

import type { Router } from '../http/router.ts';
import { created } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { importIntoDraft, importPreview } from '../store/draft-import.ts';

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
}
