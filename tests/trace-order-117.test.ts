// #117: a client app that is the entry caller and a later push target is one lifeline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.ts';

const man = (name: string, kind: string, o: any) => ({ schemaVersion: '1.0', kind: 'full', env: 'prod', service: { name, kind, team: 't' }, version: 1, harvestedAt: '2026-11-17T08:00:00Z', commit: 'a1', functions: [], ingress: [], egress: [], resources: [], channels: [], ...o });
const mer = async (a: any, svc: string, ing: string, detail: string) => (await a.call('GET', `/api/envs/prod/flows/mermaid?service=${svc}&ingress=${ing}&detail=${detail}`)).body as string;
const lines = (s: string) => s.split('\n');
const at = (s: string, re: RegExp) => lines(s).findIndex((l) => re.test(l));

const gw117 = () => man('demo117-gw', 'gateway', {
  functions: [{ id: 'onConnect', name: 'onConnect', steps: [{ seq: 1, type: 'egress', target: 'out.push', mode: 'async' }] }],
  ingress: [{ id: 'in.ws.connect', bindKey: 'socket:ws/demo117-gw/$connect', transport: 'socket', handler: 'onConnect', details: { protocol: 'ws', event: '$connect' } }],
  egress: [{ id: 'out.push', bindKey: 'socket:ws/demo117-app/push', transport: 'socket', mode: 'async' }],
});
const app117 = (name = 'demo117-app') => man(name, 'client-app', {
  ingress: [{ id: 'in.push', bindKey: 'socket:ws/demo117-app/push', transport: 'socket', entryPoint: false, details: { protocol: 'ws', event: 'push', direction: 'push' } }],
  egress: [{ id: 'out.connect', bindKey: 'socket:ws/demo117-gw/$connect', transport: 'socket' }],
});

for (const detail of ['full', 'simple']) test(`#117 (${detail}): the client app that is caller and push target is one lifeline`, async () => {
  const a = await startApp();
  for (const m of [gw117(), app117()]) assert.equal((await a.call('POST', '/api/ingest', m)).status, 201);
  const s = await mer(a, 'demo117-gw', 'in.ws.connect', detail);
  assert.equal(lines(s).filter((l) => /^(actor|participant) /.test(l) && /demo117.app/.test(l)).length, 1, s);
  await a.close();
});

test('#117: with several callers the client lifeline and the push target stay apart', async () => {
  const a = await startApp();
  for (const m of [gw117(), app117(), app117('demo117-app-2')]) assert.equal((await a.call('POST', '/api/ingest', m)).status, 201);
  const t = (await a.call('GET', '/api/envs/prod/trace?service=demo117-gw&ingress=in.ws.connect&scope=full')).body;
  assert.equal(t.participants.filter((p: any) => p.id === 'client' || p.service === 'demo117-app').length, 2);
  await a.close();
});
