// 0.37.1 (#82): the trace API and MCP trace_flow take detail (default external), choose, open; the page keeps drawing the full trace.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { sampleManifests, sampleModel, startApp } from './helpers.ts';
import { api } from '../web/js/api.js';

let app: Awaited<ReturnType<typeof startApp>>;
const realFetch = globalThis.fetch;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
  globalThis.fetch = ((u: any, o: any) => realFetch(typeof u === 'string' && u.startsWith('/') ? app.base + u : u, o)) as any; // the page's api.js, against this server
});
after(async () => { globalThis.fetch = realFetch; await app.close(); });

const Q = '/api/envs/prod/trace?service=member-api&ingress=in.register';
const get = async (q: string) => (await app.call('GET', Q + q)).body;
const mcp = async (a: object) => JSON.parse((await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'trace_flow', arguments: { env: 'prod', service: 'member-api', ingress: 'in.register', ...a } } })).body.result.content[0].text);
/** What a reader of a message sees, without the code links (they carry the commit the REST data has and the bare model does not). */
const shape = (ms: any[]) => ms.map((m) => [m.kind, m.label, m.from, m.to, m.arms ?? null, m.key ?? null, Object.keys(JSON.parse(JSON.stringify(m))).sort().join()]);
const canonical = () => trace(buildIndex(sampleModel()), { service: 'member-api', ingress: 'in.register' }, { scope: 'full', maxMessages: 500 })!;

test('REST: the default is external, first arm of each decision', async () => {
  const t = await get('');
  assert.equal(t.detail, 'external');
  assert.ok(t.messages.every((m: any) => ['entry', 'egress', 'deliver', 'resource'].includes(m.kind)));
  assert.deepEqual(t.messages.map((m: any) => m.label), ['http:POST member-api/members/register', 'find by email', 'DB: 2 ops (members, devices)']);
  assert.deepEqual(Object.values(t.choose), ['createFromIdp', 'yes']);
  assert.deepEqual(t.decisions.map((d: any) => d.chosen), ['createFromIdp', 'yes']);
  assert.equal(t.counts.messages.min, t.counts.messages.max);
  assert.equal(t.counts.messages.max, t.messages.length);
});

test('REST: detail=full is the canonical trace; choose, open and both', async () => {
  const c = canonical();
  const [gm] = c.decisions!;
  const full = await get('&detail=full&choose=*:both');
  assert.deepEqual(shape(full.messages), shape(c.messages));
  assert.equal((await get(`&detail=full&choose=${gm.group_id}:invite`)).messages.some((m: any) => m.label === 'invite by mail'), true);
  const both = await get('&choose=*:both');
  assert.ok(both.counts.messages.min < both.counts.messages.max, 'min-max only where both is chosen');
  const open = await get('&detail=external&open=member-api:linkExisting');
  assert.deepEqual(open.messages.filter((m: any) => m.kind === 'call').map((m: any) => m.label), ['link the existing user']);
  assert.equal((await get('&choose=nope:x')).warnings[0], 'nope: not a decision of this flow');
});

test('REST: a bad detail is a 400; a flow without alternatives with detail=full is exactly what it was', async () => {
  assert.equal((await app.call('GET', `${Q}&detail=big`)).status, 400);
  assert.equal((await app.call('GET', `${Q}&choose=garbage`)).status, 400);
  assert.equal((await app.call('GET', `${Q}&group=banana`)).status, 400);
  const plain = trace(buildIndex(sampleModel()), { service: 'orders-svc', ingress: 'in.create' }, { scope: 'full', maxMessages: 500 })!;
  const r = (await app.call('GET', '/api/envs/prod/trace?service=orders-svc&ingress=in.create&detail=full')).body;
  assert.deepEqual(shape(r.messages), shape(plain.messages));
  assert.ok(!('decisions' in r) && !('counts' in r));
  const ext = (await app.call('GET', '/api/envs/prod/trace?service=orders-svc&ingress=in.create')).body;
  assert.ok(ext.messages.length < plain.messages.length && ext.messages.every((m: any) => m.key), 'external drops internal calls and stamps the canonical keys');
});

test('MCP trace_flow: external by default, detail full, choose as an object, open as a list', async () => {
  const d = await mcp({});
  assert.equal(d.detail, 'external');
  const gm = canonical().decisions![0].group_id;
  assert.equal((await mcp({ detail: 'full', choose: { '*': 'both' } })).messages.length, canonical().messages.length);
  assert.ok((await mcp({ choose: { [gm]: 'invite' } })).messages.some((m: any) => m.label === 'http:POST member-notifier/invite'));
  assert.ok((await mcp({ open: ['member-api'] })).messages.some((m: any) => m.kind === 'call'));
  const bad = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'trace_flow', arguments: { env: 'prod', service: 'member-api', ingress: 'in.register', detail: 'big' } } });
  assert.equal(bad.body.result.isError, true);
});

test('the page: api.trace asks for the full trace and both arms, so nothing it draws changes', async () => {
  const c = canonical();
  const t = await api.trace('prod', { service: 'member-api', ingress: 'in.register', scope: 'full', maxMessages: 500 });
  assert.deepEqual(shape(t.messages), shape(c.messages));
  assert.equal(t.detail, 'full');
  const o = await api.trace('prod', { service: 'orders-svc', ingress: 'in.create', scope: 'full' });
  const plain = trace(buildIndex(sampleModel()), { service: 'orders-svc', ingress: 'in.create' }, { scope: 'full', maxMessages: 500 })!;
  assert.deepEqual(shape(o.messages), shape(plain.messages), 'a flow without alternatives: what trace() gives');
  assert.deepEqual(Object.keys(o).sort(), Object.keys(plain).sort(), 'and no new field on the trace');
});
