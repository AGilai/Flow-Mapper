// DTO response statuses and provenance (meta): API, bulk load, endpoint info, samples.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sampleManifests, startApp } from './helpers.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLES } from './helpers.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
  const sample = JSON.parse(readFileSync(join(SAMPLES, 'dtos/prod.json'), 'utf8'));
  assert.equal((await app.call('POST', '/api/envs/prod/dtos', sample)).status, 201);
});
after(() => app.close());

test('error responses get their own slot, success first; provenance round-trips', async () => {
  const base = '/api/envs/prod/dtos/payments-svc';
  const meta = { source: { repo: 'github.com/acme/payments-svc', ref: 'abc1234', file: 'src/a.ts', line: 7 }, provenance: 'openapi', incomplete: 'joi_when' };
  assert.equal((await app.call('PUT', `${base}/response/in.charge?status=404`, { error: 'nf' })).status, 200);
  assert.equal((await app.call('PUT', `${base}/response/in.charge?status=4XX&meta=${encodeURIComponent(JSON.stringify(meta))}`, { error: 'bad' })).status, 200);
  const info = (await app.call('GET', '/api/envs/prod/endpoints/payments-svc/in.charge')).body;
  assert.deepEqual(info.slots.map((x: any) => [x.role, x.status, x.label]),
    [['request', '', 'Request body'], ['response', '', 'Response body'], ['response', '404', 'Response 404'], ['response', '4xx', 'Response 4xx']]);
  assert.deepEqual(info.slots[2].dto.content, { error: 'nf' });
  assert.deepEqual(info.slots[3].dto.meta, meta);
  assert.equal(info.slots[3].dto.link.url, 'https://github.com/acme/payments-svc/blob/abc1234/src/a.ts#L7');
  assert.equal((await app.call('PUT', `${base}/response/in.charge?status=teapot`, {})).status, 400);
  assert.equal((await app.call('PUT', `${base}/request/in.charge?status=404`, {})).status, 400);
  assert.equal((await app.call('PUT', `${base}/response/in.charge?meta=${encodeURIComponent('{"source":5}')}`, {})).status, 400);
  assert.equal((await app.call('DELETE', `${base}/response/in.charge?status=404`)).status, 200);
  assert.equal((await app.call('DELETE', `${base}/response/in.charge?status=404`)).status, 404);
  assert.equal((await app.call('DELETE', `${base}/response/in.charge?status=4xx`)).status, 200);
  assert.equal((await app.call('GET', '/api/envs/prod/endpoints/payments-svc/in.charge')).body.slots.length, 2);
});

test('bulk load and event DTOs take status and meta', async () => {
  const meta = { source: { file: 'schemas/x.json' }, incomplete: true };
  const r = await app.call('POST', '/api/envs/prod/dtos', { dtos: [
    { service: 'payments-svc', ingress: 'in.charge', role: 'response', status: 'default', content: { e: 1 }, meta },
    { event: 'OrderPlaced', content: { a: 1 }, meta },
  ] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const list = (await app.call('GET', '/api/envs/prod/dtos?service=payments-svc&ingress=in.charge')).body;
  assert.deepEqual(list.map((d: any) => [d.role, d.status]), [['request', ''], ['response', ''], ['response', 'default']]);
  assert.deepEqual(list[2].meta, meta);
  assert.equal(list[0].meta, null);
  assert.deepEqual((await app.call('GET', '/api/envs/prod/events/OrderPlaced')).body.dto.meta, meta);
  assert.equal((await app.call('DELETE', '/api/envs/prod/dtos/payments-svc/response/in.charge?status=default')).status, 200);
});

test('the sample loads a 404 response and a DTO with provenance', async () => {
  const info = (await app.call('GET', '/api/envs/prod/endpoints/orders-svc/in.get')).body;
  assert.ok(info.slots.some((x: any) => x.status === '404' && x.dto?.meta.incomplete));
  const create = (await app.call('GET', '/api/envs/prod/endpoints/orders-svc/in.create')).body.slots.find((x: any) => x.role === 'response');
  assert.match(create.dto.link.url, /blob\/fb390dc\/src\/schemas\/createOrder\.response\.json#L1$/);
});

test('MCP load_dtos accepts status and meta', async () => {
  const call = (args: any) => app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'load_dtos', arguments: args } });
  const r = await call({ env: 'prod', dtos: [{ service: 'payments-svc', ingress: 'in.charge', role: 'response', status: '500', content: {}, meta: { provenance: 'x' } }] });
  assert.equal(r.body.result.isError, false, JSON.stringify(r.body));
  assert.equal((await call({ env: 'prod', dtos: [{ service: 'payments-svc', ingress: 'in.charge', role: 'response', status: 'x', content: {} }] })).body.result.isError, true);
});
