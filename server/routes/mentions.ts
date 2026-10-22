// Mentions (0.31.0): the comments that @mention a user, across every environment, and what is still unread. `user` is a user id; the web client
// sends it as X-Flow-User instead. See docs/API.md "Mentions".

import type { Router } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { headerUser } from '../identity.ts';
import { listMentions, seen, unreadCounts } from '../store/mentions-read.ts';

export function registerMentions(r: Router, ctx: Ctx) {
  r.get('/api/mentions', (req) => {
    const user = req.query.get('user') ?? headerUser(req.headers);
    const l = listMentions(ctx.db, { user: user as string, unread: req.query.get('unread') === '1', env: req.query.get('env'), anchor: req.query.get('anchor'), limit: Number(req.query.get('limit')) || undefined });
    return { user, unread: l.filter((m) => m.unread).length, mentions: l };
  });
  r.post('/api/mentions/seen', async (req) => { const b = await req.json(); return seen(ctx.db, b?.user ?? headerUser(req.headers) as string, b?.commentIds); });
  r.get('/api/envs/:env/mentions/counts', (req) => { const user = req.query.get('user') ?? headerUser(req.headers); return user ? unreadCounts(ctx.db, user, req.params.env) : {}; }); // nobody signed in: nothing unread
}
