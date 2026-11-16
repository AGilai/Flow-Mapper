// #116: the client app that calls an entry ingress (egress bind key = the socket / entry http ingress key) is the trace's caller lifeline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, readSample } from './helpers.ts';

const gw = () => readSample('demo-agent-apigw-ws.json'), lam = () => readSample('demo-agent-lambda-connect.json'), app1 = () => readSample('demo-agent-app.json');
const app2 = () => { const m = app1(); m.service.name = 'demo-agent-app-2'; return m; };
const trace = (a: any) => a.call('GET', '/api/envs/prod/trace?service=demo-agent-apigw-ws&ingress=in.ws.connect&scope=full').then((r: any) => r.body);
const entries = (a: any) => a.call('GET', '/api/envs/prod/entry-points').then((r: any) => r.body.find((e: any) => e.id === 'in.ws.connect'));
async function load(...ms: any[]) {
  const a = await startApp();
  for (const m of ms) assert.equal((await a.call('POST', '/api/ingest', m)).status, 201);
  return a;
}

test('no client app: the caller stays "client", no callers field', async () => {
  const a = await load(gw(), lam());
  const t = await trace(a);
  assert.deepEqual(t.participants.find((p: any) => p.kind === 'client'), { id: 'client', label: 'client', kind: 'client' });
  assert.equal(t.messages[0].callers, undefined);
  assert.equal((await entries(a)).callers, undefined);
  await a.close();
});

test('one client app: it is the caller; the flow still goes gateway -> SQS -> lambda', async () => {
  const a = await load(gw(), lam(), app1());
  const t = await trace(a);
  const c = t.participants.find((p: any) => p.kind === 'client');
  assert.equal(c.label, 'demo-agent-app');
  assert.deepEqual(c.callers, ['demo-agent-app']);
  assert.deepEqual(t.messages[0].callers, ['demo-agent-app']);
  assert.equal(t.messages[0].kind, 'entry');
  assert.ok(t.messages.some((m: any) => m.to === 'svc:demo-agent-lambda-connect'));
  await a.close();
});

test('several client apps: the first and "+N", all of them in callers', async () => {
  const a = await load(gw(), lam(), app1(), app2());
  const t = await trace(a);
  assert.equal(t.participants.find((p: any) => p.kind === 'client').label, 'demo-agent-app +1');
  assert.deepEqual(t.messages[0].callers, ['demo-agent-app', 'demo-agent-app-2']);
  await a.close();
});

test('entry-points items carry callers; the client app has no entry point and its egress is not dangling', async () => {
  const a = await load(gw(), lam(), app1());
  assert.deepEqual((await entries(a)).callers, ['demo-agent-app']);
  const list = (await a.call('GET', '/api/envs/prod/entry-points')).body;
  assert.ok(!list.some((e: any) => e.service === 'demo-agent-app'));
  assert.ok(list.find((e: any) => e.id === 'in.ws.connect').entryPoint);
  const h = await a.call('GET', '/api/envs/prod/health');
  assert.equal(h.body.items.dangling.filter((d: any) => d.service === 'demo-agent-app').length, 0);
  const info = await a.call('GET', '/api/envs/prod/endpoints/demo-agent-apigw-ws/in.ws.connect');
  assert.deepEqual(info.body.callers, ['demo-agent-app']);
  await a.close();
});

test('an http ingress counts only when it is an entry point; a non-client-app egress never does', async () => {
  const g = gw();
  g.ingress.push({ id: 'in.http', bindKey: 'http:GET demo-agent-apigw-ws/ping', transport: 'http', handler: 'onConnect', entryPoint: true });
  const c = app1();
  c.egress.push({ id: 'out.ping', bindKey: 'http:GET demo-agent-apigw-ws/ping', transport: 'http' });
  const other = app2(); other.service.kind = 'service'; // a plain service with the same egress: not a client app
  const a = await load(g, lam(), c, other);
  const list = (await a.call('GET', '/api/envs/prod/entry-points')).body;
  assert.deepEqual(list.find((e: any) => e.id === 'in.http').callers, ['demo-agent-app']);
  assert.deepEqual(list.find((e: any) => e.id === 'in.ws.connect').callers, ['demo-agent-app']);
  await a.close();
});
