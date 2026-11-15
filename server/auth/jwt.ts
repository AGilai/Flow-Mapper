// Verifies a Cognito ID token (RS256) with node:crypto: signature against the issuer's JWKS, then iss, aud, exp and token_use.
// The JWKS is cached; a token with an unknown `kid` (Cognito rotated its keys) triggers one refetch, at most once per `minRefetchMs`.

import { createPublicKey, verify, type KeyObject } from 'node:crypto';

export class AuthError extends Error {}
export interface Claims { sub: string; iss: string; aud: string; exp: number; token_use: string; email?: string; email_verified?: boolean | string; name?: string; 'cognito:username'?: string; [k: string]: unknown }
const b64 = (s: string) => Buffer.from(s, 'base64url');

export class Jwks {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private inflight: Promise<void> | null = null;
  private url: string; private minRefetchMs: number; private ttlMs: number; private now: () => number; private doFetch: typeof fetch;
  constructor(url: string, minRefetchMs = 30_000, ttlMs = 6 * 3600_000, now: () => number = Date.now, doFetch: typeof fetch = fetch) {
    this.url = url; this.minRefetchMs = minRefetchMs; this.ttlMs = ttlMs; this.now = now; this.doFetch = doFetch;
  }

  private async load() {
    const res = await this.doFetch(this.url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new AuthError(`JWKS fetch failed: HTTP ${res.status}`);
    const body = await res.json() as { keys?: (JsonWebKey & { kid?: string })[] };
    const next = new Map<string, KeyObject>();
    for (const k of body.keys ?? []) if (k.kid && k.kty === 'RSA') next.set(k.kid, createPublicKey({ key: k, format: 'jwk' }));
    this.keys = next; this.fetchedAt = this.now();
  }
  private refresh() { return (this.inflight ??= this.load().finally(() => { this.inflight = null; })); }

  async key(kid: string): Promise<KeyObject> {
    const age = this.now() - this.fetchedAt;
    if (!this.keys.size || age > this.ttlMs || (!this.keys.has(kid) && age >= this.minRefetchMs)) await this.refresh();
    const k = this.keys.get(kid);
    if (!k) throw new AuthError(`unknown signing key '${kid}'`);
    return k;
  }
}

export async function verifyIdToken(token: string, jwks: Jwks, want: { issuer: string; clientId: string; now?: () => number }): Promise<Claims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('malformed token');
  let header: any, claims: any;
  try { header = JSON.parse(b64(parts[0]).toString('utf8')); claims = JSON.parse(b64(parts[1]).toString('utf8')); } catch { throw new AuthError('malformed token'); }
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string') throw new AuthError('unsupported token algorithm');
  const key = await jwks.key(header.kid);
  if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, b64(parts[2]))) throw new AuthError('bad signature');
  const nowS = Math.floor((want.now ?? Date.now)() / 1000);
  if (claims.iss !== want.issuer) throw new AuthError('wrong issuer');
  if (claims.aud !== want.clientId) throw new AuthError('wrong audience');
  if (claims.token_use !== 'id') throw new AuthError('not an ID token');
  if (typeof claims.exp !== 'number' || claims.exp <= nowS) throw new AuthError('token expired');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new AuthError('token has no subject');
  return claims as Claims;
}
