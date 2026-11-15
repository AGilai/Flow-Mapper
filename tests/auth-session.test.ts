// Cognito mode: the sign-in flow, JWT verification, sessions, CSRF, bearer tokens (create, use, revoke, expiry, last_used) and the origin header. Fake Cognito only.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startCognito } from './cognito-helpers.ts';
import { newKey, signJwt } from './fake-idp.ts';

let t: Awaited<ReturnType<typeof startCognito>>;
let clock = Date.now();
before(async () => { t = await startCognito({ now: () => clock }); });
after(() => t.close());

const code = (r: { body: any }) => r.body?.error?.code;

test('unauthenticated: the API and MCP are 401, the open endpoints are not', async () => {
  for (const p of ['/api/envs', '/api/envs/meta', '/api/users', '/api/bugs', '/api/events/recent']) assert.equal((await t.anon.call('GET', p)).status, 401, p);
  const m = await t.anon.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(m.status, 401);
  assert.equal(code(m), 'UNAUTHENTICATED');
  assert.equal((await t.anon.call('GET', '/healthz')).status, 200);
  assert.equal((await t.anon.call('GET', '/api/version')).status, 200);
  const me = await t.anon.call('GET', '/api/me');
  assert.deepEqual([me.status, me.body.signedIn, me.body.loginUrl], [200, false, '/auth/login']);
  const shell = await fetch(t.base + '/');
  assert.equal(shell.status, 200, 'the SPA shell stays public');
});

test('sign-in: PKCE redirect, session cookie flags, user created from the claims, returnTo kept', async () => {
  const r = await fetch(t.base + '/auth/login', { redirect: 'manual' });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location')!);
  assert.equal(loc.origin + loc.pathname, t.idp.base + '/oauth2/authorize');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(loc.searchParams.get('redirect_uri'), t.base + '/auth/callback');
  const s = await t.signIn('bob@example.com', 'Bob Builder');
  assert.equal(s.location, '/#/flows');
  assert.equal(s.me.user.name, 'Bob Builder');
  assert.equal(s.me.user.email, 'bob@example.com');
  assert.equal(s.me.admin, false);
  const again = await t.signIn('bob@example.com', 'Bob Builder');
  assert.equal(again.id, s.id, 'the same sub is the same user');
  assert.equal((await s.call('GET', '/api/envs')).status, 200);
});

test('the session cookie is httpOnly, SameSite=Lax and signed; the csrf cookie is readable', async () => {
  t.idp.setUser({ email: 'cookie@example.com', sub: 'sub-cookie', name: 'Cookie' });
  let res = await fetch(t.base + '/auth/login', { redirect: 'manual' });
  const oidc = res.headers.getSetCookie()[0].split(';')[0];
  res = await fetch(res.headers.get('location')!, { redirect: 'manual' });
  res = await fetch(res.headers.get('location')!, { redirect: 'manual', headers: { cookie: oidc } });
  const sc = res.headers.getSetCookie();
  const session = sc.find((c) => c.startsWith('fm_session='))!, csrf = sc.find((c) => c.startsWith('fm_csrf='))!;
  assert.match(session, /HttpOnly/); assert.match(session, /SameSite=Lax/); assert.match(session, /Max-Age=2592000/);
  assert.doesNotMatch(csrf, /HttpOnly/);
  const forged = session.split(';')[0].replace(/\.[^.]+$/, '.AAAA');
  assert.equal((await fetch(t.base + '/api/envs', { headers: { cookie: forged } })).status, 401, 'a cookie with a wrong signature is no session');
});

test('callback refuses a missing or mismatched state, and a failed exchange', async () => {
  assert.equal((await t.anon.call('GET', '/auth/callback?code=x&state=y')).status, 400);
  let res = await fetch(t.base + '/auth/login', { redirect: 'manual' });
  const oidc = res.headers.getSetCookie()[0].split(';')[0];
  const bad = await fetch(t.base + '/auth/callback?code=nope&state=wrong', { redirect: 'manual', headers: { cookie: oidc } });
  assert.equal(bad.status, 400);
  res = await fetch(res.headers.get('location')!, { redirect: 'manual' });
  const state = new URL(res.headers.get('location')!).searchParams.get('state');
  const nocode = await fetch(t.base + `/auth/callback?code=bogus&state=${state}`, { redirect: 'manual', headers: { cookie: oidc } });
  assert.equal(nocode.status, 400);
});

test('JWT checks: bad signature, wrong aud, wrong iss, expired, wrong token_use are all refused at the callback', async () => {
  const u = { sub: 'sub-x', email: 'x@example.com', name: 'X' };
  const { Jwks, verifyIdToken } = await import('../server/auth/jwt.ts');
  const jwks = new Jwks(`${t.idp.issuer}/.well-known/jwks.json`, 0);
  const want = { issuer: t.idp.issuer, clientId: t.idp.clientId };
  const base = { sub: u.sub, token_use: 'id', iss: t.idp.issuer, aud: t.idp.clientId, exp: Math.floor(Date.now() / 1000) + 600 };
  const good = signJwt(base, t.idp.key);
  assert.equal((await verifyIdToken(good, jwks, want)).sub, 'sub-x', 'good token');
  const other = newKey(t.idp.key.kid); // same kid, another key: the signature cannot match
  await assert.rejects(verifyIdToken(signJwt(base, other), jwks, want), /bad signature/);
  await assert.rejects(verifyIdToken(signJwt({ ...base, aud: 'someone-else' }, t.idp.key), jwks, want), /audience/);
  await assert.rejects(verifyIdToken(signJwt({ ...base, iss: 'https://evil.example/pool' }, t.idp.key), jwks, want), /issuer/);
  await assert.rejects(verifyIdToken(signJwt({ ...base, exp: Math.floor(Date.now() / 1000) - 5 }, t.idp.key), jwks, want), /expired/);
  await assert.rejects(verifyIdToken(signJwt({ ...base, token_use: 'access' }, t.idp.key), jwks, want), /ID token/);
  await assert.rejects(verifyIdToken(good.replace(/^[^.]+/, Buffer.from('{"alg":"none","kid":"k1"}').toString('base64url')), jwks, want), /algorithm/);
  await assert.rejects(verifyIdToken('a.b', jwks, want), /malformed/);
});

test('an unknown kid makes the JWKS refetch once (key rotation), and the new key then verifies', async () => {
  const { Jwks, verifyIdToken } = await import('../server/auth/jwt.ts');
  const jwks = new Jwks(`${t.idp.issuer}/.well-known/jwks.json`, 0);
  const want = { issuer: t.idp.issuer, clientId: t.idp.clientId };
  const claims = { sub: 'sub-r', token_use: 'id', iss: t.idp.issuer, aud: t.idp.clientId, exp: Math.floor(Date.now() / 1000) + 600 };
  await verifyIdToken(signJwt(claims, t.idp.key), jwks, want);
  const before = t.idp.state.jwksFetches;
  await verifyIdToken(signJwt(claims, t.idp.key), jwks, want);
  assert.equal(t.idp.state.jwksFetches, before, 'a known kid is served from the cache');
  const rotated = t.idp.rotate('k-rotated');
  await verifyIdToken(signJwt(claims, rotated), jwks, want);
  assert.equal(t.idp.state.jwksFetches, before + 1, 'the unknown kid caused one refetch');
  await assert.rejects(verifyIdToken(signJwt(claims, newKey('k-never-published')), jwks, want), /unknown signing key/);
});

test('CSRF: a cookie session must send X-Flows-CSRF on writes; a bearer token needs none; reads need none', async () => {
  const s = await t.signIn('csrf@example.com', 'Csrf');
  const raw = (headers: Record<string, string>) => fetch(t.base + '/api/tokens', { method: 'POST', headers: { 'content-type': 'application/json', cookie: [...s.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...headers }, body: '{"name":"x"}' });
  const no = await raw({});
  assert.equal(no.status, 403); assert.equal((await no.json()).error.code, 'CSRF');
  assert.equal((await raw({ 'x-flows-csrf': 'wrong' })).status, 403);
  assert.equal((await raw({ 'x-flows-csrf': s.cookies.get('fm_csrf')! })).status, 201);
  const tok = await t.token(s, 'for-bearer');
  const b = t.bearer(tok.token);
  assert.equal((await b.call('POST', '/api/tokens', { name: 'second' })).status, 201, 'bearer: no CSRF header needed');
});

test('tokens: shown once, hashed, last_used updates, revoke kills it, others cannot see or revoke it', async () => {
  const s = await t.signIn('tok@example.com', 'Tok');
  const made = await t.token(s, 'laptop');
  assert.match(made.token, /^fm_[A-Za-z0-9_-]{40,}$/);
  const row = t.ctx.db.prepare('SELECT hash, last_used_at FROM api_tokens WHERE id = ?').get(made.id) as any;
  assert.notEqual(row.hash, made.token); assert.equal(row.hash.length, 64); assert.equal(row.last_used_at, null);
  const list = (await s.call('GET', '/api/tokens')).body.tokens;
  assert.equal(list.length, 1); assert.equal(list[0].token, undefined, 'the list never carries the token');
  const b = t.bearer(made.token);
  const me = await b.call('GET', '/api/me');
  assert.equal(me.body.user.name, 'Tok'); assert.equal(me.body.via, 'token');
  assert.ok((t.ctx.db.prepare('SELECT last_used_at FROM api_tokens WHERE id = ?').get(made.id) as any).last_used_at, 'last_used_at is set on use');
  const other = await t.signIn('other@example.com', 'Other');
  assert.equal((await other.call('DELETE', `/api/tokens/${made.id}`)).status, 404);
  assert.equal((await s.call('DELETE', `/api/tokens/${made.id}`)).status, 200);
  const dead = await b.call('GET', '/api/envs');
  assert.equal(dead.status, 401); assert.equal(code(dead), 'TOKEN_INVALID');
  assert.ok((await s.call('GET', '/api/tokens')).body.tokens[0].revokedAt);
  assert.equal((await t.bearer('fm_garbage').call('GET', '/api/envs')).status, 401);
  assert.equal((await t.bearer('notmine').call('GET', '/api/envs')).status, 401);
});

test('token expiry: never by default, 30/90/365 days, an expired token is 401 TOKEN_EXPIRED naming the token', async () => {
  const s = await t.signIn('exp@example.com', 'Exp');
  const never = await t.token(s, 'forever');
  assert.equal(never.expiresAt ?? null, null);
  const t30 = await t.token(s, 'month', { expiresInDays: 30 });
  const t365 = await t.token(s, 'year', { expiresInDays: 365 });
  assert.equal(Math.round((Date.parse((t30 as any).expiresAt) - clock) / 86400_000), 30);
  assert.equal(Math.round((Date.parse((t365 as any).expiresAt) - clock) / 86400_000), 365);
  assert.equal((await s.call('POST', '/api/tokens', { name: 'bad', expiresInDays: 7 })).status, 400);
  assert.equal((await t.bearer(t30.token).call('GET', '/api/envs')).status, 200);
  clock += 31 * 86400_000;
  try {
    const r = await t.bearer(t30.token).call('GET', '/api/envs');
    assert.equal(r.status, 401); assert.equal(code(r), 'TOKEN_EXPIRED');
    assert.match(r.body.error.message, /'month'/); assert.match(r.body.error.message, /Tokens/);
    assert.equal((await t.bearer(never.token).call('GET', '/api/envs')).status, 200, 'never expires');
    assert.equal((await t.bearer(t365.token).call('GET', '/api/envs')).status, 200);
    const m = await t.bearer(t30.token).call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(code(m), 'TOKEN_EXPIRED');
  } finally { clock -= 31 * 86400_000; }
});

test('only an admin can create a harvester token; the first sign-in with FLOW_ADMIN_EMAIL is the admin', async () => {
  const u = await t.signIn('plain@example.com', 'Plain');
  assert.equal((await u.call('POST', '/api/tokens', { name: 'h', scope: 'harvester' })).status, 403);
  const admin = await t.signIn('admin@example.com', 'Admin');
  assert.equal(admin.me.admin, true);
  assert.equal((await admin.call('POST', '/api/tokens', { name: 'h', scope: 'harvester' })).status, 201);
});

test('a session slides: it lasts 30 days from the last use, and logout ends it', async () => {
  const s = await t.signIn('slide@example.com', 'Slide');
  clock += 29 * 86400_000;
  try {
    assert.equal((await s.call('GET', '/api/envs')).status, 200);
    clock += 29 * 86400_000;
    assert.equal((await s.call('GET', '/api/envs')).status, 200, 'still signed in 58 days after sign-in: it slid');
    clock += 31 * 86400_000;
    assert.equal((await s.call('GET', '/api/envs')).status, 401, '31 days idle: expired');
  } finally { clock = Date.now(); }
  const s2 = await t.signIn('slide2@example.com', 'Slide Two');
  const out = await s2.call('GET', '/auth/logout');
  assert.equal(out.status, 302); assert.match(out.headers.get('location')!, /\/logout\?client_id=test-client/);
  assert.equal((await s2.call('GET', '/api/envs')).status, 401, 'the server forgot the session');
});

test('origin header: with FLOW_ORIGIN_SECRET every request needs X-Flows-Origin, except /healthz', async () => {
  const o = await startCognito({ originSecret: 'sekrit-origin-value' });
  try {
    assert.equal((await o.anon.call('GET', '/healthz')).status, 200);
    for (const p of ['/', '/api/version', '/api/envs', '/auth/login']) assert.equal((await o.anon.call('GET', p)).status, 403, p);
    assert.equal(code(await o.anon.call('GET', '/api/version')), 'FORBIDDEN_ORIGIN');
    assert.equal((await o.anon.call('GET', '/api/version', undefined, { 'x-flows-origin': 'wrong' })).status, 403);
    assert.equal((await o.anon.call('GET', '/api/version', undefined, { 'x-flows-origin': 'sekrit-origin-value' })).status, 200);
    assert.equal((await o.anon.call('GET', '/', undefined, { 'x-flows-origin': 'sekrit-origin-value' })).status, 200);
  } finally { await o.close(); }
});
