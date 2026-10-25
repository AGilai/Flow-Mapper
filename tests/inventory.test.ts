// Inventory, data stores (read/write, reverse reach, groups, schemas) and channel/event detail views.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sampleManifests, startApp, SAMPLES } from './helpers.ts';
import { accessOf, groupOf } from '../core/stores.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
});
after(() => app.close());

const enc = encodeURIComponent;
const store = async (key: string) => (await app.call('GET', `/api/envs/prod/stores/${enc(key)}`)).body;

test('access is read or write from the operation, unless the step says', () => {
  const s = (operation?: string, access?: 'read' | 'write') => accessOf({ seq: 1, type: 'resource', target: 'x', operation, access });
  assert.deepEqual([s('find'), s('GET order:{id}'), s('SELECT users'), s('GetItem'), s('insertOne'), s('SET x'), s('DEL x'), s('PutObject'), s(), s('custom', 'read')],
    ['read', 'read', 'read', 'read', 'write', 'write', 'write', 'write', 'unknown', 'read']);
  assert.equal(groupOf('mongodb:orders-db/orders'), 'mongodb:orders-db');
  assert.equal(groupOf('redis:cache-main/order:{id}'), 'redis:cache-main');
  assert.equal(groupOf('dynamodb:payments'), 'dynamodb:payments');
});

test('inventory lists every kind of object', async () => {
  const items = (await app.call('GET', '/api/envs/prod/inventory')).body as any[];
  const of = (t: string) => items.filter((x) => x.type === t);
  assert.equal(of('service').length, 63, 'infra is not a service (session-gateway and ext-checkpoint-cloud of #88 + checkout-svc of #86 + safer-lookup of #85 + safer-auth of #84 + 50 + the 5 RabbitMQ demo services of 0.18.0 + identity-svc of 0.27.1 + member-api and member-notifier of 0.37.0)');
  assert.ok(of('service').some((x) => x.id === 'catalog-svc' && x.connections.startsWith('50 endpoints')));
  assert.ok(of('channel').some((x) => x.id === 'eventbridge:acme-bus' && x.kind === 'eventbridge-bus'));
  assert.ok(of('store').some((x) => x.id === 'redis:cache-main' && x.kind === 'redis' && x.instance === 'cluster' && x.label === 'cache-main'), 'a Redis instance is one row');
  assert.ok(!of('store').some((x) => x.id.startsWith('redis:cache-main/')), 'its key patterns are not rows of their own');
  assert.ok(of('store').some((x) => x.id === 'orders-svc:sessionCache'), 'a Redis resource with no key stays a store row');
  assert.ok(of('event').some((x) => x.id === 'OrderCancelled' && x.problems === 1));
});

test('a store shows readers, writers, functions and the entry points that reach it', async () => {
  const v = await store('mongodb:orders-db/orders');
  assert.deepEqual([v.readers, v.writers], [['orders-svc'], ['orders-svc']]);
  assert.ok(v.uses[0].functions.some((f: any) => f.source.url.includes('/blob/')));
  assert.ok(v.entryPoints.some((e: any) => e.service === 'api-gateway' && e.entryPoint), 'reached across services from the public gateway route');
  const redis = await store('redis:cache-main/order:{id}');
  assert.deepEqual(redis.writers.sort(), ['orders-svc', 'shipping-svc']);
  assert.ok(redis.siblings.some((s: any) => s.key === 'redis:cache-main/user:{id}'));
  assert.equal((await app.call('GET', `/api/envs/prod/stores/${enc('mongodb:nope/x')}`)).status, 404);
});

test('read_write counts as reader and writer; fields are kept on the operation, in the trace and flagged in the contract report (#36, #37)', async () => {
  assert.equal(accessOf({ seq: 1, type: 'resource', target: 'x', operation: 'findOneAndUpdate', access: 'read_write' }), 'read_write');
  const v = await store('mongodb:orders-db/orders');
  const op = v.uses[0].functions.flatMap((f: any) => f.operations).find((o: any) => o.access === 'read_write');
  assert.equal(op.operation, 'findOneAndUpdate');
  assert.deepEqual(op.fields.filter((f: any) => f.inDdl === false).map((f: any) => f.path), ['viewCount']);
  assert.equal(v.uses[0].access, 'read_write');
  const base = sampleManifests().find((m: any) => m.service.name === 'orders-svc');
  const r = (await app.call('POST', '/api/ingest?dryRun=1', { ...base, version: base.version + 1 })).body.results[0];
  assert.ok(r.contract.findings.some((f: any) => f.code === 'field-not-in-ddl' && f.message.includes('viewCount')));
  const bad = structuredClone(base);
  bad.functions.find((f: any) => f.id === 'OrderController.touch').steps[0].fields = [{ role: 'bogus', path: 'x' }];
  assert.equal((await app.call('POST', '/api/ingest?dryRun=1', bad)).status, 422);
  const trace = (await app.call('GET', '/api/envs/prod/trace?detail=full&service=orders-svc&ingress=in.touch')).body;
  assert.ok(trace.messages.some((m: any) => m.fields?.some((f: any) => f.path === 'viewCount')));
});

test('link health flags stores with several writers and unused stores', async () => {
  const h = (await app.call('GET', '/api/envs/prod/health')).body;
  assert.deepEqual([...new Set(h.items.multipleWriters.map((x: any) => x.key))], ['redis:cache-main/order:{id}']);
  assert.deepEqual(h.items.unusedStores.map((x: any) => [x.service, x.key]), [['users-svc', 'redis:cache-main/session:{token}']]);
  assert.equal(h.totals.multipleWriters, 1);
});

test('schemas are stored per source and shown on the store', async () => {
  const key = 'redis:cache-main/order:{id}';
  assert.equal((await app.call('PUT', `/api/envs/prod/schemas/code/${enc(key)}`, { type: 'string' })).status, 200);
  assert.equal((await app.call('PUT', `/api/envs/prod/schemas/db/${enc(key)}`, { type: 'string', ttl: 300 })).status, 200);
  assert.deepEqual((await store(key)).schemas.map((s: any) => s.source), ['code', 'db']);
  assert.equal((await app.call('PUT', `/api/envs/prod/schemas/guess/${enc(key)}`, {})).status, 400);
  assert.equal((await app.call('PUT', `/api/envs/prod/schemas/code/${enc('redis:nope/x')}`, {})).status, 404);
  const sample = JSON.parse(readFileSync(join(SAMPLES, 'schemas/prod.json'), 'utf8'));
  assert.equal((await app.call('POST', '/api/envs/prod/schemas', sample)).status, 201);
  assert.equal((await app.call('DELETE', `/api/envs/prod/schemas/db/${enc(key)}`)).status, 200);
});

test('channel view: publishers, subscriptions with filters and conflicts, consumers, events', async () => {
  const v = (await app.call('GET', `/api/envs/prod/channels/${enc('sns:order-events')}`)).body;
  assert.deepEqual(v.publishers.map((p: any) => p.service), ['orders-svc']);
  const toShipping = v.subscriptions.filter((s: any) => s.to === 'sqs:shipping-order-events');
  assert.equal(toShipping.length, 2);
  assert.ok(toShipping.every((s: any) => s.conflict && s.toChannel));
  assert.ok(v.events.some((e: any) => e.type === 'OrderCancelled' && e.unhandled === 1));
  assert.ok(v.problems.some((p: string) => p.includes('reported differently')));
  const q = (await app.call('GET', `/api/envs/prod/channels/${enc('sqs:shipping-order-events')}`)).body;
  assert.deepEqual(q.consumers.map((c: any) => [c.service, c.events]), [['shipping-svc', ['OrderPlaced']]]);
});

test('event view: routes and problems', async () => {
  const v = (await app.call('GET', '/api/envs/prod/events/OrderCancelled')).body;
  assert.ok(v.deliveries.some((d: any) => d.consumer.service === 'shipping-svc' && d.handler === null && d.via.includes('sns:order-events')));
  assert.equal(v.problems.unhandled.length, 1);
});

test('MCP inventory and get_store', async () => {
  const call = async (name: string, args: any) => JSON.parse((await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { env: 'prod', ...args } } })).body.result.content[0].text);
  assert.ok((await call('inventory', { type: 'store', query: 'redis' })).every((x: any) => x.type === 'store' && x.kind === 'redis'));
  assert.deepEqual((await call('get_store', { key: 'dynamodb:payments' })).writers, ['payments-svc']);
});
