// Accounts (AWS v1 part C): GET /api/me, personal access tokens (/api/tokens), sharing (/api/envs/:env/access), a draft's share switch.
// With FLOW_AUTH=off: /api/me answers {auth: 'off'} and tokens do not exist (404). See docs/API.md "Accounts and access".

import type { Router, Req } from '../http/router.ts';
import { created } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { badRequest, notFound } from '../errors.ts';
import type { AuthOptions } from '../auth/options.ts';
import { createToken, listTokens, revokeToken } from '../auth/tokens.ts';
import { userEmail } from '../auth/accounts.ts';
import { findUser } from '../store/users.ts';
import { getAccess, setAccess } from '../store/env-access.ts';
import { requireRole } from '../access.ts';
import { unauthenticated } from '../auth/gate.ts';
import { getDraft } from '../store/drafts.ts';

export function registerAccounts(r: Router, ctx: Ctx, a: AuthOptions) {
  const { db } = ctx;
  const me = (req: Req) => { const p = req.who; if (!p || p.via === 'off' || !p.id) throw notFound('tokens (FLOW_AUTH is off on this server)'); return p; };

  r.get('/api/me', (req) => {
    const p = req.who;
    if (a.mode === 'off') return { auth: 'off', signedIn: true, user: null, admin: true, scope: 'harvester' };
    if (!p) return { auth: 'cognito', signedIn: false, loginUrl: '/auth/login' };
    const u = findUser(db, p.id!);
    return { auth: 'cognito', signedIn: true, via: p.via, user: u ? { id: u.id, name: u.name, color: u.color, email: userEmail(db, u.id) } : null, admin: p.admin, scope: p.scope };
  });

  r.post('/api/tokens', async (req) => {
    const p = me(req), b = await req.json();
    return created(createToken(db, p.id!, b, p.admin, a.now?.()));
  });
  r.get('/api/tokens', (req) => ({ tokens: listTokens(db, me(req).id!) }));
  r.delete('/api/tokens/:id', (req) => revokeToken(db, me(req).id!, req.params.id, a.now?.()));

  r.get('/api/envs/:env/access', (req) => {
    if (!req.who) throw unauthenticated();
    return getAccess(db, req.params.env, requireRole(db, req.params.env, 'viewer', req.who));
  });
  r.put('/api/envs/:env/access', async (req) => {
    const role = requireRole(db, req.params.env, 'owner', req.who);
    setAccess(db, req.params.env, await req.json(), !!req.who?.admin);
    return getAccess(db, req.params.env, role);
  });

  /** A draft is private to its author until shared with the environment's editors (and viewers read it). {shared: true|false}. */
  r.put('/api/envs/:env/drafts/:slug/share', async (req) => {
    const b = await req.json();
    if (typeof b?.shared !== 'boolean') throw badRequest('shared must be true or false');
    const d = getDraft(db, req.params.env, req.params.slug);
    db.prepare('UPDATE drafts SET visibility = ? WHERE id = ?').run(b.shared ? 'shared' : 'private', d.id);
    return { slug: d.slug, shared: b.shared };
  });
}
