// 0.33.0: merging a user re-points the owners and the About mentions that name the merged id (component headers, subsystems, drafts), and drops the duplicate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign } from './helpers.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());

test('merge: owners and @[id] in an about move to the surviving user; a list that names both keeps one; drafts follow', async () => {
  const dana = (await app.call('POST', '/api/users', { name: 'Dana Levi' })).body, ron = (await app.call('POST', '/api/users', { name: 'Ron' })).body;
  const slug = (await app.call('POST', '/api/envs/hld/drafts', { name: 'merge' })).body.slug as string;
  const edit = (e: object) => app.call('POST', `/api/envs/hld/drafts/${slug}/edits`, { edit: e, author: 'ana' });
  assert.equal((await edit({ kind: 'component', name: 'users-svc', serviceKind: 'service', owners: [ron.id, dana.id], about: `Ask @[${ron.id}]` })).status, 201);
  assert.equal((await edit({ kind: 'subsystem', key: 'platform', owners: [ron.id], about: `Led by @[${ron.id}]` })).status, 201);
  // a sealed environment's header and subsystem too
  const m = (await app.call('GET', '/api/envs/prod/services/orders-svc')).body.service;
  const ing = await app.call('POST', '/api/ingest', { schemaVersion: '1.0', kind: 'delta', env: 'prod', service: { name: 'orders-svc', owners: [ron.id], about: `Owner: @[${ron.id}]` }, baseVersion: m.version, version: m.version + 1, harvestedAt: '2026-10-22T00:00:00Z' });
  assert.equal(ing.status, 201, JSON.stringify(ing.body));
  assert.equal((await app.call('PUT', '/api/envs/prod/subsystems', { subsystems: [{ key: 'core', label: 'Core', owners: [ron.id] }] })).status, 200);

  assert.equal((await app.call('POST', `/api/users/${ron.id}/merge`, { into: dana.id })).status, 200);

  const svc = (await app.call('GET', `/api/envs/hld/services/users-svc?draft=${slug}`)).body.service;
  assert.deepEqual(svc.owners, [dana.id], 'both owners were the same person now: one');
  assert.equal(svc.about, `Ask @[${dana.id}]`);
  const sub = (await app.call('GET', `/api/envs/hld/subsystems?draft=${slug}`)).body.subsystems.find((s: any) => s.key === 'platform');
  assert.deepEqual(sub.owners, [dana.id]);
  assert.equal(sub.about, `Led by @[${dana.id}]`);
  const prod = (await app.call('GET', '/api/envs/prod/services/orders-svc')).body.service;
  assert.deepEqual(prod.owners, [dana.id]);
  assert.equal(prod.about, `Owner: @[${dana.id}]`);
  assert.deepEqual((await app.call('GET', '/api/envs/prod/subsystems')).body.subsystems.find((s: any) => s.key === 'core').owners, [dana.id]);
  // the about mentions now count for Dana, none for the merged one
  assert.deepEqual((await app.call('GET', `/api/mentions?user=${dana.id}`)).body.about.map((a: any) => `${a.env}:${a.kind}:${a.id}`).sort(), ['prod:component:orders-svc']);
  assert.ok(!JSON.stringify((await app.call('GET', `/api/envs/hld/drafts/${slug}`)).body.ops).includes(ron.id), 'no op of the draft names the merged id');
});
