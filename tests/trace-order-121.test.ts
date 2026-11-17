// #121: the work of an async consumer is drawn in the frame of its trigger, never in a later unrelated frame.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.ts';

const man = (name: string, kind: string, o: any) => ({ schemaVersion: '1.0', kind: 'full', env: 'prod', service: { name, kind, team: 't' }, version: 1, harvestedAt: '2026-11-17T08:00:00Z', commit: 'a1', functions: [], ingress: [], egress: [], resources: [], channels: [], ...o });
const mer = async (a: any, svc: string, ing: string, detail: string) => (await a.call('GET', `/api/envs/prod/flows/mermaid?service=${svc}&ingress=${ing}&detail=${detail}`)).body as string;
const lines = (s: string) => s.split('\n');
const at = (s: string, re: RegExp) => lines(s).findIndex((l) => re.test(l));

const f121 = () => man('demo121-pub', 'service', {
  functions: [{ id: 'rebuild', name: 'rebuild', steps: [
    { seq: 1, type: 'egress', target: 'out.chg', mode: 'async', groups: [{ id: 'each', kind: 'loop', condition: 'each tenant' }] },
    { seq: 2, type: 'resource', target: 'db', operation: 'phase 1 write' },
    { seq: 3, type: 'resource', target: 'db', operation: 'phase 2 write', groups: [{ id: 'flag', kind: 'opt', condition: 'feature flag on' }] },
  ] }],
  ingress: [{ id: 'in.run', bindKey: 'http:POST demo121-pub/run', transport: 'http', handler: 'rebuild', entryPoint: true }],
  egress: [{ id: 'out.chg', bindKey: 'sqs:demo121-changes', transport: 'sqs', mode: 'async' }],
  resources: [{ id: 'db', bindKey: 'mongodb:demo121-db/t', kind: 'mongodb', name: 'db' }],
  channels: [{ bindKey: 'sqs:demo121-changes', kind: 'sqs-queue', name: 'demo121-changes' }],
});
const c121 = () => man('demo121-ctl', 'service', {
  functions: [{ id: 'onChange', name: 'onChange', steps: [{ seq: 1, type: 'resource', target: 'cdb', operation: 'consume work' }] }],
  ingress: [{ id: 'in.chg', bindKey: 'sqs:demo121-changes', transport: 'sqs', handler: 'onChange' }],
  resources: [{ id: 'cdb', bindKey: 'mongodb:demo121-db/ctl', kind: 'mongodb', name: 'db' }],
});

test('#121: the consumer of a step inside a loop is drawn inside the loop of its trigger, never in the later opt', async () => {
  const a = await startApp();
  for (const m of [f121(), c121()]) assert.equal((await a.call('POST', '/api/ingest', m)).status, 201);
  const s = await mer(a, 'demo121-pub', 'in.run', 'full');
  const loopEnd = lines(s).findIndex((l, i) => i > at(s, /^loop/) && l === 'end'), cons = at(s, /consume work/), opt = at(s, /^opt/);
  assert.ok(loopEnd >= 0 && cons > at(s, /^loop/) && cons < loopEnd && loopEnd < opt, s);
  await a.close();
});


test('#121: a consumer started outside any frame is drawn before the next frame opens, not inside it', async () => {
  const a = await startApp();
  const f = f121(); delete (f.functions[0].steps[0] as any).groups;
  for (const m of [f, c121()]) assert.equal((await a.call(
'POST', '/api/ingest', m)).status, 201);
  const s = await mer(a, 'demo121-pub', 'in.run', 'full');
  assert.ok(at(s, /consume work/) > at(s, /phase 1 write/) && at(s, /consume work/) < at(s, /^opt/), s);
  await a.close();
});

