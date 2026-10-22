// Action items under a flow (0.29.0). Annotations like comments: any environment takes them (sealed ones too), no draft needed; `?draft=<slug>`
// lets a flow that only exists in an open draft carry them. Anyone edits; only the creator deletes (naive identity: `actor`). See docs/API.md.

import type { Router } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { HttpError } from '../errors.ts';
import * as items from '../store/action-items.ts';

const id = (s: string) => { const n = Number(s); if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'VALIDATION', 'action item id must be a positive integer'); return n; };

export function registerActionItems(r: Router, ctx: Ctx) {
  r.get('/api/envs/:env/action-items/counts', (req) => items.counts(ctx.db, req.params.env));
  r.get('/api/envs/:env/action-items', (req) => {
    const anchor = req.query.get('anchor');
    if (!anchor) throw new HttpError(400, 'VALIDATION', 'anchor is required (flow:<service>/<ingress>)');
    return items.listItems(ctx.db, req.params.env, anchor);
  });
  r.post('/api/envs/:env/action-items', async (req) => {
    const b = await req.json();
    return items.addItem(ctx.db, ctx.graphOf(req), req.params.env, { anchor: b?.anchor, owner: b?.owner, description: b?.description, status: b?.status, due: b?.due, step: b?.step, commentId: b?.commentId, actor: b?.actor });
  });
  r.patch('/api/envs/:env/action-items/:id', async (req) => {
    const b = await req.json();
    return items.updateItem(ctx.db, ctx.graphOf(req), req.params.env, id(req.params.id), { actor: b?.actor, owner: b?.owner, description: b?.description, status: b?.status, due: b?.due, step: b?.step });
  });
  r.delete('/api/envs/:env/action-items/:id', (req) => items.deleteItem(ctx.db, req.params.env, id(req.params.id), req.query.get('actor')));
}
