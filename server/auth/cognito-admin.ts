// The slice of cognito-idp the invite UI needs (AdminCreateUser, AdminGetUser, ListUsers) over plain HTTPS with SigV4; no AWS SDK.
// `CognitoAdmin` is the seam: tests inject a fake, the server builds the real one from the options.

import type { AuthOptions } from './options.ts';
import { signRequest, type AwsCreds } from './aws-sigv4.ts';
import { credentialProvider } from './aws-creds.ts';
import { tempPassword } from './temp-password.ts';

export interface PoolUser { email: string; status: string; created: string | null; enabled: boolean }
export class CognitoError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }

export interface CognitoAdmin {
  /** Sends the invitation e-mail (resend: again, for a user who never signed in). Throws CognitoError('UsernameExistsException') when the user exists. */
  createUser(email: string, resend: boolean): Promise<void>;
  getUser(email: string): Promise<PoolUser | null>;
  listUsers(): Promise<PoolUser[]>;
}

/** Pool id and region: FLOW_COGNITO_USER_POOL_ID (region = its prefix), else parsed from the issuer https://cognito-idp.<region>.amazonaws.com/<poolId>. */
export function poolOf(a: AuthOptions): { poolId: string; region: string } | null {
  const m = a.issuer?.match(/^https:\/\/cognito-idp\.([a-z0-9-]+)\.amazonaws\.com\/([\w-]+_\w+)$/);
  const poolId = a.userPoolId ?? m?.[2], region = poolId?.split('_')[0] ?? m?.[1];
  return poolId && region ? { poolId, region } : null;
}

const attr = (u: any, n: string): string => (u.Attributes ?? u.UserAttributes ?? []).find((x: any) => x.Name === n)?.Value ?? '';
const toUser = (u: any): PoolUser => ({ email: attr(u, 'email') || u.Username, status: u.UserStatus ?? 'UNKNOWN', created: u.UserCreateDate ? new Date(u.UserCreateDate * 1000).toISOString() : null, enabled: u.Enabled !== false });

export function realCognito(a: AuthOptions, creds: () => Promise<AwsCreds> = credentialProvider(), f: typeof fetch = fetch): CognitoAdmin | null {
  const pool = poolOf(a);
  if (!pool) return null;
  const url = `https://cognito-idp.${pool.region}.amazonaws.com/`;
  const call = async (op: string, payload: object): Promise<any> => {
    const body = JSON.stringify({ UserPoolId: pool.poolId, ...payload });
    const headers = signRequest({ method: 'POST', url, region: pool.region, service: 'cognito-idp', creds: await creds(), body,
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityProviderService.${op}` } });
    const r = await f(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new CognitoError(String(j.__type ?? 'Error').split('#').pop()!, j.message ?? j.Message ?? `cognito-idp ${op}: HTTP ${r.status}`);
    return j;
  };
  return {
    createUser: async (email, resend) => { await call('AdminCreateUser', { Username: email, UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }], DesiredDeliveryMediums: ['EMAIL'], TemporaryPassword: tempPassword(), ...(resend ? { MessageAction: 'RESEND' } : {}) }); },
    getUser: async (email) => { try { return toUser(await call('AdminGetUser', { Username: email })); } catch (e: any) { if (e.code === 'UserNotFoundException') return null; throw e; } },
    listUsers: async () => {
      const out: PoolUser[] = []; let token: string | undefined;
      do { const j = await call('ListUsers', { Limit: 60, ...(token ? { PaginationToken: token } : {}) }); out.push(...(j.Users ?? []).map(toUser)); token = j.PaginationToken; } while (token && out.length < 2000);
      return out;
    },
  };
}
