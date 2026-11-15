// A fake Cognito for tests and for browser QA of cognito mode (never the real service): an RSA key, a JWKS, an auto-approving /oauth2/authorize,
// /oauth2/token (PKCE checked) that signs ID tokens, and /logout. Standalone: `node tests/fake-idp.ts <port> <app public url>` serves it on a scratch port;
// POST /__user {email,name,sub} picks who the next sign-in is.

import { createServer, type Server } from 'node:http';
import { createHash, generateKeyPairSync, randomBytes, sign as rsaSign, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

export interface IdpUser { sub: string; email: string; name?: string }
const b64u = (x: Buffer | string) => Buffer.from(x).toString('base64url');

export function newKey(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } as any };
}
export function signJwt(claims: object, key: { kid: string; privateKey: KeyObject }, header: object = {}): string {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header })), p = b64u(JSON.stringify(claims));
  return `${h}.${p}.${b64u(rsaSign('RSA-SHA256', Buffer.from(`${h}.${p}`), key.privateKey))}`;
}

export async function startIdp(opts: { port?: number } = {}) {
  let keys = [newKey('k1')];
  let user: IdpUser = { sub: 'sub-alice', email: 'alice@example.com', name: 'Alice Test' };
  const codes = new Map<string, { challenge: string; user: IdpUser; redirect: string }>();
  const state = { jwksFetches: 0, clientId: 'test-client', ttlS: 3600, now: () => Date.now() };
  let base = '';
  const issuer = () => `${base}/pool`;
  const idToken = (u: IdpUser, over: object = {}, key = keys[0]) => signJwt({ sub: u.sub, email: u.email, email_verified: true, name: u.name, token_use: 'id', iss: issuer(), aud: state.clientId,
    iat: Math.floor(state.now() / 1000), exp: Math.floor(state.now() / 1000) + state.ttlS, ...over }, key);
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base || 'http://x');
    const json = (s: number, v: unknown) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (url.pathname === '/pool/.well-known/jwks.json') { state.jwksFetches++; return json(200, { keys: keys.map((k) => k.jwk) }); }
    if (url.pathname === '/oauth2/authorize') {
      const code = randomBytes(12).toString('hex');
      codes.set(code, { challenge: url.searchParams.get('code_challenge') ?? '', user, redirect: url.searchParams.get('redirect_uri') ?? '' });
      res.writeHead(302, { location: `${url.searchParams.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(url.searchParams.get('state') ?? '')}` }); return void res.end();
    }
    if (url.pathname === '/oauth2/token' && req.method === 'POST') {
      let raw = ''; for await (const c of req) raw += c;
      const f = new URLSearchParams(raw), c = codes.get(f.get('code') ?? '');
      codes.delete(f.get('code') ?? '');
      if (!c || f.get('client_id') !== state.clientId || f.get('redirect_uri') !== c.redirect || createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url') !== c.challenge) return json(400, { error: 'invalid_grant' });
      return json(200, { id_token: idToken(c.user), access_token: 'x', token_type: 'Bearer', expires_in: state.ttlS });
    }
    if (url.pathname === '/logout') { res.writeHead(302, { location: url.searchParams.get('logout_uri') ?? '/' }); return void res.end(); }
    if (url.pathname === '/__user' && req.method === 'POST') { let raw = ''; for await (const c of req) raw += c; user = { ...user, ...JSON.parse(raw) }; return json(200, user); }
    json(404, { error: 'not found' });
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base, get issuer() { return issuer(); }, get clientId() { return state.clientId; }, state, idToken,
    get key() { return keys[0]; }, setUser(u: Partial<IdpUser>) { user = { ...user, ...u }; },
    /** Cognito rotates its keys: new signing key, the old one is gone from the JWKS. */
    rotate(kid = 'k' + (keys.length + 1)) { keys = [newKey(kid)]; return keys[0]; },
    close: () => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const idp = await startIdp({ port: Number(process.argv[2] ?? 3542) });
  console.log(JSON.stringify({ base: idp.base, issuer: idp.issuer, clientId: idp.clientId }));
}
