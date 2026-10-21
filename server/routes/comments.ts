// Comments under a flow (0.27.0). Annotations: any environment takes them (sealed ones too), no draft needed. `?draft=<slug>` on a read or a
// post lets a flow that only exists in an open draft be discussed. Only the author edits or deletes (naive identity: the request's `author`
// must equal the stored one). See docs/API.md "Comments".

import type { Router } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { badRequest } from '../errors.ts';
import * as comments from '../store/comments.ts';

const id = (s: string) => { const n = Number(s); if (!Number.isInteger(n) || n < 1) throw badRequest('comment id must be a positive integer'); return n; };

export function registerComments(r: Router, ctx: Ctx) {
  r.get('/api/envs/:env/comments/counts', (req) => comments.counts(ctx.db, req.params.env));
  r.get('/api/envs/:env/comments', (req) => {
    const anchor = req.query.get('anchor');
    if (!anchor) throw badRequest('anchor is required (flow:<service>/<ingress>)');
    return comments.listThread(ctx.db, req.params.env, anchor);
  });
  r.post('/api/envs/:env/comments', async (req) => {
    const b = await req.json();
    return comments.addComment(ctx.db, ctx.graphOf(req), req.params.env, { anchor: b?.anchor, step: b?.step, parentId: b?.parentId, author: b?.author, body: b?.body });
  });
  r.patch('/api/envs/:env/comments/:id', async (req) => {
    const b = await req.json();
    return comments.editComment(ctx.db, req.params.env, id(req.params.id), { author: b?.author, body: b?.body });
  });
  r.delete('/api/envs/:env/comments/:id', (req) => comments.deleteComment(ctx.db, req.params.env, id(req.params.id), req.query.get('author')));
}
