// Auth settings. FLOW_AUTH=off (default) keeps the naive identity of 0.32; cognito turns on sessions, tokens and the access rules. Names match the SSM
// `app-env` parameter that infra/flow-mapper.yaml writes and deploy/install.sh copies into /etc/flow-mapper.env.

export interface AuthOptions {
  mode: 'off' | 'cognito';
  /** https://cognito-idp.<region>.amazonaws.com/<pool id>; its /.well-known/jwks.json holds the signing keys. */
  issuer?: string;
  clientId?: string;
  /** Hosted UI base URL (https://<prefix>.auth.<region>.amazoncognito.com). */
  domain?: string;
  /** The public https origin of this app (CloudFront domain or custom domain); the callback is <publicUrl>/auth/callback. */
  publicUrl?: string;
  /** FLOW_COGNITO_USER_POOL_ID: the pool the invite UI manages (else parsed from the issuer). */
  userPoolId?: string;
  /** Tests: a fake cognito-idp client for the invite endpoints. */
  cognitoAdmin?: import('./cognito-admin.ts').CognitoAdmin;
  /** The first user who signs in with this email becomes an admin. */
  adminEmail?: string;
  /** When set, requests without a matching X-Flows-Origin header get 403 (except /healthz). */
  originSecret?: string;
  /** Tests: the JWKS refetch throttle and the clock. */
  jwksMinRefetchMs?: number;
  now?: () => number;
}

export function authFromEnv(e: NodeJS.ProcessEnv = process.env): AuthOptions {
  const mode = (e.FLOW_AUTH ?? 'off').trim().toLowerCase();
  if (mode !== 'off' && mode !== 'cognito') throw new Error(`FLOW_AUTH must be 'off' or 'cognito', got '${e.FLOW_AUTH}'`);
  const trim = (s?: string) => (s ?? '').trim().replace(/\/+$/, '') || undefined;
  return { mode, issuer: trim(e.FLOW_COGNITO_ISSUER), clientId: e.FLOW_COGNITO_CLIENT_ID?.trim() || undefined, userPoolId: e.FLOW_COGNITO_USER_POOL_ID?.trim() || undefined, domain: trim(e.FLOW_COGNITO_DOMAIN), publicUrl: trim(e.FLOW_PUBLIC_URL),
    adminEmail: e.FLOW_ADMIN_EMAIL?.trim().toLowerCase() || undefined, originSecret: e.FLOW_ORIGIN_SECRET?.trim() || undefined };
}

/** Throws at startup when cognito mode lacks a setting (a half-configured login would fail on the first click). */
export function checkAuth(a: AuthOptions) {
  if (a.mode !== 'cognito') return;
  const names = { issuer: 'FLOW_COGNITO_ISSUER', clientId: 'FLOW_COGNITO_CLIENT_ID', domain: 'FLOW_COGNITO_DOMAIN', publicUrl: 'FLOW_PUBLIC_URL' } as const;
  const missing = (Object.keys(names) as (keyof typeof names)[]).filter((k) => !a[k]).map((k) => names[k]);
  if (missing.length) throw new Error(`FLOW_AUTH=cognito needs ${missing.join(', ')}`);
}
