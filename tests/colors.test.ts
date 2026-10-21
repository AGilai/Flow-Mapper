// Component colours: a slot 1..8 per component and environment, first seen first served, kept for good (a deleted component keeps its slot),
// none for client apps, a copy keeps its source's slots. Returned per environment by GET /api/envs/meta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignColors } from '../core/colors.ts';
import { startApp } from './helpers.ts';

const names = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ name: `c${from + i}` }));

test('assignColors: lowest free slot in order, no clash up to 8, the palette repeats in order after that, client apps get none, existing slots stay', () => {
  const eight = assignColors({}, names(8));
  assert.deepEqual(Object.values(eight), [1, 2, 3, 4, 5, 6, 7, 8]);
  const more = assignColors(eight, names(3, 8));
  assert.deepEqual([more.c8, more.c9, more.c10], [1, 2, 3], 'the 9th component repeats the palette from slot 1');
  assert.deepEqual(assignColors({ a: 3 }, [{ name: 'b' }, { name: 'app', kind: 'client-app' }, { name: 'a' }]), { a: 3, b: 1 });
  assert.deepEqual(assignColors({ a: 1, b: 3 }, [{ name: 'c' }, { name: 'd' }]), { a: 1, b: 3, c: 2, d: 4 }, 'free slots are reused lowest first');
  assert.deepEqual(assignColors({}, [{ name: 'x', kind: 'infra' }, { name: 'y', kind: 'external' }]), { x: 1 });
});

const man = (name: string, version = 1, kind = 'service') => ({ schemaVersion: '1.0', kind: 'full', env: 'col', service: { name, kind }, version, harvestedAt: '2026-10-21T00:00:00Z' });
const colors = async (app: any, env: string) => (await app.call('GET', '/api/envs/meta')).body.find((e: any) => e.name === env).colors;

test('ingest assigns on first sight, re-ingest keeps, delete and re-add keeps the same slot; meta returns it per environment', async () => {
  const app = await startApp();
  try {
    for (const n of ['a', 'b', 'c']) assert.equal((await app.call('POST', '/api/ingest', man(n))).status, 201);
    assert.equal((await app.call('POST', '/api/ingest', man('app', 1, 'client-app'))).status, 201);
    assert.deepEqual(await colors(app, 'col'), { a: 1, b: 2, c: 3 });
    assert.equal((await app.call('POST', '/api/ingest', { ...man('a', 2) })).status, 201);
    assert.deepEqual(await colors(app, 'col'), { a: 1, b: 2, c: 3 }, 'same slots after a re-ingest');
    assert.equal((await app.call('POST', '/api/envs', { name: 'dcol', source: 'col', mode: 'blank' })).status, 201);
    assert.equal((await app.call('POST', '/api/envs', { name: 'dcopy', source: 'col', mode: 'components', services: [{ name: 'c' }, { name: 'a' }] })).status, 201);
    assert.deepEqual(await colors(app, 'dcopy'), { c: 3, a: 1 }, 'a copy keeps the source\'s slots');
    assert.deepEqual(await colors(app, 'dcol'), {});
    // a draft: a new component gets the next slot at edit time; delete + re-add keeps it
    const d = (await app.call('POST', '/api/envs/dcopy/drafts', { name: 'x' })).body.slug;
    assert.equal((await app.call('POST', `/api/envs/dcopy/drafts/${d}/ops`, { ops: [{ op: 'upsert', anchor: 'svc:n1', data: { kind: 'service' } }] })).status, 201);
    assert.equal((await colors(app, 'dcopy')).n1, 2, 'the lowest free slot of this environment');
    assert.equal((await app.call('POST', `/api/envs/dcopy/drafts/${d}/apply`, { by: 'me' })).status, 200);
    await app.call('POST', `/api/envs/dcopy/drafts/${(await app.call('POST', '/api/envs/dcopy/drafts', { name: 'y' })).body.slug}/ops`, { ops: [{ op: 'delete', anchor: 'svc:n1' }] });
    const e = (await app.call('POST', '/api/envs/dcopy/drafts', { name: 'z' })).body.slug;
    await app.call('POST', `/api/envs/dcopy/drafts/${e}/ops`, { ops: [{ op: 'upsert', anchor: 'svc:n1', data: { kind: 'service' } }] });
    assert.equal((await colors(app, 'dcopy')).n1, 2, 'a component added again keeps its slot');
    // more than 8: no clash up to 8, then the palette repeats
    for (let i = 0; i < 10; i++) await app.call('POST', '/api/ingest', man(`m${i}`));
    const all = Object.values(await colors(app, 'col')) as number[];
    assert.equal(new Set(all.slice(0, 8)).size, 8);
    assert.ok(all.every((s) => s >= 1 && s <= 8));
    assert.deepEqual((await app.call('GET', '/api/envs/col/meta')).body.colors, await colors(app, 'col'));
  } finally { await app.close(); }
});
