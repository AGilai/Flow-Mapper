// Environments as objects (0.21.0): the envs list, create by copy (blank / components / full), neighbours, delete,
// the baseline rows, and the sealed / design write guard.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readSample, sampleManifests, startApp } from './helpers.ts';
import { entryPoints, trace } from '../core/trace.ts';
import { traceHash } from '../core/description.ts';

let app: Awaited<ReturnType<typeof startApp>>;
const q = (sql: string, ...a: any[]) => app.ctx.db.prepare(sql).all(...a) as any[];
const count = (table: string, env: string) => q(`SELECT count(*) AS n FROM ${table} WHERE env = ?`, env)[0].n as number;
const create = (body: any) => app.call('POST', '/api/envs', body);
const PICK = ['orders-svc', 'users-svc', 'payments-svc'];

before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
  assert.equal((await app.call('PUT', '/api/envs/prod/dtos/users-svc/response/in.getUser', { id: 'u1' })).status, 200);
  assert.equal((await app.call('PUT', '/api/envs/prod/descriptions', { service: 'api-gateway', ingress: 'in.createOrder', text: 'creates an order', editedBy: 'me' })).status, 200);
  const keys = readSample('keys/prod.json');
  for (const i of keys.instances) assert.equal((await app.call('PUT', `/api/envs/prod/resources/${encodeURIComponent(i.instance)}/keys`, { keys: i.keys })).status, 200);
});
after(() => app.close());

test('ingest creates a sealed env; GET /api/envs stays a list of names and /meta carries the kind', async () => {
  assert.equal((await app.call('POST', '/api/ingest', { ...readSample('orders-svc.json'), env: 'staging', version: 1 })).status, 201);
  const names = (await app.call('GET', '/api/envs')).body;
  assert.ok(Array.isArray(names) && names.every((n: any) => typeof n === 'string') && names.includes('prod') && names.includes('staging'));
  const meta = (await app.call('GET', '/api/envs/meta')).body;
  assert.equal(meta.find((m: any) => m.name === 'staging').kind, 'sealed');
  assert.equal(meta.find((m: any) => m.name === 'prod').counts.components, sampleManifests().filter((m: any) => (m.env ?? 'prod') === 'prod').length);
});

test('C1 blank: a design env with no services is listed, with its groups and levels in order', async () => {
  const r = await create({ name: 'blank-1', source: 'prod', mode: 'blank', groups: [{ key: 'b', label: 'B' }, { key: 'a', label: 'A' }], levels: ['Subsystem', 'Domain', 'Component'], createdBy: 'asaf' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual([r.body.kind, r.body.source, r.body.counts.components, r.body.createdBy], ['design', 'prod', 0, 'asaf']);
  assert.deepEqual(r.body.groups.map((g: any) => g.key), ['b', 'a']);
  assert.deepEqual(r.body.levels, ['Subsystem', 'Domain', 'Component']);
  assert.ok((await app.call('GET', '/api/envs')).body.includes('blank-1'));
  assert.equal((await app.call('GET', '/api/envs/blank-1/services')).body.length, 0);
});

test('C2 components: the picked services with objects and DTOs, no functions, and they stay editable', async () => {
  const body = { name: 'comp-1', source: 'prod', mode: 'components', groups: [{ key: 'platform', label: 'Platform' }, { key: 'agent', label: 'Agent' }],
    services: [{ name: 'users-svc', groupPath: 'platform' }, { name: 'orders-svc', groupPath: 'agent' }, { name: 'payments-svc' }] };
  const r = await create(body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual((await app.call('GET', '/api/envs/comp-1/services')).body.map((s: any) => s.name).sort(), [...PICK].sort());
  assert.equal(count('entities', 'comp-1') > 0, true);
  assert.equal(q("SELECT count(*) AS n FROM entities WHERE env = 'comp-1' AND list = 'functions'")[0].n, 0);
  for (const list of ['ingress', 'egress', 'channels', 'resources', 'bindings'])
    for (const s of PICK) assert.equal(q('SELECT count(*) AS n FROM entities WHERE env = ? AND service = ? AND list = ?', 'comp-1', s, list)[0].n, q('SELECT count(*) AS n FROM entities WHERE env = ? AND service = ? AND list = ?', 'prod', s, list)[0].n);
  const users = (await app.call('GET', '/api/envs/comp-1/services/users-svc')).body;
  assert.equal(users.service.groupPath, 'platform');
  assert.equal((await app.call('GET', '/api/envs/comp-1/services/payments-svc')).body.service.groupPath, undefined);
  assert.equal(count('endpoint_dtos', 'comp-1'), q("SELECT count(*) AS n FROM endpoint_dtos WHERE env = 'prod' AND service IN ('users-svc', 'orders-svc', 'payments-svc')")[0].n);
  const k = (env: string) => q("SELECT instance, service, key_template FROM resource_keys WHERE env = ? ORDER BY 1, 2, 3", env);
  assert.deepEqual(k('comp-1'), k('prod').filter((r) => PICK.includes(r.service)), 'Redis keys of the picked services only');
  assert.equal(JSON.parse(q("SELECT summary FROM resource_keys_meta WHERE env = 'comp-1' AND instance = 'redis:auth-cache'")[0]?.summary ?? 'null'), null, 'no instance without a picked service');
  assert.equal(entryPoints(app.ctx.graph('comp-1')).length >= 0 && app.ctx.graph('comp-1').model.functions.length, 0, 'no functions, so no flows');
  // functions are missing, so ingress handlers dangle; an edit must still go through (only new problems block it)
  const egress = { id: 'tbd', bindKey: 'http:GET users-svc/new', transport: 'http' };
  assert.equal((await app.call('POST', '/api/envs/comp-1/services/users-svc/egress', egress)).status, 201);
  assert.equal(q("SELECT count(*) AS n FROM entities WHERE env = 'prod' AND service = 'users-svc' AND key = 'tbd'")[0].n, 0, 'the source is not touched');
});

test('C3 full: entity for entity, DTOs, descriptions, and the same trace hash for every entry point', async () => {
  const r = await create({ name: 'full-1', source: 'prod', mode: 'full' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  for (const t of ['snapshots', 'entities', 'endpoint_dtos', 'event_dtos', 'store_schemas', 'descriptions', 'resource_keys', 'resource_keys_meta']) assert.equal(count(t, 'full-1'), count(t, 'prod'), t);
  assert.deepEqual(q("SELECT service, list, key, data FROM entities WHERE env = 'full-1' ORDER BY 1, 2, 3"), q("SELECT service, list, key, data FROM entities WHERE env = 'prod' ORDER BY 1, 2, 3"));
  const [a, b] = [app.ctx.graph('prod'), app.ctx.graph('full-1')];
  const eps = entryPoints(a);
  assert.ok(eps.length > 10);
  for (const e of eps) {
    const start = { service: e.service, ingress: e.id };
    assert.equal(traceHash(trace(b, start, { scope: 'full', maxDepth: 25, maxMessages: 500 })!), traceHash(trace(a, start, { scope: 'full', maxDepth: 25, maxMessages: 500 })!), `${e.service} ${e.id}`);
  }
  assert.equal(count('bugs', 'full-1'), 0);
});

test('C4 full copy of a design keeps its subsystems and its original baseline; no shared rows', async () => {
  const d = await create({ name: 'dup-1', source: 'comp-1', mode: 'full' });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  assert.deepEqual(d.body.groups.map((g: any) => g.key), ['platform', 'agent']);
  assert.equal(d.body.source, 'comp-1');
  const was = (env: string) => q("SELECT service, list, key, data, source_env FROM baseline_items WHERE env = ? ORDER BY 1, 2, 3", env);
  assert.deepEqual(was('dup-1').map((r) => ({ ...r })), was('comp-1').map((r) => ({ ...r })));
  assert.equal(was('dup-1')[0].source_env, 'prod', 'the baseline still says prod');
  // changing the copy leaves the original alone
  assert.equal((await app.call('PATCH', '/api/envs/dup-1/services/users-svc', { team: 'zz' })).status, 200);
  assert.notEqual((await app.call('GET', '/api/envs/comp-1/services/users-svc')).body.service.team, 'zz');
});

test('baseline rows are written from a sealed source: header, entities, DTOs', async () => {
  const rows = q("SELECT service, list, key, source_env, source_version FROM baseline_items WHERE env = 'comp-1' AND service = 'users-svc'");
  assert.ok(rows.some((r) => r.list === 'header' && r.source_version > 0 && r.source_env === 'prod'));
  assert.ok(rows.some((r) => r.list === 'ingress'));
  assert.equal(rows.some((r) => r.list === 'functions'), false);
  assert.ok(q("SELECT 1 FROM baseline_items WHERE env = 'comp-1' AND list = 'dto'").length > 0);
  assert.equal(count('baseline_items', 'blank-1'), 0);
});

test('C5 neighbours: one hop, through channels too, never the source or infra', async () => {
  const n = (await app.call('GET', '/api/envs/prod/neighbours?services=orders-svc')).body;
  const names = n.map((x: any) => x.service);
  assert.ok(names.includes('api-gateway'), 'calls orders-svc');
  assert.ok(n.find((x: any) => x.service === 'api-gateway').reason.includes('calls orders-svc'));
  assert.ok(n.some((x: any) => x.reason.includes('publishes to') || x.reason.includes('reads ')), 'through a topic or queue');
  assert.equal(names.includes('orders-svc'), false);
  assert.equal(names.includes('infra'), false);
  const two = (await app.call('GET', '/api/envs/prod/neighbours?services=api-gateway,orders-svc,users-svc')).body.map((x: any) => x.service);
  assert.equal(two.includes('api-gateway'), false, 'picked ones are not suggested');
  assert.equal((await app.call('GET', '/api/envs/nope/neighbours?services=a')).status, 404);
});

test('components table: what each component brings along', async () => {
  const rows = (await app.call('GET', '/api/envs/prod/components')).body;
  const u = rows.find((r: any) => r.name === 'users-svc');
  assert.ok(u.counts.endpoints > 0 && u.counts.dtos >= 1);
  assert.equal('functions' in u.counts, false);
});

test('C6 the source is unchanged by a copy', async () => {
  const snap = () => JSON.stringify([q("SELECT service, version FROM snapshots WHERE env = 'prod' ORDER BY 1"), q("SELECT count(*) AS n FROM changelog WHERE env = 'prod'"), q("SELECT count(*) AS n FROM entities WHERE env = 'prod'")]);
  const before = snap();
  assert.equal((await create({ name: 'comp-2', source: 'prod', mode: 'components', services: [{ name: 'orders-svc' }] })).status, 201);
  assert.equal(snap(), before);
});

test('C7 errors: taken name, bad names, bad mode, unknown source, unknown component, bad group', async () => {
  const ok = { source: 'prod', mode: 'blank' };
  assert.equal((await create({ ...ok, name: 'prod' })).status, 409);
  assert.equal((await create({ ...ok, name: 'blank-1' })).body.error.code, 'EXISTS');
  for (const name of ['', 'a/b', 'a b', 'A', '%41', 'meta', 'x'.repeat(70)]) assert.equal((await create({ ...ok, name })).status, 422, `name '${name}'`);
  assert.equal((await create({ ...ok, name: 'e1', mode: 'linked' })).status, 422);
  assert.equal((await create({ ...ok, name: 'e1', source: 'nope' })).status, 404);
  assert.equal((await create({ name: 'e1', source: 'prod', mode: 'components', services: [{ name: 'nope-svc' }] })).status, 404);
  assert.equal((await create({ name: 'e1', source: 'prod', mode: 'components', services: [] })).status, 422);
  assert.equal((await create({ name: 'e1', source: 'prod', mode: 'components', groups: [{ key: 'a', label: 'A' }], services: [{ name: 'orders-svc', groupPath: 'zz' }] })).status, 422);
  assert.equal((await create({ ...ok, name: 'e1', groups: [{ key: 'a', label: 'A' }, { key: 'a', label: 'B' }] })).status, 422);
  assert.equal((await app.call('GET', '/api/envs')).body.includes('e1'), false);
});

test('C8 a failure in the middle of a copy leaves no partial environment', async () => {
  app.ctx.db.exec("CREATE TRIGGER boom BEFORE INSERT ON endpoint_dtos WHEN NEW.env = 'boom-1' BEGIN SELECT RAISE(ABORT, 'forced'); END");
  const r = await create({ name: 'boom-1', source: 'prod', mode: 'full' });
  app.ctx.db.exec('DROP TRIGGER boom');
  assert.ok(r.status >= 400);
  for (const t of ['envs', 'snapshots', 'entities', 'baseline_items', 'changelog']) assert.equal(q(`SELECT count(*) AS n FROM ${t} WHERE ${t === 'envs' ? 'name' : 'env'} = 'boom-1'`)[0].n, 0, t);
});

test('C9 delete: a design env goes with everything in it, a sealed env cannot be deleted', async () => {
  assert.equal((await create({ name: 'gone-1', source: 'prod', mode: 'full' })).status, 201);
  assert.equal((await app.call('DELETE', '/api/envs/gone-1')).status, 200);
  for (const t of ['snapshots', 'entities', 'endpoint_dtos', 'descriptions', 'baseline_items', 'changelog']) assert.equal(count(t, 'gone-1'), 0, t);
  assert.equal((await app.call('GET', '/api/envs')).body.includes('gone-1'), false);
  const r = await app.call('DELETE', '/api/envs/prod');
  assert.equal(r.status, 409);
  assert.equal(count('snapshots', 'prod') > 0, true);
  assert.equal((await app.call('DELETE', '/api/envs/nope')).status, 404);
});

test('guards: harvesters cannot write a design env, manual edits cannot touch a sealed one, annotations pass everywhere', async () => {
  const m = { ...readSample('orders-svc.json'), env: 'comp-1', version: 99 };
  const ing = await app.call('POST', '/api/ingest', m);
  assert.equal(ing.status, 409); assert.equal(ing.body.error.code, 'ENV_DESIGN');
  assert.equal((await app.call('PUT', '/api/envs/comp-1/dtos/users-svc/response/in.getUser', { a: 1 })).body.error.code, 'ENV_DESIGN');
  assert.equal((await app.call('DELETE', '/api/envs/comp-1/event-dtos/X')).status, 409);
  for (const [method, path, body] of [['POST', '/api/envs/prod/services', { name: 'zz' }], ['PATCH', '/api/envs/prod/services/users-svc', { team: 'x' }], ['DELETE', '/api/envs/prod/services/users-svc'],
    ['DELETE', '/api/envs/prod/services/users-svc/ingress/in.getUser']] as const) {
    const r = await app.call(method, path, body); assert.equal(r.status, 409, path); assert.equal(r.body.error.code, 'ENV_SEALED');
  }
  const mcp = (name: string, args: any) => app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const e = await mcp('delete_entity', { env: 'prod', service: 'users-svc', list: 'ingress', key: 'in.getUser' });
  assert.equal(e.body.result.isError, true); assert.match(e.body.result.content[0].text, /ENV_SEALED/);
  assert.equal((await app.call('PUT', '/api/envs/full-1/descriptions', { service: 'api-gateway', ingress: 'in.createOrder', text: 'noted in the design' })).status, 200);
  assert.equal((await app.call('PUT', '/api/envs/prod/descriptions', { service: 'api-gateway', ingress: 'in.createOrder', text: 'noted in prod' })).status, 200);
  assert.equal((await app.call('POST', '/api/bugs', { title: 'a bug in a design env', env: 'comp-1' })).status, 201);
  assert.equal(count('snapshots', 'prod') > 0, true);
});

test('MCP create_env and list_envs', async () => {
  const mcp = (name: string, args: any) => app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const c = await mcp('create_env', { name: 'mcp-1', source: 'prod', mode: 'components', groups: [{ key: 'p', label: 'P' }], services: [{ name: 'orders-svc', groupPath: 'p' }] });
  assert.equal(c.body.result.isError, false, c.body.result.content[0].text);
  const l = JSON.parse((await mcp('list_envs', {})).body.result.content[0].text);
  const e = l.find((x: any) => x.name === 'mcp-1');
  assert.deepEqual([e.kind, e.source, e.components], ['design', 'prod', 1]);
  assert.equal(l.find((x: any) => x.name === 'prod').kind, 'sealed');
});
