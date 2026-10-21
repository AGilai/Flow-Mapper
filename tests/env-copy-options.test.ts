// Components copy options: entryPoints (#63) and infraGroupPath (#64).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sampleManifests, startApp } from './helpers.ts';
import { entryPoints } from '../core/trace.ts';

let app: Awaited<ReturnType<typeof startApp>>;
const q = (sql: string, ...a: any[]) => app.ctx.db.prepare(sql).all(...a) as any[];
const create = (body: any) => app.call('POST', '/api/envs', body);
const PICK = ['orders-svc', 'users-svc', 'payments-svc'];
const pick = PICK.map((name) => ({ name }));

before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
});
after(() => app.close());

test('#63 entryPoints none: copied ingress are not entry points, diff as unchanged, later ingress still count', async () => {
  for (const bad of ['all', true, 'NONE']) assert.equal((await create({ name: 'ep-x', source: 'prod', mode: 'components', entryPoints: bad, services: pick })).status, 422);
  assert.equal((await create({ name: 'ep-x', source: 'prod', mode: 'blank', entryPoints: 'none' })).status, 422);
  const eps = (env: string) => entryPoints(app.ctx.graph(env)).filter((e) => PICK.includes(e.service));
  assert.equal((await create({ name: 'ep-keep', source: 'prod', mode: 'components', entryPoints: 'keep', services: pick })).status, 201);
  assert.ok(eps('ep-keep').length > 0);
  const r = await create({ name: 'ep-none', source: 'prod', mode: 'components', entryPoints: 'none', behaviour: true, services: pick });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(eps('ep-none').length, 0, 'no copied entry points');
  const ing = q("SELECT data FROM entities WHERE env = 'ep-none' AND list = 'ingress'").map((x) => JSON.parse(x.data));
  const bi = q("SELECT data FROM baseline_items WHERE env = 'ep-none' AND list = 'ingress'").map((x) => JSON.parse(x.data));
  assert.ok(ing.length > 0 && ing.length === bi.length);
  assert.ok([...ing, ...bi].every((d) => d.entryPoint === false));
  const m = (await app.call('GET', '/api/envs/ep-none/marks')).body;
  assert.deepEqual(m.marks, {}); assert.deepEqual(m.ghosts, {});
  // an ingress added later in a draft is not touched by the option
  assert.equal((await app.call('POST', '/api/envs/ep-none/drafts', { name: 'later', slug: 'later' })).status, 201);
  const op = { op: 'upsert', anchor: 'ing:orders-svc/in.later', data: { id: 'in.later', bindKey: 'http:GET orders-svc/later', transport: 'http', handler: q("SELECT key FROM entities WHERE env = 'ep-none' AND service = 'orders-svc' AND list = 'functions'")[0].key, entryPoint: true } };
  { const o = await app.call('POST', '/api/envs/ep-none/drafts/later/ops', { ops: [op] }); assert.equal(o.status, 201, JSON.stringify(o.body)); }
  { const a = await app.call('POST', '/api/envs/ep-none/drafts/later/apply', {}); assert.equal(a.status, 200, JSON.stringify(a.body)); }
  assert.deepEqual(eps('ep-none').map((e) => e.id), ['in.later']);
  // a full copy honours it too
  assert.equal((await create({ name: 'ep-full', source: 'prod', mode: 'full', entryPoints: 'none' })).status, 201);
  const some = q("SELECT count(*) AS n FROM entities WHERE env = 'ep-full' AND list = 'ingress'")[0].n;
  assert.ok(some > 0);
  assert.equal(q("SELECT count(*) AS n FROM entities WHERE env = 'ep-full' AND list = 'ingress' AND json_extract(data, '$.entryPoint') = 0")[0].n, some);
});
