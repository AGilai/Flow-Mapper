// 0.44.0 (#90): the trace API and MCP trace_flow take detail=simple (the API default stays external) and unfold.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sampleManifests, startApp } from './helpers.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201); });
after(async () => { await app.close(); });

const Q = '/api/envs/prod/trace?service=profile-svc&ingress=in.updateProfile';
const get = async (q: string) => (await app.call('GET', Q + q)).body;
const mcp = async (a: object) => JSON.parse((await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'trace_flow', arguments: { env: 'prod', service: 'profile-svc', ingress: 'in.updateProfile', ...a } } })).body.result.content[0].text);

test('REST: detail=simple draws each call once and flattens the decisions; the default is still external', async () => {
  const s = await get('&detail=simple');
  assert.equal(s.detail, 'simple');
  assert.deepEqual(s.messages.map((m: any) => m.label), ['http:PATCH profile-svc/api/v1/profiles/{id}', '*3 get, set', '*3 findOne', 'http:POST mailer-svc/mail', 'http:POST audit-trail-svc/audit', 'http:POST audit-trail-svc/audit ↩ seen at step 5']);
  assert.equal(s.flattened, 1);
  assert.equal(s.decisions, undefined);
  assert.equal(s.truncated, false);
  assert.equal(s.messages[1].occurrences.length, 3);
  assert.equal(s.messages[1].dbGroup.calls.length, 2);
  assert.equal(s.participants.find((p: any) => p.id === 'svc:profile-svc').hiddenSteps, 5);
  const e = await get('');
  assert.equal(e.detail, 'external');
  assert.ok(e.decisions.length === 1 && e.messages.length > s.messages.length);
});

test('REST: simple is cut at maxMessages after consolidating; a bad detail is a 400', async () => {
  const s = await get('&detail=simple&maxMessages=3');
  assert.equal(s.messages.length, 3);
  assert.equal(s.truncated, true);
  assert.equal((await app.call('GET', Q + '&detail=huge')).status, 400);
});

test('MCP trace_flow: detail simple has the new fields', async () => {
  const s = await mcp({ detail: 'simple' });
  assert.equal(s.detail, 'simple');
  assert.equal(s.flattened, 1);
  assert.ok(s.messages.some((m: any) => m.occurrences) && s.messages.some((m: any) => m.repeatOf));
  assert.equal(typeof s.participants.find((p: any) => p.kind === 'service').hiddenSteps, 'number');
  assert.equal((await mcp({})).detail, 'external');
});

test('unfold: the repeat marker of a Full view is expanded in place', async () => {
  const R = '/api/envs/prod/trace?service=roles-svc&ingress=in.removeUser&detail=full&group=1'; // a view that is not the canonical trace itself carries the step keys
  const full = (await app.call('GET', R)).body, m = full.messages.find((x: any) => x.repeatOf);
  assert.ok(m, 'RoleAggregator.aggregate is called from three places: two repeat markers');
  const u = (await app.call('GET', `${R}&unfold=${encodeURIComponent(m.key)}`)).body;
  assert.ok(u.messages.some((x: any) => x.unfoldOf), 'the first expansion is copied under the marker');
  assert.equal(u.messages.filter((x: any) => !x.unfoldOf).length, full.messages.length);
});
