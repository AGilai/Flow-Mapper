// Mentions (0.32.0): the comments that @mention a user, across every environment, and what is still unread. `user` is a user id; the web client
// sends it as X-Flow-User instead. See docs/API.md "Mentions".

import type { Router } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { headerUser } from '../identity.ts';
import { listMentions, seen, unreadCounts } from '../store/mentions-read.ts';
import { listAboutMentions } from '../store/mentions-about.ts';
import { listNotesMentions } from '../store/notes-mentions.ts';

export function registerMentions(r: Router, ctx: Ctx) {
  r.get('/api/mentions', (req) => {
    const user = req.query.get('user') ?? headerUser(req.headers);
    const l = listMentions(ctx.db, { user: user as string, unread: req.query.get('unread') === '1', env: req.query.get('env'), anchor: req.query.get('anchor'), limit: Number(req.query.get('limit')) || undefined });
    const about = req.query.get('unread') === '1' || req.query.get('anchor') ? [] : listAboutMentions(ctx.db, user, req.query.get('env')); // 0.33.0: the About of a component or a subsystem that mentions the user
    const notes = req.query.get('unread') === '1' || req.query.get('anchor') ? [] : listNotesMentions(ctx.db, user, req.query.get('env')); // 0.34.0: Notes that mention the user (never unread)
    return { user, unread: l.filter((m) => m.unread).length, mentions: l, about, notes };
  });
  r.post('/api/mentions/seen', async (req) => { const b = await req.json(); return seen(ctx.db, b?.user ?? headerUser(req.headers) as string, b?.commentIds); });
  r.get('/api/envs/:env/mentions/counts', (req) => { const user = req.query.get('user') ?? headerUser(req.headers); return user ? unreadCounts(ctx.db, user, req.params.env) : {}; }); // nobody signed in: nothing unread
}
