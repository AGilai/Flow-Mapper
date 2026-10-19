// Bug #22: a resource can say why its key is unresolved (same shape as egress), without a bindKey.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sampleManifests, startApp } from './helpers.ts';
import { contractReport } from '../core/contract.ts';
import { buildIndex } from '../core/graph-index.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
});
after(() => app.close());

test('an unresolved resource is accepted, listed in health and stands alone as a store', async () => {
  const h = (await app.call('GET', '/api/envs/prod/health')).body;
  const u = h.items.unresolved.find((x: any) => x.kind === 'resource' && x.id === 'sessionCache');
  assert.deepEqual([u.what, u.reason], ['target', 'redis_no_key_pattern']);
  const s = (await app.call('GET', `/api/envs/prod/stores/${encodeURIComponent('orders-svc:sessionCache')}`)).body;
  assert.equal(s.keyUnknown, 'redis_no_key_pattern');
  assert.deepEqual(s.siblings, []);
  assert.ok(!h.items.unusedStores.some((x: any) => x.key === 'orders-svc:sessionCache'));
});

test('the contract warns about an empty detail on a resource', () => {
  const m = { service: 'a', resources: [{ id: 'r', unresolved: [{ what: 'target' as const, reason: 'x', detail: '' }] }] };
  const f = contractReport(m, buildIndex({ services: [], functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [] } as any)).findings;
  assert.ok(f.some((x) => x.code === 'unresolved-no-detail' && x.kind === 'resource'));
});
