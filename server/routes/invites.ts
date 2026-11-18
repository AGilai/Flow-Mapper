// Invite people (CR #134): POST/GET /api/admin/invites, admin only, FLOW_AUTH=cognito only. Calls cognito-idp AdminCreateUser / AdminGetUser / ListUsers
// on the stack's user pool (server/auth/cognito-admin.ts; tests inject a fake through AuthOptions.cognitoAdmin). See docs/API.md "Invite people".

import type { Router } from '../http/router.ts';
import type { AuthOptions } from '../auth/options.ts';
import { HttpError, badRequest, conflict } from '../errors.ts';
import { forbidden } from '../store/comments-rows.ts';
import { unauthenticated } from '../auth/gate.ts';
import { CognitoError, realCognito, type CognitoAdmin } from '../auth/cognito-admin.ts';
import { isEmail, MAX_INVITES } from '../../core/invite-emails.ts';

export type InviteStatus = 'invited' | 'exists' | 'pending' | 'failed';
export interface InviteResult { email: string; status: InviteStatus; message?: string }

const PENDING = 'FORCE_CHANGE_PASSWORD';

async function inviteOne(c: CognitoAdmin, email: string, resend: boolean): Promise<InviteResult> {
  try {
    await c.createUser(email, resend);
    return { email, status: 'invited', message: resend ? 'invitation sent again' : 'invitation sent' };
  } catch (e: any) {
    if (e instanceof CognitoError && e.code === 'UsernameExistsException') {
      try {
        const u = await c.getUser(email);
        if (u?.status === PENDING) return { email, status: 'pending', message: 'invited, has not signed in yet; use Resend to send the e-mail again' };
        return { email, status: 'exists', message: 'already has an account' };
      } catch (e2: any) { return { email, status: 'failed', message: e2.message ?? 'lookup failed' }; }
    }
    if (e instanceof CognitoError && e.code === 'UserNotFoundException') return { email, status: 'failed', message: 'not invited yet, so there is nothing to resend' };
    return { email, status: 'failed', message: e?.message ?? 'cognito-idp call failed' };
  }
}

export function registerInvites(r: Router, a: AuthOptions) {
  let real: CognitoAdmin | null | undefined;
  const client = (req: { who?: { admin?: boolean } }): CognitoAdmin => {
    if (a.mode !== 'cognito') throw new HttpError(404, 'NOT_FOUND', 'invites need accounts: this server runs with FLOW_AUTH=off');
    if (!(req as any).who) throw unauthenticated();
    if (!req.who!.admin) throw forbidden('only an admin can invite people');
    if (a.cognitoAdmin) return a.cognitoAdmin;
    real ??= realCognito(a);
    if (!real) throw conflict('NO_USER_POOL', 'the user pool is not configured: set FLOW_COGNITO_USER_POOL_ID (or a FLOW_COGNITO_ISSUER of the form https://cognito-idp.<region>.amazonaws.com/<poolId>)');
    return real;
  };
  const upstream = (e: any) => new HttpError(502, 'COGNITO', `cognito-idp: ${e?.message ?? 'call failed'}`);

  r.post('/api/admin/invites', async (req) => {
    const c = client(req), b = await req.json();
    if (!Array.isArray(b?.emails) || !b.emails.length) throw badRequest('emails must be a non-empty array of e-mail addresses');
    if (b.emails.length > MAX_INVITES) throw badRequest(`at most ${MAX_INVITES} addresses per request`);
    const results: InviteResult[] = [], seen = new Set<string>();
    for (const raw of b.emails) {
      const email = String(raw ?? '').trim().toLowerCase();
      if (seen.has(email)) continue;
      seen.add(email);
      results.push(isEmail(email) ? await inviteOne(c, email, b.resend === true) : { email: String(raw), status: 'failed', message: 'not a valid e-mail address' });
    }
    return { results };
  });

  r.get('/api/admin/invites', async (req) => {
    const c = client(req);
    try { return { users: (await c.listUsers()).sort((x, y) => (y.created ?? '').localeCompare(x.created ?? '')) }; } catch (e) { throw upstream(e); }
  });
}
