// Mermaid (0.27.4): export of a flow in every environment, import into a draft of a design, undo of one import. See docs/API.md "Mermaid".

import type { Router } from '../http/router.ts';
import { created, Reply } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { mermaidImport, mermaidPreview, undoMermaid } from '../store/draft-mermaid.ts';
import { flowMermaid } from '../store/flow-mermaid.ts';
import { viewParams } from '../../core/trace-view-params.ts';
import { badRequest } from '../errors.ts';

export function registerMermaid(r: Router, ctx: Ctx) {
  r.get('/api/envs/:env/flows/mermaid', (req) => { // 0.38.0: `detail`, `choose`, `open`, `dbOpen`, `group` (as the trace API) export that view; none of them: the full trace
    const q = req.query, sent = ['detail', 'choose', 'open', 'dbOpen', 'group'].some((k) => q.has(k));
    let view; try { view = sent ? viewParams({ detail: q.get('detail'), choose: q.get('choose'), open: q.get('open'), dbOpen: q.get('dbOpen'), group: q.get('group') }) : undefined; } catch (e) { throw badRequest((e as Error).message); }
    return new Reply(200, flowMermaid(ctx, req.params.env, q.get('draft'), q.get('service'), q.get('ingress'), view), { 'content-type': 'text/plain; charset=utf-8' });
  });

  const base = '/api/envs/:env/drafts/:slug/mermaid';
  r.post(`${base}/preview`, async (req) => { const b = await req.json(); return mermaidPreview(ctx, req.params.env, req.params.slug, { text: b?.text, matches: b?.matches, groupPath: b?.groupPath }); });
  r.post(base, async (req) => {
    const b = await req.json();
    const out = mermaidImport(ctx, req.params.env, req.params.slug, { text: b?.text, matches: b?.matches, groupPath: b?.groupPath }, { author: b?.author });
    ctx.changedDraft(req.params.env, req.params.slug);
    return created(out);
  });
  r.delete(`${base}/:batch`, (req) => { const out = undoMermaid(ctx, req.params.env, req.params.slug, req.params.batch); ctx.changedDraft(req.params.env, req.params.slug); return out; });
}
