// OIDC authorization code + PKCE against the Cognito hosted UI (public client, no secret).
//   GET /auth/login?returnTo=/...   -> 302 to <domain>/oauth2/authorize, with state + PKCE verifier kept in a short signed cookie
//   GET /auth/callback?code&state   -> token exchange, ID token verified (jwt.ts), user mapped, session cookie, 302 back
//   GET|POST /auth/logout           -> session ended, 302 to <domain>/logout

import { createHash, randomBytes } from 'node:crypto';
import type { Router, Req } from '../http/router.ts';
import { Reply } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { HttpError } from '../errors.ts';
import type { AuthOptions } from './options.ts';
import { Jwks, verifyIdToken, AuthError } from './jwt.ts';
import { CSRF_COOKIE, OIDC_COOKIE, SESSION_COOKIE, SESSION_MS, cookie, createSession, endSession, parseCookies, safeEq, secretOf, sign, unsign } from './sessions.ts';
import { userFromClaims } from './accounts.ts';

const redirect = (to: string, cookies: string[] = []) => new Reply(302, '', { location: to, 'cache-control': 'no-store', ...(cookies.length ? { 'set-cookie': cookies } : {}) });
const safeReturn = (s: string | null) => (s && s.startsWith('/') && !s.startsWith('//') && !s.includes('\\') ? s : '/');

export function registerOidc(r: Router, ctx: Ctx, a: AuthOptions) {
  const isSecure = () => !!a.publicUrl?.startsWith('https:');
  const jwks = new Jwks(`${a.issuer}/.well-known/jwks.json`, a.jwksMinRefetchMs, undefined, a.now);
  const callbackUrl = () => `${a.publicUrl}/auth/callback`; // read per request: tests learn their port after listening
  const secret = () => secretOf(ctx.db);

  r.get('/auth/login', (req) => {
    const secure = isSecure(), callback = callbackUrl();
    const state = randomBytes(18).toString('base64url'), verifier = randomBytes(48).toString('base64url');
    const returnTo = safeReturn(req.query.get('returnTo'));
    const pack = Buffer.from(JSON.stringify({ state, verifier, returnTo })).toString('base64url');
    const q = new URLSearchParams({ response_type: 'code', client_id: a.clientId!, redirect_uri: callback, scope: 'openid email profile', state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    return redirect(`${a.domain}/oauth2/authorize?${q}`, [cookie(OIDC_COOKIE, `${pack}.${sign(secret(), pack)}`, { maxAgeS: 600, secure })]);
  });

  r.get('/auth/callback', async (req) => {
    const secure = isSecure(), callback = callbackUrl();
    const fail = (msg: string) => { throw new HttpError(400, 'AUTH_FAILED', msg); };
    if (req.query.get('error')) fail(`sign-in was refused: ${req.query.get('error_description') ?? req.query.get('error')}`);
    const packed = unsign(secret(), parseCookies(req.headers.cookie)[OIDC_COOKIE]);
    if (!packed) return fail('the sign-in expired or was not started here; try again');
    let st: { state: string; verifier: string; returnTo: string };
    try { st = JSON.parse(Buffer.from(packed, 'base64url').toString('utf8')); } catch { return fail('malformed sign-in state'); }
    const code = req.query.get('code'), state = req.query.get('state');
    if (!code || !state || !safeEq(state, st.state)) return fail('sign-in state does not match; try again');
    let claims;
    try {
      const res = await fetch(`${a.domain}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: a.clientId!, code, redirect_uri: callback, code_verifier: st.verifier }) });
      const tok = await res.json() as { id_token?: string; error?: string };
      if (!res.ok || !tok.id_token) return fail(`token exchange failed: ${tok.error ?? res.status}`);
      claims = await verifyIdToken(tok.id_token, jwks, { issuer: a.issuer!, clientId: a.clientId!, now: a.now });
    } catch (e) {
      if (e instanceof AuthError) return fail(`the ID token was rejected: ${e.message}`);
      if (e instanceof HttpError) throw e;
      return fail('could not reach the sign-in service');
    }
    const userId = userFromClaims(ctx.db, claims, a.adminEmail);
    const s = createSession(ctx.db, userId, a.now?.());
    return redirect(st.returnTo, [
      cookie(SESSION_COOKIE, s.cookie, { maxAgeS: SESSION_MS / 1000, secure }),
      cookie(CSRF_COOKIE, s.csrf, { maxAgeS: SESSION_MS / 1000, secure, httpOnly: false }),
      cookie(OIDC_COOKIE, '', { maxAgeS: 0, secure }),
    ]);
  });

  const logout = (req: Req) => {
    const secure = isSecure();
    endSession(ctx.db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    const to = `${a.domain}/logout?${new URLSearchParams({ client_id: a.clientId!, logout_uri: `${a.publicUrl}/` })}`;
    return redirect(to, [cookie(SESSION_COOKIE, '', { maxAgeS: 0, secure }), cookie(CSRF_COOKIE, '', { maxAgeS: 0, secure, httpOnly: false })]);
  };
  r.get('/auth/logout', logout);
  r.post('/auth/logout', logout);
}
