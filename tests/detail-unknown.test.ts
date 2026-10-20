// #45 (0.17.3): `unresolved` what=detail names a field the harvester could not read (details.databases on an instance,
// client.databases on a service resource, details.keyTemplate / dbIndex / ttlSeconds on a step). Shown as "unknown (reason)";
// never a broken link. Demo: samples infra (cache-main), shipping-svc (client.databases), orders-svc in.get step 4.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sampleManifests, sampleModel, startApp } from './helpers.ts';
import { buildIndex } from '../core/graph-index.ts';
import { instanceView } from '../core/instances.ts';
import { trace } from '../core/trace.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
});
after(() => app.close());

const manifest = (what: string) => ({ ...sampleManifests().find((m: any) => m.service.name === 'shipping-svc'), version: 5, functions: [], ingress: [], egress: [], bindings: [], channels: [],
  resources: [{ id: 'c', kind: 'redis', name: 'c', bindKey: 'redis:cache-main/x:{id}', unresolved: [{ what, detail: 'client.databases', reason: 'db_from_runtime_config' }] }] });

test('what=detail is accepted; an unknown `what` is still a 422', async () => {
  const r = await app.call('POST', '/api/ingest?dryRun=1', { manifests: [manifest('detail')] });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 400));
  assert.equal((await app.call('POST', '/api/ingest?dryRun=1', { manifests: [manifest('databases')] })).status, 422);
});

test('the instance page says which fields are unknown and why', () => {
  const g = buildIndex(sampleModel());
  const v = instanceView(g, 'redis:cache-main')!;
  assert.deepEqual(v.unknown, [{ field: 'databases', reason: 'databases_not_in_cfg' }]);
  assert.equal(v.lanes.find((l) => l.service === 'shipping-svc')!.databasesUnknown, 'db_from_runtime_config');
  assert.equal(v.lanes.find((l) => l.service === 'orders-svc')!.databasesUnknown, undefined);
});

test('a resource step carries its unknown details on the trace message', () => {
  const g = buildIndex(sampleModel());
  const msgs = trace(g, { service: 'orders-svc', ingress: 'in.get' }, { scope: 'intra' }).messages as any[];
  const m = msgs.find((x) => x.seq === 4);
  assert.deepEqual(m.unknown, [{ field: 'keyTemplate', reason: 'key_unresolved:call_result:keyFn' }, { field: 'ttlSeconds', reason: 'ttlSeconds:computed' }]);
  assert.equal(msgs.find((x) => x.seq === 1)?.unknown, undefined);
});

test('unknown fields are reported as unresolved, not as broken links', async () => {
  const h = (await app.call('GET', '/api/envs/prod/health')).body;
  const items = h.items.unresolved.filter((x: any) => x.what === 'detail');
  assert.ok(items.length >= 4);
  assert.ok(items.every((x: any) => x.detail && x.reason));
  const broken = JSON.stringify([h.items.dangling, h.items.orphans, h.items.unbound, h.items.ambiguous]);
  assert.ok(!broken.includes('OrderController.get') && !broken.includes('db_from_runtime_config'));
});
