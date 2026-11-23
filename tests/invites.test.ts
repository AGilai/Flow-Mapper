// CR #134: the SigV4 signer (AWS test-suite vector), the credential provider, the cognito-idp client request shape, and POST/GET /api/admin/invites with a fake pool.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signRequest } from '../server/auth/aws-sigv4.ts';
import { credentialProvider } from '../server/auth/aws-creds.ts';
import { CognitoError, poolOf, realCognito, type CognitoAdmin, type PoolUser } from '../server/auth/cognito-admin.ts';
import { parseEmails } from '../core/invite-emails.ts';
import { startApp } from './helpers.ts';
import { startCognito } from './cognito-helpers.ts';

const creds = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };

test('SigV4: the AWS test suite get-vanilla vector', () => {
  const h = signRequest({ method: 'GET', url: 'https://example.amazonaws.com/', region: 'us-east-1', service: 'service', creds, date: new Date('2015-08-30T12:36:00Z') });
  assert.equal(h.Authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  assert.equal(h['x-amz-date'], '20150830T123600Z');
});

test('SigV4: a session token is signed too', () => {
  const h = signRequest({ method: 'POST', url: 'https://x.amazonaws.com/', region: 'eu-west-1', service: 'cognito-idp', creds: { ...creds, sessionToken: 'TOK' }, body: '{}', date: new Date('2015-08-30T12:36:00Z') });
  assert.match(h.Authorization, /SignedHeaders=host;x-amz-date;x-amz-security-token,/);
  assert.equal(h['x-amz-security-token'], 'TOK');
});

test('credentials: env first, else IMDSv2 (token, role, keys) cached until shortly before Expiration', async () => {
  assert.deepEqual(await credentialProvider({ AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b', AWS_SESSION_TOKEN: 't' })(), { accessKeyId: 'a', secretAccessKey: 'b', sessionToken: 't' });
  const calls: string[] = []; let now = Date.parse('2026-01-01T00:00:00Z');
  const f = (async (url: string, init: any = {}) => {
    calls.push(`${init.method ?? 'GET'} ${url}`);
    if (url.endsWith('/api/token')) return new Response('imds-token');
    assert.equal(init.headers['X-aws-ec2-metadata-token'], 'imds-token');
    if (url.endsWith('/security-credentials/')) return new Response('flows-role\n');
    return Response.json({ AccessKeyId: 'AK', SecretAccessKey: 'SK', Token: 'T', Expiration: '2026-01-01T06:00:00Z' });
  }) as unknown as typeof fetch;
  const get = credentialProvider({}, f, () => now);
  assert.equal((await get()).accessKeyId, 'AK');
  assert.equal(calls.length, 3);
  await get(); assert.equal(calls.length, 3, 'cached');
  now = Date.parse('2026-01-01T05:56:00Z'); await get(); assert.equal(calls.length, 6, 'refreshed 5 minutes before it expires');
  assert.equal(calls[0], 'PUT http://169.254.169.254/latest/api/token');
});

test('pool id and region: env value first, else the issuer', () => {
  assert.deepEqual(poolOf({ mode: 'cognito', issuer: 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_AbC123' }), { poolId: 'eu-west-1_AbC123', region: 'eu-west-1' });
  assert.deepEqual(poolOf({ mode: 'cognito', userPoolId: 'us-east-2_Zz', issuer: 'http://localhost:1/pool' }), { poolId: 'us-east-2_Zz', region: 'us-east-2' });
  assert.equal(poolOf({ mode: 'cognito', issuer: 'http://localhost:1/pool' }), null);
});

test('cognito-idp client: signed JSON POST with the right target and AdminCreateUser body; errors keep their type', async () => {
  const seen: any[] = [];
  const f = (async (url: string, init: any) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const op = init.headers['x-amz-target'].split('.')[1];
    if (op === 'AdminCreateUser' && seen.length === 2) return Response.json({ __type: 'UsernameExistsException', message: 'exists' }, { status: 400 });
    if (op === 'ListUsers') return Response.json({ Users: [{ Username: 'u1', UserStatus: 'CONFIRMED', UserCreateDate: 1700000000, Attributes: [{ Name: 'email', Value: 'a@b.co' }] }] });
    return Response.json({ User: {} });
  }) as unknown as typeof fetch;
  const c = realCognito({ mode: 'cognito', userPoolId: 'eu-west-1_P' }, async () => ({ ...creds, sessionToken: 'T' }), f)!;
  await c.createUser('a@b.co', false);
  const s = seen[0];
  assert.equal(s.url, 'https://cognito-idp.eu-west-1.amazonaws.com/');
  assert.equal(s.headers['x-amz-target'], 'AWSCognitoIdentityProviderService.AdminCreateUser');
  assert.equal(s.headers['content-type'], 'application/x-amz-json-1.1');
  assert.match(s.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-west-1\/cognito-idp\/aws4_request/);
  assert.match(s.body.TemporaryPassword, /^[A-Za-z0-9]{16}$/);
  assert.deepEqual({ ...s.body, TemporaryPassword: undefined }, { UserPoolId: 'eu-west-1_P', Username: 'a@b.co', UserAttributes: [{ Name: 'email', Value: 'a@b.co' }, { Name: 'email_verified', Value: 'true' }], DesiredDeliveryMediums: ['EMAIL'], TemporaryPassword: undefined });
  await assert.rejects(c.createUser('a@b.co', true), (e: any) => e instanceof CognitoError && e.code === 'UsernameExistsException');
  assert.equal(seen[1].body.MessageAction, 'RESEND');
  assert.match(seen[1].body.TemporaryPassword, /^[A-Za-z0-9]{16}$/);
  const list = await c.listUsers();
  assert.deepEqual(list, [{ email: 'a@b.co', status: 'CONFIRMED', created: '2023-11-14T22:13:20.000Z', enabled: true }]);
});

test('parseEmails: separators, case, duplicates, invalid tokens', () => {
  assert.deepEqual(parseEmails('A@x.com, b@x.com;c@x.com\n a@X.com  nope  d@x'), { emails: ['a@x.com', 'b@x.com', 'c@x.com'], bad: ['nope', 'd@x'] });
});

function fakePool(): CognitoAdmin & { users: Map<string, PoolUser>; calls: string[] } {
  const users = new Map<string, PoolUser>([['pending@x.com', { email: 'pending@x.com', status: 'FORCE_CHANGE_PASSWORD', created: '2026-01-02T00:00:00.000Z', enabled: true }], ['done@x.com', { email: 'done@x.com', status: 'CONFIRMED', created: '2026-01-01T00:00:00.000Z', enabled: true }]]);
  const calls: string[] = [];
  return { users, calls,
    async createUser(email, resend) {
      calls.push(`${resend ? 'resend' : 'create'} ${email}`);
      if (email.startsWith('boom')) throw new CognitoError('InvalidParameterException', 'bad things');
      if (users.has(email)) { if (resend && users.get(email)!.status === 'FORCE_CHANGE_PASSWORD') return; throw new CognitoError('UsernameExistsException', 'exists'); }
      if (resend) throw new CognitoError('UserNotFoundException', 'nope');
      users.set(email, { email, status: 'FORCE_CHANGE_PASSWORD', created: '2026-02-01T00:00:00.000Z', enabled: true });
    },
    async getUser(email) { return users.get(email) ?? null; },
    async listUsers() { return [...users.values()]; } };
}

test('invites: admin only, statuses, resend, validation, listing', async () => {
  const pool = fakePool();
  const t = await startCognito({ cognitoAdmin: pool });
  try {
    const anon = await t.anon.call('POST', '/api/admin/invites', { emails: ['n@x.com'] });
    assert.equal(anon.status, 401);
    const bob = await t.signIn('bob@example.com', 'Bob');
    assert.equal((await bob.call('POST', '/api/admin/invites', { emails: ['n@x.com'] })).status, 403);
    assert.equal((await bob.call('GET', '/api/admin/invites')).status, 403);
    const admin = await t.signIn('admin@example.com', 'Admin');
    const r = await admin.call('POST', '/api/admin/invites', { emails: ['New@x.com', 'done@x.com', 'pending@x.com', 'boom@x.com', 'not-an-email', 'new@x.com'] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.results.map((x: any) => [x.email, x.status]), [['new@x.com', 'invited'], ['done@x.com', 'exists'], ['pending@x.com', 'pending'], ['boom@x.com', 'failed'], ['not-an-email', 'failed']]);
    assert.match(r.body.results[3].message, /bad things/);
    const again = await admin.call('POST', '/api/admin/invites', { emails: ['pending@x.com', 'done@x.com'], resend: true });
    assert.deepEqual(again.body.results.map((x: any) => x.status), ['invited', 'exists']);
    assert.ok(pool.calls.includes('resend pending@x.com'));
    assert.equal((await admin.call('POST', '/api/admin/invites', { emails: [] })).status, 400);
    assert.equal((await admin.call('POST', '/api/admin/invites', {})).status, 400);
    const l = await admin.call('GET', '/api/admin/invites');
    assert.equal(l.status, 200);
    assert.deepEqual(l.body.users.map((u: any) => u.email), ['new@x.com', 'pending@x.com', 'done@x.com'], 'newest first');
    assert.equal((await admin.call('GET', '/api/me')).body.auth, 'cognito');
  } finally { await t.close(); }
});

test('invites: cognito without a user pool is a clear 409; auth off is 404', async () => {
  const t = await startCognito();
  try {
    const admin = await t.signIn('admin@example.com', 'Admin');
    const r = await admin.call('GET', '/api/admin/invites');
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /FLOW_COGNITO_USER_POOL_ID/);
  } finally { await t.close(); }
  const off = await startApp();
  try {
    const r = await off.call('POST', '/api/admin/invites', { emails: ['a@x.com'] });
    assert.equal(r.status, 404);
    assert.match(r.body.error.message, /FLOW_AUTH=off/);
  } finally { await off.close(); }
});
