// #47 (0.25.2): `assumed: [{what, value, basis, reason, detail?}]`, the mirror of `unresolved`: a value filled by a default rule,
// not read from code. Accepted wherever `unresolved` is and on Redis key entries; shown as a muted badge; an informational
// health category (not a link problem, not in the coverage figure); returned verbatim by API and MCP.
// Demo: samples auth-svc (client.databases [0], client_default) and orders-svc in.get step 3 (details.ttlSeconds).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sampleManifests, sampleModel, startApp } from './helpers.ts';
import { buildIndex } from '../core/graph-index.ts';
import { instanceView } from '../core/instances.ts';
import { health } from '../core/health.ts';
import { trace } from '../core/trace.ts';
import { normaliseKeys } from '../core/keys.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
});
after(() => app.close());

const A = { what: 'detail', detail: 'client.databases', value: [0], basis: 'client_default', reason: 'no db option, URL has no path -> default 0' };
const base = () => ({ ...sampleManifests().find((m: any) => m.service.name === 'shipping-svc'), version: 9, functions: [], ingress: [], egress: [], bindings: [], channels: [], resources: [] as any[] });
const dry = (m: any) => app.call('POST', '/api/ingest?dryRun=1', { manifests: [m] });
const mcp = async (name: string, args: object) => JSON.parse((await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { env: 'prod', ...args } } })).body.result.content[0].text);

test('assumed is accepted on resources, steps, ingress, egress and functions; a missing basis or reason is a 422', async () => {
  const m: any = sampleManifests().find((x: any) => x.service.name === 'orders-svc');
  const mod = JSON.parse(JSON.stringify(m)); mod.version = 99;
  mod.resources[0].assumed = [A]; mod.ingress[0].assumed = [{ what: 'detail', detail: 'details.method', value: 'GET', basis: 'convention', reason: 'x' }];
  mod.egress[0].assumed = [A]; mod.functions[0].assumed = [A]; mod.functions[0].steps[0].assumed = [{ ...A, value: null }];
  const ok = await dry(mod);
  assert.equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 400));
  for (const bad of [{ what: 'database', value: 0, reason: 'r' }, { what: 'database', value: 0, basis: 'b' }, { value: 0, basis: 'b', reason: 'r' }]) {
    mod.resources[0].assumed = [bad];
    assert.equal((await dry(mod)).status, 422, JSON.stringify(bad));
  }
});

test('contract: one field both unresolved and assumed is a finding; one or the other is not', async () => {
  const m = base();
  m.resources = [{ id: 'c', kind: 'redis', name: 'c', bindKey: 'redis:cache-main/x:{id}', assumed: [A], unresolved: [{ what: 'detail', detail: 'client.databases', reason: 'db_from_runtime_config' }] }];
  const r = await dry(m);
  assert.ok(r.body.results[0].contract.findings.some((f: any) => f.code === 'assumed-and-unresolved' && f.kind === 'resource' && f.level === 'warn'), JSON.stringify(r.body.results[0].contract));
  m.resources[0].unresolved = [{ what: 'detail', detail: 'details.ttlSeconds', reason: 'computed' }];
  assert.ok(!(await dry(m)).body.results[0].contract.findings.some((f: any) => f.code === 'assumed-and-unresolved'));
});

test('health: an informational `assumed` category, per service and per basis, not in unresolved or coverage', async () => {
  const h = (await app.call('GET', '/api/envs/prod/health')).body;
  assert.ok(h.totals.assumed >= 2, 'the demo has an assumed database and an assumed step detail');
  assert.equal(h.items.assumed.length, h.totals.assumed);
  const db = h.items.assumed.find((x: any) => x.service === 'auth-svc');
  assert.deepEqual([db.kind, db.what, db.detail, db.value, db.basis], ['resource', 'detail', 'client.databases', [0], 'client_default']);
  assert.ok(db.reason);
  assert.equal(h.services.find((s: any) => s.service === 'auth-svc').assumed, 1);
  assert.equal(h.assumedByBasis.client_default, h.items.assumed.filter((x: any) => x.basis === 'client_default').length);
  assert.ok(h.items.assumed.some((x: any) => x.kind === 'step' && x.service === 'orders-svc'));
  assert.equal(h.items.unresolved.some((x: any) => x.basis), false);
  const stripped = sampleModel();
  for (const l of ['resources', 'ingress', 'egress']) for (const e of stripped[l]) delete e.assumed;
  for (const f of stripped.functions) { delete f.assumed; for (const s of f.steps) delete s.assumed; }
  const h0 = health(buildIndex(stripped)), h1 = health(buildIndex(sampleModel()));
  assert.equal(h1.totals.coverage, h0.totals.coverage);
  assert.deepEqual(h1.services.map((s) => [s.service, s.dangling, s.orphans, s.unresolved]), h0.services.map((s) => [s.service, s.dangling, s.orphans, s.unresolved]));
  assert.equal(h0.totals.assumed, 0);
});

test('the instance page and the trace carry the assumed values', () => {
  const g = buildIndex(sampleModel());
  const lane = instanceView(g, 'redis:auth-cache')!.lanes.find((l) => l.service === 'auth-svc')!;
  assert.equal(lane.databasesAssumed?.basis, 'client_default');
  assert.deepEqual(lane.databasesAssumed?.value, [0]);
  const m = (trace(g, { service: 'orders-svc', ingress: 'in.get' }, { scope: 'intra' }).messages as any[]).find((x) => x.seq === 3);
  assert.deepEqual(m.assumed.map((a: any) => [a.field, a.value, a.basis]), [['ttlSeconds', 3600, 'convention']]);
  assert.ok(m.assumed[0].reason);
});

test('API returns assumed verbatim next to unresolved; MCP link_health has an assumed filter', async () => {
  const svc = (await app.call('GET', '/api/envs/prod/views/service/auth-svc')).body;
  const r = svc.resources.find((x: any) => x.assumed);
  assert.deepEqual(r.assumed.map((a: any) => [a.what, a.detail, a.value, a.basis]), [['detail', 'client.databases', [0], 'client_default']]);
  assert.ok(r.assumed[0].reason);
  const all = await mcp('link_health', { assumed: true });
  assert.ok(all.items.assumed.length >= 2 && Object.keys(all.items).join() === 'assumed');
  assert.ok(all.byBasis.client_default >= 1 && all.byBasis.convention >= 1);
  const one = await mcp('link_health', { assumed: true, service: 'orders-svc', basis: 'convention' });
  assert.ok(one.items.assumed.length >= 1 && one.items.assumed.every((x: any) => x.service === 'orders-svc' && x.basis === 'convention'));
  assert.ok((await mcp('link_health', {})).items.assumed);
});

test('key entries take assumed (PUT, GET, validation); old entries have none', async () => {
  const CM = encodeURIComponent('redis:auth-cache');
  const T = { what: 'ttl', value: 3600, basis: 'convention', reason: 'sessions expire after an hour by convention' };
  const put = await app.call('PUT', `/api/envs/prod/resources/${CM}/keys`, { keys: [
    { keyTemplate: 'session:{token}', service: 'auth-svc', commands: ['SET'], ttlSeconds: 3600, assumed: [T] }, { keyTemplate: 'plain:{id}', service: 'auth-svc', commands: ['GET'] }] });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const rows = (await app.call('GET', `/api/envs/prod/resources/${CM}/keys`)).body.groups.flatMap((g: any) => g.rows);
  const s = rows.find((r: any) => r.keyTemplate === 'session:{token}'), p = rows.find((r: any) => r.keyTemplate === 'plain:{id}');
  assert.deepEqual(s.writers[0].assumed, [T]);
  assert.equal(p.readers[0].assumed, undefined);
  const bad = await app.call('PUT', `/api/envs/prod/resources/${CM}/keys`, { keys: [{ keyTemplate: 'x', service: 's', assumed: [{ what: 'ttl', value: 1, basis: 'b' }] }] });
  assert.equal(bad.status, 400);
  assert.equal(normaliseKeys([{ keyTemplate: 'x', service: 's', assumed: 'no' }]).errors[0].field, 'assumed');
});
