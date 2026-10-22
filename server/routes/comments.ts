// Comments under a flow (0.27.0). Annotations: any environment takes them (sealed ones too), no draft needed. `?draft=<slug>` on a read or a
// post lets a flow that only exists in an open draft be discussed. Only the author edits or deletes (naive identity: the request's `author`
// must equal the stored one); anyone resolves or reopens a thread (`resolved` + `actor`). See docs/API.md "Comments".

import type { Router } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { badRequest } from '../errors.ts';
import { created } from '../http/router.ts';
import * as comments from '../store/comments.ts';
import { out } from '../store/comments-rows.ts';

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
    // 0.29.2: an importer's fields ride along; a re-import of a known (externalSource, externalId) updates it and answers 200 with `updated: true`
    const row = comments.addComment(ctx.db, ctx.graphOf(req), req.params.env, {
      anchor: b?.anchor, step: b?.step, parentId: b?.parentId, author: b?.author, body: b?.body, createdAt: b?.createdAt, externalId: b?.externalId, externalSource: b?.externalSource,
      authorExternalId: b?.authorExternalId, parentExternalId: b?.parentExternalId, resolved: b?.resolved, resolvedBy: b?.resolvedBy, resolvedAt: b?.resolvedAt });
    return row.updated ? row : created(row);
  });
  r.patch('/api/envs/:env/comments/:id', async (req) => {
    const b = await req.json();
    if (b?.resolved !== undefined) { // resolve / reopen: anyone, with an `actor`; not combined with a body edit (that stays author-only)
      if (b.body !== undefined) throw badRequest('resolve or edit in separate requests');
      return out(comments.resolveComment(ctx.db, req.params.env, id(req.params.id), b));
    }
    return comments.editComment(ctx.db, req.params.env, id(req.params.id), { author: b?.author, body: b?.body });
  });
  r.delete('/api/envs/:env/comments/:id', (req) => comments.deleteComment(ctx.db, req.params.env, id(req.params.id), req.query.get('author')));
}
