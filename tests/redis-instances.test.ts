// Redis instances and their keys (#29, 0.16.0): the PUT/GET keys contract, validation, MCP, grouping (owner, shared,
// unwritten, TTL disagreement), key -> flows from steps, the instance page data and the Inventory rows.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sampleManifests, startApp, SAMPLES } from './helpers.ts';
import { accessFromCommands, groupRows, keyRows, keySummary, normaliseKeys, problemService, serviceKeys, type KeyEntry } from '../core/keys.ts';

let app: Awaited<ReturnType<typeof startApp>>;
const enc = encodeURIComponent;
const sample = JSON.parse(readFileSync(join(SAMPLES, 'keys/prod.json'), 'utf8'));
const CM = 'redis:cache-main';
const keysOf = (id: string) => sample.instances.find((i: any) => i.instance === id).keys;
const get = async (path: string) => (await app.call('GET', `/api/envs/prod${path}`)).body;
const e = (service: string, keyTemplate: string, access: KeyEntry['access'], extra: Partial<KeyEntry> = {}): KeyEntry => ({ service, keyTemplate, dbIndex: 0, access, commands: [], ...extra });

before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
});
after(() => app.close());

test('commands decide the access when an entry does not say', () => {
  assert.deepEqual([accessFromCommands(['GET']), accessFromCommands(['SET']), accessFromCommands(['INCR', 'GET']), accessFromCommands([])], ['read', 'write', 'read_write', 'read']);
});

test('entries are validated, normalised and may use the interim inline names', () => {
  const ok = normaliseKeys([{ key_template: 'a:{id}', db_index: 2, command_kinds: ['get', 'SET'], services: ['x', 'y'], op_count: 5, ttl: 60 }, 'plain:{k}'], 'dflt');
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.entries.map((x) => [x.service, x.keyTemplate, x.dbIndex, x.access, x.commands, x.opsPerHour, x.ttlSeconds]),
    [['x', 'a:{id}', 2, 'read_write', ['GET', 'SET'], 5, 60], ['y', 'a:{id}', 2, 'read_write', ['GET', 'SET'], 5, 60], ['dflt', 'plain:{k}', 0, 'read', [], undefined, undefined]]);
  const bad = normaliseKeys([{ service: 's' }, { keyTemplate: 'k', service: 's', dbIndex: -1 }, { keyTemplate: 'k', service: 's', access: 'rw' }, { keyTemplate: 'k', service: 's', ttlSeconds: 1.5 },
    { keyTemplate: 'k', service: 's', commands: [1] }, { keyTemplate: 'k' }, { keyTemplate: 'd', service: 's' }, { keyTemplate: 'd', service: 's' }]);
  assert.deepEqual(bad.errors.map((x) => [x.index, x.field]), [[0, 'keyTemplate'], [1, 'dbIndex'], [2, 'access'], [3, 'ttlSeconds'], [4, 'commands'], [5, 'service'], [7, 'keyTemplate']]);
  assert.equal(normaliseKeys('nope').errors.length, 1);
});

test('grouping: one owner, shared (listed once), no harvested writer; a TTL disagreement needs two different values', () => {
  const rows = keyRows([
    e('a', 'own:1', 'write', { ttlSeconds: 10 }), e('b', 'own:1', 'read'),
    e('a', 'sh:1', 'write', { ttlSeconds: 10 }), e('b', 'sh:1', 'read_write', { ttlSeconds: 20 }), e('c', 'sh:1', 'read'),
    e('a', 'same:1', 'write', { ttlSeconds: 5 }), e('b', 'same:1', 'write', { ttlSeconds: 5 }),
    e('a', 'unk:1', 'write', { ttlSeconds: 5 }), e('b', 'unk:1', 'write'),
    e('c', 'none:1', 'read', { opsPerHour: 7 }),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.keyTemplate, r]));
  assert.equal(by['own:1'].problem, null);
  assert.deepEqual(by['own:1'].readers.map((r) => r.service), ['b'], 'a non-owner reader');
  assert.equal(by['sh:1'].problem?.kind, 'ttl-disagree');
  assert.deepEqual(by['sh:1'].ttl.values, [{ service: 'a', ttlSeconds: 10 }, { service: 'b', ttlSeconds: 20 }]);
  assert.equal(by['same:1'].problem, null, 'two writers that agree are shared, not a problem');
  assert.equal(by['same:1'].ttl.seconds, 5);
  assert.equal(by['unk:1'].ttl.disagree, false, 'an unknown TTL is not a disagreement');
  assert.equal(by['none:1'].problem?.kind, 'no-writer');
  assert.match(by['none:1'].problem!.why, /No harvested service writes it/);
  const groups = groupRows(rows);
  assert.deepEqual(groups.map((g) => [g.kind, g.label, g.rows.map((r) => r.keyTemplate)]), [
    ['unwritten', 'No harvested writer', ['none:1']],
    ['shared', 'Shared: written by 2 services', ['same:1', 'sh:1', 'unk:1']],
    ['owner', 'a', ['own:1']],
  ]);
  const s = keySummary([e('a', 'own:1', 'write'), e('c', 'none:1', 'read')]);
  assert.deepEqual([s.templates, s.unwritten, s.shared, s.problemCount, s.dbs], [2, 1, 0, 1, [{ db: 0, templates: 2, problems: 1 }]]);
});

test('PUT keys replaces the list of an instance and versions it; GET filters by db', async () => {
  const put = await app.call('PUT', `/api/envs/prod/resources/${enc(CM)}/keys`, { keys: keysOf(CM), producer: 'redis-key-harvester' });
  assert.equal(put.status, 200);
  assert.deepEqual([put.body.instance, put.body.version, put.body.entries, put.body.summary.templates], [CM, 1, 17, 9]);

  const all = await get(`/resources/${enc(CM)}/keys`);
  assert.deepEqual([all.source, all.version, all.producer, all.shown], ['pushed', 1, 'redis-key-harvester', 9]);
  assert.deepEqual(all.summary.dbs, [{ db: 0, templates: 3, problems: 1 }, { db: 1, templates: 3, problems: 1 }, { db: 2, templates: 3, problems: 0 }]);
  assert.deepEqual(all.groups.map((g: any) => g.label).slice(0, 2), ['No harvested writer', 'Shared: written by 3 services']);

  const db1 = await get(`/resources/${enc(CM)}/keys?db=1`);
  assert.equal(db1.shown, 3);
  assert.deepEqual(db1.summary.dbs.map((d: any) => d.templates), [3, 3, 3], 'counts cover every db, whatever the filter');
  assert.ok(db1.groups.every((g: any) => g.rows.every((r: any) => r.dbIndex === 1)));
  assert.equal((await get(`/resources/${enc(CM)}/keys?problems=1`)).shown, 2);
  assert.equal((await get(`/resources/${enc(CM)}/keys?q=session`)).shown, 2);
  assert.equal((await app.call('GET', `/api/envs/prod/resources/${enc(CM)}/keys?db=x`)).status, 400);

  const again = await app.call('PUT', `/api/envs/prod/resources/${enc(CM)}/keys`, keysOf(CM).slice(0, 2));
  assert.deepEqual([again.body.version, again.body.entries], [2, 2], 'a bare array works, and replaces everything');
  assert.equal((await get(`/resources/${enc(CM)}/keys`)).shown, 1, 'the two entries are one template');
  assert.equal((await app.call('PUT', `/api/envs/prod/resources/${enc(CM)}/keys`, { version: 2, keys: [] })).status, 409, 'a pushed version must be above the stored one');
  assert.equal((await app.call('PUT', `/api/envs/prod/resources/${enc(CM)}/keys`, { version: 7, keys: keysOf(CM) })).body.version, 7);
});

test('PUT keys rejects bad entries (nothing stored) and unknown instances', async () => {
  const before = (await get(`/resources/${enc(CM)}/keys`)).summary.templates;
  const bad = await app.call('PUT', `/api/envs/prod/resources/${enc(CM)}/keys`, { keys: [{ keyTemplate: 'x', service: 's' }, { keyTemplate: '', service: 's' }, { keyTemplate: 'y', service: 's', ttlSeconds: -1 }] });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.details.map((d: any) => [d.index, d.field]), [[1, 'keyTemplate'], [2, 'ttlSeconds']]);
  assert.equal((await get(`/resources/${enc(CM)}/keys`)).summary.templates, before, 'all or nothing');
  assert.equal((await app.call('PUT', `/api/envs/prod/resources/${enc('redis:nope')}/keys`, { keys: [] })).status, 404);
  assert.equal((await app.call('GET', `/api/envs/prod/resources/${enc('redis:nope')}/keys`)).status, 404);
  assert.equal((await app.call('PUT', `/api/envs/prod/resources/${enc(CM)}/keys`, { keys: 'x' })).status, 400);
});

test('the instance id may be its key, the infra resource id, or the bare name', async () => {
  await app.call('PUT', `/api/envs/prod/resources/${enc(CM)}/keys`, { keys: keysOf(CM) });
  const counts = await Promise.all([CM, 'cache-main'].map(async (id) => (await get(`/resources/${enc(id)}/keys`)).summary.templates));
  assert.deepEqual(counts, [9, 9]);
  assert.equal((await get(`/instances/${enc('cache-main')}`)).key, CM);
});

test('the instance page: definition, who connects with access, client and databases, callouts', async () => {
  const v = await get(`/instances/${enc(CM)}`);
  assert.deepEqual([v.key, v.name, v.topology, v.engineVersion, v.nodes], [CM, 'cache-main', 'cluster', '7.0.7', 2]);
  assert.deepEqual([v.definition.service, v.definition.id, v.definition.verified], ['infra', 'cache-main', 'match']);
  assert.deepEqual(v.lanes.map((l: any) => l.service), ['catalog-svc', 'inventory-svc', 'orders-svc', 'payments-svc', 'shipping-svc', 'users-svc'], 'the defining infra resource is not a connection');
  const lane = (s: string) => v.lanes.find((l: any) => l.service === s);
  assert.deepEqual([lane('orders-svc').access, lane('orders-svc').accessFrom], ['read_write', 'steps']);
  assert.deepEqual([lane('catalog-svc').access, lane('catalog-svc').accessFrom], ['read', 'declared'], 'details.access on the resource wins');
  assert.deepEqual([lane('inventory-svc').access, lane('inventory-svc').accessFrom], ['write', 'keys'], 'no step: from the key entries');
  assert.deepEqual(lane('catalog-svc').databases, [0, 1, 2], 'the client databases plus the dbs of its key entries');
  assert.equal(lane('orders-svc').clients[0].drivers[0].version, '5.3.2');
  assert.deepEqual(v.keys.summary && [v.keys.source, v.keys.summary.templates, v.keys.summary.problemCount], ['pushed', 9, 2]);
  assert.deepEqual(v.callouts.map((c: any) => [c.kind, c.row.keyTemplate]).sort(), [['no-writer', 'product:{id}:availability'], ['ttl-disagree', 'order:{id}']]);
  assert.match(v.callouts.find((c: any) => c.kind === 'ttl-disagree').text, /order:\{id\} is written by 3 services \(inventory-svc, orders-svc, shipping-svc\) that disagree on its TTL/);
  assert.equal((await app.call('GET', `/api/envs/prod/instances/${enc('redis:nope')}`)).status, 404);
});

test('a standalone instance is an instance, not a cluster; the one with no keys pushed shows none', async () => {
  const v = await get(`/instances/${enc('redis:auth-cache')}`);
  assert.deepEqual([v.topology, v.engineVersion, v.keys.source, v.lanes.map((l: any) => l.service)], ['instance', '6.2.14', 'none', ['auth-svc', 'reports-api']]);
  assert.equal(v.keys.summary, null);
  assert.equal((await get(`/resources/${enc('redis:auth-cache')}/keys`)).shown, 0);
});

test('key to flows: entry points that reach a step naming the key, with the function chain; read steps are marked', async () => {
  const k = await get(`/resources/${enc(CM)}/keys?db=1`);
  const row = (t: string) => k.groups.flatMap((g: any) => g.rows).find((r: any) => r.keyTemplate === t);
  const order = row('order:{id}');
  const writes = order.flows.filter((f: any) => f.access !== 'read');
  assert.ok(writes.length >= 2, 'orders-svc SET and DEL, shipping-svc DEL');
  const set = writes.find((f: any) => f.operation === 'SET + EX 3600');
  assert.ok(set, 'the TTL the step sets is part of the operation');
  assert.equal(set.step.service, 'orders-svc');
  assert.ok(set.chain.length >= 1 && set.chain.at(-1) === 'OrderController.get', 'the chain ends at the function that makes the call');
  assert.ok(writes.some((f: any) => f.step.service === 'shipping-svc' && f.operation === 'DEL'));
  assert.ok(order.flows.some((f: any) => f.access === 'read' && f.step.service === 'orders-svc'));
  assert.ok(row('addons:{id}').flows.some((f: any) => f.operation === 'SET + EX 600' && f.access === 'write'));
  const unrelated = await get(`/resources/${enc(CM)}/keys?db=2`);
  assert.ok(unrelated.groups.every((g: any) => g.rows.every((r: any) => r.flows.length === 0)), 'no step names these keys: no flows');
});

test('MCP get_resource_keys returns the same list, scoped by db', async () => {
  await app.call('PUT', `/api/envs/prod/resources/${enc(CM)}/keys`, { keys: keysOf(CM) });
  const rpc = async (args: any) => {
    const r = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_resource_keys', arguments: { env: 'prod', ...args } } });
    return r.body.result;
  };
  const all = JSON.parse((await rpc({ resourceId: CM })).content[0].text);
  assert.equal(all.shown, 9);
  const db2 = JSON.parse((await rpc({ resourceId: 'cache-main', dbIndex: 2 })).content[0].text);
  assert.equal(db2.shown, 3);
  assert.ok((await rpc({ resourceId: 'redis:nope' })).isError, 'an unknown instance is a tool error');
  const tools = (await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' })).body.result.tools;
  assert.ok(tools.some((t: any) => t.name === 'get_resource_keys' && t.inputSchema.required.includes('resourceId')));
});

test('Inventory: a Redis instance is one row with its connections line; key patterns are not rows', async () => {
  await app.call('PUT', `/api/envs/prod/resources/${enc(CM)}/keys`, { keys: keysOf(CM) });
  const items = await get('/inventory');
  const row = items.find((x: any) => x.id === CM);
  assert.deepEqual([row.type, row.kind, row.instance, row.label, row.team], ['store', 'redis', 'cluster', 'cache-main', 'platform']);
  assert.equal(row.connections, '6 services · 3 dbs · 9 key templates');
  assert.ok(row.problems >= 2, 'the two key problems count');
  const auth = items.find((x: any) => x.id === 'redis:auth-cache');
  assert.deepEqual([auth.instance, auth.connections], ['instance', '2 services · 1 db']);
  assert.ok(!items.some((x: any) => x.id.startsWith('redis:') && x.id.includes('/')));
  assert.equal(items.find((x: any) => x.id === 'mongodb:orders-db/orders').instance, undefined, 'other stores are unchanged');
  assert.deepEqual((await get('/instances')).map((i: any) => i.key), ['redis:auth-cache', CM, 'redis:checkout-cache']); // #86 demo: checkout-svc's own instance
});

test('the interim inline details.keys is read when nothing was pushed, and a push wins over it', async () => {
  const m = sampleManifests().find((x: any) => x.service.name === 'auth-svc');
  const inline = { ...m, version: m.version + 100, resources: m.resources.map((r: any) => (r.id === 'sessions' ? { ...r, details: { lazy: { kind: 'keys', ref: 'auth-cache' }, keys: [{ key_template: 'inline:{id}', db_index: 3, command_kinds: ['SET'], op_count: 9 }, 'bare:{id}'] } } : r)) };
  assert.equal((await app.call('POST', '/api/ingest', { manifests: [inline] })).status, 201);
  const k = await get(`/resources/${enc('redis:auth-cache')}/keys`);
  assert.deepEqual([k.source, k.version, k.shown, k.summary.dbs.map((d: any) => d.db)], ['inline', null, 2, [0, 3]]);
  const v = await get(`/instances/${enc('auth-cache')}`);
  assert.deepEqual([v.keys.source, v.keys.lazy], ['inline', { kind: 'keys', ref: 'auth-cache' }]);
  await app.call('PUT', `/api/envs/prod/resources/${enc('redis:auth-cache')}/keys`, { keys: keysOf('redis:auth-cache') });
  assert.deepEqual([(await get(`/resources/${enc('redis:auth-cache')}/keys`)).source, (await get(`/resources/${enc('redis:auth-cache')}/keys`)).shown], ['pushed', 2]);
});

test('0.17.0 per-service keys: writes, reads (owner named), problems, and the service a callout opens', () => {
  const rows = keyRows([
    e('a', 'own:1', 'write', { ttlSeconds: 10 }), e('b', 'own:1', 'read'),
    e('a', 'sh:1', 'write', { ttlSeconds: 10 }), e('b', 'sh:1', 'read_write', { ttlSeconds: 20 }), e('c', 'sh:1', 'read'),
    e('c', 'none:1', 'read'), e('d', 'none:1', 'read'),
  ]);
  const a = serviceKeys(rows, 'a'), b = serviceKeys(rows, 'b'), c = serviceKeys(rows, 'c');
  assert.deepEqual([a.writes, a.reads, a.problems].map((x) => x.map((r) => r.keyTemplate)), [['own:1', 'sh:1'], [], ['sh:1']]);
  assert.deepEqual([b.writes, b.reads].map((x) => x.map((r) => r.keyTemplate)), [['sh:1'], ['own:1']], 'a service that writes a key does not also read it');
  assert.deepEqual(b.reads[0].writers.map((w) => w.service), ['a'], 'a read row names its owner');
  assert.deepEqual([c.writes.length, c.reads.map((r) => r.keyTemplate), c.problems.map((r) => r.keyTemplate)], [0, ['none:1', 'sh:1'], ['none:1', 'sh:1']]);
  assert.deepEqual(serviceKeys(rows, 'nobody'), { writes: [], reads: [], problems: [] });
  const by = Object.fromEntries(rows.map((r) => [r.keyTemplate, r]));
  assert.deepEqual([problemService(by['sh:1']), problemService(by['none:1']), problemService(by['own:1'])], ['a', 'c', null], 'shared: first writer; no writer: the first reader');
});

test('GET keys?service= narrows to what the service writes or reads; the summary still counts everything; callouts say where to open', async () => {
  await app.call('PUT', `/api/envs/prod/resources/${enc(CM)}/keys`, { keys: keysOf(CM) });
  const all = await get(`/resources/${enc(CM)}/keys`);
  const mine = await get(`/resources/${enc(CM)}/keys?service=catalog-svc`);
  const rows = mine.groups.flatMap((g: any) => g.rows);
  assert.ok(rows.length > 0 && rows.length < all.shown);
  assert.ok(rows.every((r: any) => [...r.writers, ...r.readers].some((u: any) => u.service === 'catalog-svc')));
  assert.deepEqual(mine.summary, all.summary);
  assert.ok(rows.some((r: any) => r.keyTemplate === 'product:{id}:availability' && r.problem?.kind === 'no-writer'), "the no-writer key is in its reader's card");
  assert.equal((await get(`/resources/${enc(CM)}/keys?service=nobody`)).shown, 0);
  const v = await get(`/instances/${enc(CM)}`);
  const co = (k: string) => v.callouts.find((c: any) => c.row.keyTemplate === k);
  assert.equal(co('product:{id}:availability').service, 'catalog-svc');
  assert.equal(co('order:{id}').service, 'inventory-svc', 'a shared key opens its first writer');
  assert.ok(v.lanes.every((l: any) => l.keyCount > 0), 'every lane of the sample has keys');
  const rpc = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_resource_keys', arguments: { env: 'prod', resourceId: CM, service: 'catalog-svc' } } });
  assert.equal(JSON.parse(rpc.body.result.content[0].text).shown, rows.length);
});
