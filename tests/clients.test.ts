// Clients (#27): how a service reaches a store — driver majors, a lib's nested driver, mixed majors,
// the list_clients filters (REST and MCP), the store view and the contract rules.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sampleManifests, startApp } from './helpers.ts';
import { driverCounts, majorOf, mixedMajors } from '../core/clients.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
});
after(() => app.close());

const enc = encodeURIComponent;
const clients = async (q = '') => (await app.call('GET', `/api/envs/prod/clients${q}`)).body;
const mcp = async (name: string, args: object) => JSON.parse((await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { env: 'prod', ...args } } })).body.result.content[0].text);
const ORDER = 'redis:cache-main/order:{id}';

test('the major comes from the version string', () => {
  const v = ['5.3.2', '^4.27.6', '~4', 'v5', '>=5.1', '6', '5.0.0-beta.1', undefined, 'latest', 'git+https://github.com/x/ioredis.git#v5', 'https://x.test/ioredis-5.tgz', 'npm:ioredis@5.3.2', 'npm:@acme/ioredis@^4.1.0', 'file:../4.x'];
  assert.deepEqual(v.map(majorOf), ['5', '4', '4', '5', '5', '6', '5', undefined, undefined, undefined, undefined, '5', '4', undefined]);
});

test('two majors of one package are mixed; two packages or one major are not', () => {
  const d = (pkg: string, major: string, from: 'own' | 'lib') => ({ package: pkg, major, from });
  assert.deepEqual(mixedMajors([d('ioredis', '5', 'own'), d('ioredis', '4', 'lib')]), [{ package: 'ioredis', majors: ['5', '4'] }]);
  assert.deepEqual(mixedMajors([d('ioredis', '5', 'own'), d('ioredis', '5', 'lib')]), []);
  assert.deepEqual(mixedMajors([d('ioredis', '5', 'own'), d('redis', '4', 'lib')]), []);
});

test('a store lists its clients with driver, lib, the lib driver and via', async () => {
  const v = (await app.call('GET', `/api/envs/prod/stores/${enc(ORDER)}`)).body;
  const by = Object.fromEntries(v.clients.map((c: any) => [c.service, c]));
  assert.deepEqual(Object.keys(by).sort(), ['catalog-svc', 'inventory-svc', 'orders-svc', 'payments-svc', 'shipping-svc', 'users-svc']);
  assert.equal(by['orders-svc'].accessMode, 'direct_driver');
  assert.equal(by['orders-svc'].lib, null);
  assert.deepEqual(by['orders-svc'].mixed, []);
  const s = by['shipping-svc'];
  assert.equal(s.lib.package, 'saferxlib');
  assert.deepEqual(s.drivers.map((d: any) => [d.from, d.version, d.major]), [['own', '5.3.2', '5'], ['lib', '4.27.6', '4']]);
  assert.deepEqual(s.mixed, [{ package: 'ioredis', majors: ['5', '4'] }]);
  assert.equal(s.via.length, 2, 'the 2-hop chain, normalised like #28');
  assert.ok(s.via[0].link?.url, 'hops link to code');
  assert.deepEqual(by['inventory-svc'].mixed, [], 'its own 4.x is not a mix');
});

test('missing values come from unresolved (what: client), never invented', async () => {
  const c = (await clients('?service=catalog-svc&store=' + enc(ORDER))).rows[0];
  assert.equal(c.driver.version, undefined);
  assert.deepEqual(c.unresolved, ['driver.version']);
  assert.deepEqual(c.mixed, [], 'one known major is not a mix');
  assert.equal(c.drivers.length, 2);
});

test('list_clients filters, and a driver matches the service or its lib', async () => {
  const all = await clients();
  assert.equal(all.rows.length, 10, '8 until the auth-cache services (0.16.0) sent a client');
  const on4 = await clients('?driver=ioredis&driverMajor=4');
  assert.deepEqual(on4.rows.map((r: any) => r.service).sort(), ['catalog-svc', 'inventory-svc', 'payments-svc', 'shipping-svc', 'users-svc'].sort());
  assert.deepEqual((await clients('?lib=saferxlib')).rows.map((r: any) => r.service).sort(), ['catalog-svc', 'payments-svc', 'shipping-svc', 'users-svc']);
  assert.deepEqual((await clients('?accessMode=self_implemented_wrapper')).rows.map((r: any) => r.service), ['inventory-svc']);
  assert.deepEqual((await clients('?via=ShipmentCache')).rows.map((r: any) => r.service), ['shipping-svc']);
  assert.deepEqual((await clients('?via=saferxlib.RedisClient')).rows.map((r: any) => r.service), ['shipping-svc'], 'a hop in the lib is a via match');
  assert.deepEqual((await clients('?driver=mongodb')).rows.map((r: any) => [r.service, r.store, r.accessMode]), [['orders-svc', 'mongodb:orders-db/orders', 'direct_driver']]);
  assert.deepEqual((await clients('?driver=ioredis@4')).rows.map((r: any) => r.service), on4.rows.map((r: any) => r.service), 'driver=pkg@major is the facet form');
  assert.deepEqual((await clients('?driver=ioredis@')).rows.map((r: any) => r.service), ['catalog-svc'], 'pkg@ = version not reported');
  assert.equal((await clients('?store=redis:cache-main')).rows.every((r: any) => r.store.startsWith('redis:cache-main/')), true, 'a cluster matches its keys');
});

test('counts are services per driver and major; a service with two drivers counts under both', async () => {
  const { counts } = await clients('?store=' + enc(ORDER));
  const n = (l: string) => counts.find((c: any) => c.label === l)?.services;
  assert.equal(n('ioredis 4.x'), 5);
  assert.equal(n('ioredis 5.x'), 4);
  assert.equal(n('ioredis, version not reported'), 1, 'catalog-svc: own version unresolved');
  assert.equal(driverCounts([]).length, 0);
});

test('MCP list_clients returns the same rows and counts', async () => {
  const r = await mcp('list_clients', { driver: 'ioredis', driverMajor: 4 });
  assert.equal(r.rows.length, 5);
  assert.equal(r.counts.find((c: any) => c.label === 'ioredis 4.x').services, 5);
  assert.deepEqual((await mcp('get_store', { key: ORDER })).clients.length, 6);
});

test('an unresolved client entry with no detail names no field and is not listed', async () => {
  const base = { schemaVersion: '1.0', kind: 'full', env: 'e2', service: { name: 'c2', kind: 'service' }, version: 1, harvestedAt: '2026-10-20T08:00:00Z', commit: 'abc' };
  const r = await app.call('POST', '/api/ingest', { ...base, resources: [{ id: 'r', kind: 'redis', name: 'k', bindKey: 'redis:c/k', unresolved: [{ what: 'client', reason: 'lockfile_not_found' }] }] });
  assert.equal(r.status, 201);
  assert.deepEqual((await app.call('GET', '/api/envs/e2/clients')).body.rows, []);
});

test('contract: a client field gap needs a reason; unnamed fields are flagged', async () => {
  const base = { schemaVersion: '1.0', kind: 'full', env: 'e', service: { name: 'c1', kind: 'service' }, version: 1, harvestedAt: '2026-10-20T08:00:00Z', commit: 'abc' };
  const post = async (resources: object[]) => (await app.call('POST', '/api/ingest?dryRun=1', { manifests: [{ ...base, resources }] })).body.results[0].contract.findings.map((f: any) => f.code);
  const r = { id: 'r', kind: 'redis', name: 'k', bindKey: 'redis:c/k' };
  assert.ok((await post([{ ...r, client: { driver: { package: 'ioredis' } } }])).includes('client-version-gap'));
  assert.ok(!(await post([{ ...r, client: { driver: { package: 'ioredis' } }, unresolved: [{ what: 'client', reason: 'lockfile_not_found', detail: 'driver.version' }] }])).includes('client-version-gap'));
  assert.ok((await post([{ ...r, unresolved: [{ what: 'client', reason: 'x', detail: 'the driver' }] }])).includes('client-unresolved-field'));
  const bad = await app.call('POST', '/api/ingest?dryRun=1', { ...base, resources: [{ ...r, client: { accessMode: 'telepathy' } }] });
  assert.equal(bad.status, 422);
});
