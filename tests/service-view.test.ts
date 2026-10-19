// Service view: ingress "from" honours subscription event filters; unresolved egress without a key stays identifiable.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.ts';

let app: Awaited<ReturnType<typeof startApp>>;
const base = (name: string) => ({ schemaVersion: '1.0', kind: 'full', env: 'e', service: { name, kind: 'service' }, version: 1, harvestedAt: '2026-10-19T08:00:00Z' });
const pub = (id: string, extra: object) => ({ id, bindKey: 'sns:t', transport: 'sns', ...extra });

before(async () => {
  app = await startApp();
  const manifests = [
    { ...base('infra'), service: { name: 'infra', kind: 'infra' },
      channels: [{ bindKey: 'sns:t', kind: 'sns-topic' }, { bindKey: 'sqs:q', kind: 'sqs-queue' }],
      bindings: [{ id: 'sub', from: 'sns:t', to: 'sqs:q', events: ['a.hit'] }] },
    { ...base('consumer'), functions: [{ id: 'h', name: 'h', steps: [] }], ingress: [{ id: 'in', bindKey: 'sqs:q', transport: 'sqs', handler: 'h' }],
      egress: [{ id: 'src/x.ts:177', transport: 'http', unresolved: [{ what: 'target', reason: 'endpoint_key_unmappable' }] }] },
    { ...base('p-hit'), egress: [pub('e', { events: ['a.hit'] })] },
    { ...base('p-miss'), egress: [pub('e', { events: ['b.other'] })] },
    { ...base('p-maybe'), egress: [pub('e', { unresolved: [{ what: 'event', reason: 'dynamic' }] })] },
    { ...base('p-cand'), egress: [pub('e', { unresolved: [{ what: 'event', reason: 'dynamic', candidates: ['a.hit', 'c.x'] }] })] },
    { ...base('p-candmiss'), egress: [pub('e', { unresolved: [{ what: 'event', reason: 'dynamic', candidates: ['c.x'] }] })] },
  ];
  const r = await app.call('POST', '/api/ingest', { manifests });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});
after(() => app.close());

test('ingress "from" lists only publishers whose events pass the subscription filter', async () => {
  const v = (await app.call('GET', '/api/envs/e/views/service/consumer')).body;
  const ing = v.ingress[0];
  assert.deepEqual(ing.callers.map((c: any) => c.service), ['p-hit']);
  assert.deepEqual(ing.maybeCallers.map((c: any) => c.service).sort(), ['p-cand', 'p-maybe']);
});

test('an unresolved egress without a bind key keeps its id and reason in the view data', async () => {
  const v = (await app.call('GET', '/api/envs/e/views/service/consumer')).body;
  const e = v.egress[0];
  assert.equal(e.id, 'src/x.ts:177');
  assert.equal(e.unresolved[0].reason, 'endpoint_key_unmappable');
});
