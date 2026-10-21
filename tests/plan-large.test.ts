// Fix #53: an HLD of 114 components makes about 2,300 ops: the plan route takes it in one request and one transaction (the cap is 5000
// ops, the body limit 10 MB); a request over the cap, or with one bad op, writes nothing.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLES, startApp } from './helpers.ts';
import { MAX_OPS } from '../server/store/draft-validate.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  const { drafts: _d, ...recipe } = JSON.parse(readFileSync(join(SAMPLES, 'envs/sase-hld.json'), 'utf8'));
  assert.equal((await app.call('POST', '/api/ingest', { manifests: [JSON.parse(readFileSync(join(SAMPLES, 'users-svc.json'), 'utf8')), JSON.parse(readFileSync(join(SAMPLES, 'auth-svc.json'), 'utf8'))] })).status, 201);
  assert.equal((await app.call('POST', '/api/envs', { ...recipe, services: recipe.services.filter((s: any) => ['users-svc', 'auth-svc'].includes(s.name)) })).status, 201);
});
after(() => app.close());

/** A plan with `n` new components of 20 ops each: header, 6 functions, 6 endpoints, 4 calls, 3 stores. */
function bigPlan(n: number) {
  const manifests = Array.from({ length: n }, (_, k) => {
    const name = `hld-${String(k).padStart(3, '0')}`;
    return {
      schemaVersion: '1.0', kind: 'full', env: 'sase-hld', version: 1, harvestedAt: '2026-10-21T12:00:00Z',
      service: { name, kind: 'service', team: 'design', groupPath: 'platform', description: `Component ${k} of a large design, with a description of the usual length for an HLD.` },
      functions: Array.from({ length: 6 }, (_, i) => ({ id: `fn${i}`, name: `fn${i}`, steps: i < 4 ? [{ seq: 1, type: 'egress', target: `out${i}`, operation: `GET /x${i}` }, { seq: 2, type: 'resource', target: `res${i % 3}`, operation: 'SELECT' }] : [] })),
      ingress: Array.from({ length: 6 }, (_, i) => ({ id: `in${i}`, transport: 'http', bindKey: `http:GET ${name}/r${i}`, handler: `fn${i}`, details: { method: 'GET', path: `/r${i}` } })),
      egress: Array.from({ length: 4 }, (_, i) => ({ id: `out${i}`, transport: 'http', mode: 'sync', bindKey: `http:GET hld-${String((k + 1) % n).padStart(3, '0')}/r${i}` })),
      resources: Array.from({ length: 3 }, (_, i) => ({ id: `res${i}`, kind: 'postgres', name: `t${i}`, bindKey: `postgres:${name}-db/t${i}` })),
    };
  });
  return { planVersion: 1, planId: `big-${n}`, createdAt: '2026-10-21T12:00:00Z', createdBy: 'test', sources: [{ file: 'hld.md' }],
    environment: { name: 'sase-hld', source: 'prod', mode: 'components' }, manifests, extensions: [], flows: [], dtos: [], schemas: [], links: [], mapping: [], questions: [] };
}
const open = async (slug: string) => { assert.equal((await app.call('POST', '/api/envs/sase-hld/drafts', { name: slug, slug })).status, 201); return `/api/envs/sase-hld/drafts/${slug}`; };

test('a 114-component plan (2,280 ops, about 1 MB) is taken in one request and one transaction', async () => {
  const D = await open('big');
  const plan = bigPlan(114), body = JSON.stringify(plan);
  const t0 = Date.now();
  const r = await app.call('POST', `${D}/plan`, plan);
  const ms = Date.now() - t0;
  assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  assert.equal(r.body.ops, 114 * 20); assert.equal(r.body.counts.added, 114);
  assert.equal((await app.call('GET', D)).body.ops.length, 2280);
  console.log(`# plan of ${(body.length / 1024).toFixed(0)} KB, ${r.body.ops} ops: ${ms} ms`);
});

test('over the cap: 422 and nothing written; one bad op in the middle: nothing written either', async () => {
  const D = await open('over');
  const over = await app.call('POST', `${D}/ops`, { ops: Array.from({ length: MAX_OPS + 1 }, (_, i) => ({ op: 'upsert', anchor: `svc:s${i}`, data: { kind: 'service' } })) });
  assert.deepEqual([over.status, over.body.error.code, over.body.error.message], [422, 'INVALID', `at most ${MAX_OPS} ops per request`]);
  const ok = await app.call('POST', `${D}/ops`, { ops: Array.from({ length: MAX_OPS }, (_, i) => ({ op: 'upsert', anchor: `svc:s${i}`, data: { kind: 'service' } })) });
  assert.equal(ok.status, 201, 'exactly the cap is fine');
  const E = await open('half');
  const bad = bigPlan(30); (bad.manifests[29] as any).functions[0].steps[0].target = 'out99';
  const r = await app.call('POST', `${E}/plan`, bad);
  assert.ok(r.status >= 400, JSON.stringify(r.body).slice(0, 200));
  assert.equal((await app.call('GET', E)).body.ops.length, 0, 'all or nothing');
});
