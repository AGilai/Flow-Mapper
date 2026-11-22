// 0.70.1: an older import may carry details.product as an object (or details.icon as a non-string): ingest and draft apply keep it untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findings } from '../core/type-report.ts';
import { startApp, startDesign, readSample } from './helpers.ts';

const PRODUCT = { vendor: 'HashiCorp', name: 'Vault', engine: 'kv-v2', docs: 'https://developer.hashicorp.com/vault' };

test('ingest: details.product as an object and a non-string details.icon are accepted and round-trip unchanged', async () => {
  const app = await startApp();
  const m = readSample('lo-hi-plain.json');
  m.service.details = { product: PRODUCT, icon: { legacy: true } };
  const r = await app.call('POST', '/api/ingest', { manifests: [m] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const s = (await app.call('GET', '/api/envs/prod/services')).body.find((x: any) => x.name === 'lo-hi-plain');
  assert.deepEqual(s.details.product, PRODUCT);
  assert.deepEqual(s.details.icon, { legacy: true });
  m.version = 2; m.commit = 'next';
  assert.equal((await app.call('POST', '/api/ingest', { manifests: [m] })).status, 201, 're-ingest');
  await app.close();
});

test('draft apply: a component whose details.product is an object applies and keeps the value', async () => {
  const app = await startDesign('hld');
  const slug = (await app.call('POST', '/api/envs/hld/drafts', { name: 'legacy' })).body.slug;
  const cur = (await app.call('GET', '/api/envs/hld/services')).body.find((x: any) => x.name === 'users-svc');
  const up = await app.call('POST', `/api/envs/hld/drafts/${slug}/ops`, { ops: [{ op: 'upsert', anchor: 'svc:users-svc', data: { kind: cur.kind, details: { ...(cur.details ?? {}), product: PRODUCT, icon: 5 } } }] });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const ap = await app.call('POST', `/api/envs/hld/drafts/${slug}/apply`, { by: 'ana' });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  const after = (await app.call('GET', '/api/envs/hld/services')).body.find((x: any) => x.name === 'users-svc');
  assert.deepEqual(after.details.product, PRODUCT);
  await app.close();
});

test('type-report: a non-string product is flagged product-object, a string product is not', () => {
  const f = findings({ kind: 'service', details: { product: PRODUCT } });
  assert.deepEqual(f.map((x) => x.reason), ['product-object']);
  assert.match(f[0].value, /HashiCorp/);
  assert.deepEqual(findings({ details: { product: 'HashiCorp Vault' } }), []);
});
