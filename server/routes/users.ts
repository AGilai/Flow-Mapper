// The users registry (0.32.0). Users are global. POST matches before it creates (a REST client may call it every run); there is no delete,
// a merge folds one user into another. Identity is naive (server/identity.ts): the web client sends X-Flow-User. See docs/API.md "Users".

import type { Router } from '../http/router.ts';
import { created } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { badRequest } from '../errors.ts';
import { headerUser } from '../identity.ts';
import { invalidateAll } from '../graph-cache.ts';
import { ensureUser, getUser, listUsers, mergeUser, renameUser, createUser, userName, userCounts } from '../store/users.ts';

export function registerUsers(r: Router, ctx: Ctx) {
  r.get('/api/users', () => { const c = userCounts(ctx.db); return { users: listUsers(ctx.db).map((u) => ({ ...u, counts: c[u.id] ?? { comments: 0, items: 0, mentions: 0 } })) }; });
  r.get('/api/users/:id', (req) => getUser(ctx.db, req.params.id));
  r.post('/api/users', async (req) => {
    const b = await req.json(), name = userName(b?.name);
    const before = listUsers(ctx.db).length;
    if (b?.match) { const u = ensureUser(ctx.db, { name, source: b?.externalIds?.[0]?.source, externalId: b?.externalIds?.[0]?.externalId })!; return listUsers(ctx.db).length > before ? created(u) : u; }
    return created(createUser(ctx.db, name, b?.externalIds));
  });
  r.patch('/api/users/:id', async (req) => {
    const b = await req.json();
    if (b?.name === undefined) throw badRequest('name is required');
    return renameUser(ctx.db, req.params.id, b.name, b?.keepAlias === true);
  });
  r.post('/api/users/:id/merge', async (req) => {
    const b = await req.json();
    if (typeof b?.into !== 'string' || !b.into) throw badRequest('into is required (the user id to keep)');
    const by = headerUser(req.headers);
    const merged = mergeUser(ctx.db, req.params.id, b.into, by ? getUser(ctx.db, by).name : typeof b?.by === 'string' ? b.by : 'unknown');
    invalidateAll(); // owners and About mentions changed inside cached graphs
    return merged;
  });
}
