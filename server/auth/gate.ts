// The auth middleware: who is calling, then what they may do. Auth off: everyone is an admin (as before 0.52.0), nothing is refused.
// Cognito mode: /api/* and /mcp need a session cookie or `Authorization: Bearer fm_...` (401 otherwise); /healthz, /api/version, /api/me and /auth/* are open.
// Cookie requests that write need the X-Flows-CSRF header (double submit); Bearer requests need none (no ambient credential).

import type { Router, Req } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { HttpError } from '../errors.ts';
import type { AuthOptions } from './options.ts';
import { runAs, type Principal } from './context.ts';
import { CSRF_HEADER, SESSION_COOKIE, lookupSession, parseCookies, safeEq } from './sessions.ts';
import { lookupToken, TOKEN_PREFIX } from './tokens.ts';
import { principalOf } from './accounts.ts';
import { authorize } from './rules.ts';

export const OFF_PRINCIPAL: Principal = { id: null, name: 'anonymous', admin: true, scope: 'harvester', via: 'off' };
const OPEN = new Set(['/api/version', '/api/me']);
export const unauthenticated = (message = 'sign in required: open the app in a browser, or send a personal access token as "Authorization: Bearer fm_..."', code = 'UNAUTHENTICATED') =>
  new HttpError(401, code, message, { loginUrl: '/auth/login' });

/** The caller of a request, or null when nobody is signed in. A bad or expired token is a 401 of its own. */
export function resolvePrincipal(ctx: Ctx, req: Pick<Req, 'headers'>, a: AuthOptions): Principal | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && /^bearer\s/i.test(auth)) {
    const t = auth.replace(/^bearer\s+/i, '').trim();
    if (!t.startsWith(TOKEN_PREFIX)) throw unauthenticated('the bearer token is not a Flow-Mapper token (they start with fm_); create one under Tokens', 'TOKEN_INVALID');
    const r = lookupToken(ctx.db, t, a.now?.());
    if (!r.ok) throw unauthenticated(r.message, r.code);
    return principalOf(ctx.db, r.userId, 'token', r.scope) ?? (() => { throw unauthenticated('the owner of this token no longer exists', 'TOKEN_INVALID'); })();
  }
  const s = lookupSession(ctx.db, parseCookies(req.headers.cookie)[SESSION_COOKIE], a.now?.());
  return s ? principalOf(ctx.db, s.userId, 'session', 'user', s.csrf) : null;
}

export function registerAuthGate(r: Router, ctx: Ctx, a: AuthOptions) {
  r.around(async (req, next) => {
    if (a.mode === 'off') { req.who = OFF_PRINCIPAL; return runAs(OFF_PRINCIPAL, next); }
    const gated = req.path.startsWith('/api/') || req.path === '/mcp';
    if (!gated) return next();
    const p = resolvePrincipal(ctx, req, a);
    if (p) req.who = p;
    if (OPEN.has(req.path)) return next();
    if (!p) throw unauthenticated();
    const write = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    if (write && p.via === 'session') {
      const h = req.headers[CSRF_HEADER];
      if (typeof h !== 'string' || !p.csrf || !safeEq(h, p.csrf)) throw new HttpError(403, 'CSRF', `missing or wrong ${CSRF_HEADER} header: cookie sessions must send the value of the fm_csrf cookie with every write`);
    }
    await authorize(ctx.db, req, p);
    return runAs(p, next);
  });
}
