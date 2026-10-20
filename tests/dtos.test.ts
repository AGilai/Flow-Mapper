// Endpoint info and DTOs: source links, DTO CRUD and bulk load, lifetime across re-ingest, and the
// stale-schema check in the database installer.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSample, sampleManifests, startApp, SAMPLES } from './helpers.ts';
import { repoUrl } from '../core/endpoint-info.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
});
after(() => app.close());

test('repoUrl understands host paths, https and ssh remotes', () => {
  assert.equal(repoUrl('github.com/acme/orders-svc'), 'https://github.com/acme/orders-svc');
  assert.equal(repoUrl('https://gitlab.example.com/team/x.git'), 'https://gitlab.example.com/team/x');
  assert.equal(repoUrl('git@github.com:acme/orders-svc.git'), 'https://github.com/acme/orders-svc');
  assert.equal(repoUrl('not a repo'), null);
});

test('endpoint info links to the handler at the harvested commit', async () => {
  const r = await app.call('GET', '/api/envs/prod/endpoints/orders-svc/in.create');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const orders = readSample('orders-svc.json');
  const fn = orders.functions.find((f: any) => f.id === r.body.handler.id);
  assert.equal(r.body.ingress.id, 'in.create');
  assert.equal(r.body.source.url, `https://${orders.service.repo}/blob/${orders.commit}/${fn.file}#L${fn.line}`);
  assert.deepEqual(r.body.slots.map((x: any) => [x.label, x.dto]), [['Request body', null], ['Response body', null]]);
  assert.equal((await app.call('GET', '/api/envs/prod/endpoints/orders-svc/nope')).status, 404);
});

test('DTO put, get, replace and delete', async () => {
  const path = '/api/envs/prod/dtos/orders-svc/request/in.create';
  assert.equal((await app.call('PUT', path, { a: 1 })).status, 200);
  const put = await app.call('PUT', path, { orderId: 'o1', items: [{ sku: 'x' }] });
  assert.equal(put.body.role, 'request');
  const info = await app.call('GET', '/api/envs/prod/endpoints/orders-svc/in.create');
  assert.deepEqual(info.body.slots.map((x: any) => x.dto?.content ?? null), [{ orderId: 'o1', items: [{ sku: 'x' }] }, null]);
  assert.equal(info.body.slots[0].stale, false);
  assert.equal((await app.call('DELETE', path)).status, 200);
  assert.equal((await app.call('DELETE', path)).status, 404);
});

test('DTO writes are checked against the map', async () => {
  assert.equal((await app.call('PUT', '/api/envs/prod/dtos/orders-svc/body/in.create', {})).status, 400);
  assert.equal((await app.call('PUT', '/api/envs/prod/dtos/orders-svc/request/in.ghost', {})).status, 404);
  assert.equal((await app.call('PUT', '/api/envs/prod/dtos/ghost-svc/request/in.create', {})).status, 404);
});

test('DTO slots follow the endpoint: queues take a message, GETs only a response body', async () => {
  const queue = await app.call('GET', '/api/envs/prod/endpoints/notifications-svc/in.shipping');
  assert.deepEqual(queue.body.slots.map((x: any) => [x.role, x.label]), [['request', 'Message']]);
  const get = await app.call('GET', '/api/envs/prod/endpoints/orders-svc/in.get');
  assert.equal(get.body.method, 'GET');
  assert.deepEqual(get.body.slots.map((x: any) => [x.role, x.label]), [['request', 'Query / path params'], ['response', 'Response body']]);
  const noReply = await app.call('PUT', '/api/envs/prod/dtos/notifications-svc/response/in.shipping', {});
  assert.equal(noReply.status, 400);
  assert.match(noReply.body.error.message, /request = message/);
  const params = { params: { id: 'string' }, query: { page: 'integer' } };
  assert.equal((await app.call('PUT', '/api/envs/prod/dtos/orders-svc/request/in.get', params)).status, 200);
  assert.deepEqual((await app.call('GET', '/api/envs/prod/endpoints/orders-svc/in.get')).body.slots[0].dto.content, params);
  assert.equal((await app.call('DELETE', '/api/envs/prod/dtos/orders-svc/request/in.get')).status, 200);
});

test('bulk load is all or nothing', async () => {
  const sample = JSON.parse(readFileSync(join(SAMPLES, 'dtos/prod.json'), 'utf8'));
  const bad = await app.call('POST', '/api/envs/prod/dtos', { dtos: [...sample.dtos, { service: 'orders-svc', ingress: 'in.ghost', role: 'request', content: {} }] });
  assert.equal(bad.status, 404);
  assert.match(bad.body.error.message, new RegExp(`^dtos\\[${sample.dtos.length}\\]`));
  assert.equal((await app.call('GET', '/api/envs/prod/dtos')).body.length, 0);
  assert.equal((await app.call('GET', '/api/envs/prod/events')).body.filter((t: any) => t.hasDto).length, 0);
  const ok = await app.call('POST', '/api/envs/prod/dtos', sample);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.loaded, sample.dtos.length);
  assert.equal((await app.call('GET', '/api/envs/prod/dtos?service=payments-svc')).body.length, 2);
});

test('DTOs survive re-ingest and go with their service', async () => {
  await app.call('PUT', '/api/envs/prod/dtos/users-svc/response/in.getUser', { id: 'u1' });
  const users = readSample('users-svc.json');
  assert.equal((await app.call('POST', '/api/ingest', { ...users, version: users.version + 10 })).status, 201);
  const kept = (await app.call('GET', '/api/envs/prod/endpoints/users-svc/in.getUser')).body.slots.find((x: any) => x.role === 'response');
  assert.deepEqual(kept.dto.content, { id: 'u1' });
  assert.equal((await app.call('DELETE', '/api/envs/prod/services/users-svc')).status, 200);
  assert.equal((await app.call('GET', '/api/envs/prod/dtos?service=users-svc')).body.length, 0);
});

test('MCP get_endpoint_info returns code link and DTOs', async () => {
  const r = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_endpoint_info', arguments: { env: 'prod', service: 'payments-svc', ingress: 'in.charge' } } });
  assert.equal(r.body.result.isError, false);
  const info = JSON.parse(r.body.result.content[0].text);
  assert.ok(info.source.url.includes('/blob/'));
  assert.deepEqual(info.slots.map((x: any) => [x.role, !!x.dto]), [['request', true], ['response', true]]);
});

