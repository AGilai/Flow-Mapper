// #120: a sync callee's steps sit between the call and its dashed return (also inside the work of an async consumer).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.ts';

const man = (name: string, kind: string, o: any) => ({ schemaVersion: '1.0', kind: 'full', env: 'prod', service: { name, kind, team: 't' }, version: 1, harvestedAt: '2026-11-17T08:00:00Z', commit: 'a1', functions: [], ingress: [], egress: [], resources: [], channels: [], ...o });
const mer = async (a: any, svc: string, ing: string, detail: string) => (await a.call('GET', `/api/envs/prod/flows/mermaid?service=${svc}&ingress=${ing}&detail=${detail}`)).body as string;
const lines = (s: string) => s.split('\n');
const at = (s: string, re: RegExp) => lines(s).findIndex((l) => re.test(l));

const caller120 = () => man('demo120-caller', 'service', {
  functions: [{ id: 'run', name: 'run', steps: [{ seq: 1, type: 'egress', target: 'out.nets', returns: { label: 'ready networks' } }, { seq: 2, type: 'resource', target: 'db', operation: 'save' }] }],
  ingress: [{ id: 'in.run', bindKey: 'http:POST demo120-caller/run', transport: 'http', handler: 'run', entryPoint: true }],
  egress: [{ id: 'out.nets', bindKey: 'http:GET demo120-nets/networks', transport: 'http', mode: 'sync' }],
  resources: [{ id: 'db', bindKey: 'mongodb:demo120-db/runs', kind: 'mongodb', name: 'db' }],
});
const nets120 = () => man('demo120-nets', 'service', {
  functions: [{ id: 'list', name: 'list', steps: [{ seq: 1, type: 'resource', target: 'tdb', operation: 'find networks' }] }],
  ingress: [{ id: 'in.nets', bindKey: 'http:GET demo120-nets/networks', transport: 'http', handler: 'list' }],
  resources: [{ id: 'tdb', bindKey: 'mongodb:demo120-db/networks', kind: 'mongodb', name: 'db' }],
});

for (const detail of ['full', 'simple']) test(`#120 (${detail}): call, callee steps, then the dashed return`, async () => {
  const a = await startApp();
  for (const m of [caller120(), nets120()]) assert.equal((await a.call('POST', '/api/ingest', m)).status, 201);
  const s = await mer(a, 'demo120-caller', 'in.run', detail);
  const call = at(s, /->>demo120_nets: /), step = at(s, /find networks/), ret = at(s, /-->>.*ready networks/);
  assert.ok(call >= 0 && step > call && ret > step, s);
  await a.close();
});

// #120 as the reporter has it: the sync call sits in the work of an async consumer (messages that carry `of`).
test('#120: a sync call with returns inside an async consumer keeps its callee steps before the return', async () => {
  const a = await startApp();
  const c = caller120(); c.functions[0].steps = [{ seq: 1, type: 'egress', target: 'out.q', mode: 'async' }]; c.egress.push({ id: 'out.q', bindKey: 'sqs:demo120-q', transport: 'sqs', mode: 'async' } as any); (c as any).channels = [{ bindKey: 'sqs:demo120-q', kind: 'sqs-queue', name: 'demo120-q' }];
  const w = man('demo120-worker', 'service', { functions: [{ id: 'work', name: 'work', steps: [{ seq: 1, type: 'egress', target: 'out.nets', returns: { label: 'ready networks' } }, { seq: 2, type: 'resource', target: 'wdb', operation: 'save result' }] }], ingress: [{ id: 'in.q', bindKey: 'sqs:demo120-q', transport: 'sqs', handler: 'work' }], egress: [{ id: 'out.nets', bindKey: 'http:GET demo120-nets/networks', transport: 'http', mode: 'sync' }], resources: [{ id: 'wdb', bindKey: 'mongodb:demo120-db/w', kind: 'mongodb', name: 'db' }] });
  for (const m of [c, w, nets120()]) assert.equal((await a.call(
'POST', '/api/ingest', m)).status, 201);
  for (const detail of [
'full', 'simple']) {
    const s = await mer(a, 'demo120-caller', 'in.run', detail);
    assert.ok(at(s, /->>demo120_nets: /) >= 0 && at(s, /find networks/) > at(s, /->>demo120_nets: /) && at(s, /-->>.*ready networks/) > at(s, /find networks/) && at(s, /save result/) > at(s, /-->>.*ready networks/), detail + s);
  }
  await a.close();
});

