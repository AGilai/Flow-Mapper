// Bug #35 part 2: an SNS publish that fans out to several queues numbers its deliveries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { sampleModel, sampleManifests, startApp } from './helpers.ts';

const start = { service: 'api-gateway', ingress: 'in.createOrder' };
const full = (s = start) => trace(buildIndex(sampleModel()), s, { scope: 'full' })!;

test('a fan-out publish carries a group and a delivery count; each delivery gets an ordinal on both its messages', () => {
  const t = full();
  const pub = t.messages.find((m) => m.deliveries)!;
  assert.equal(pub.to, 'ch:sns:order-events');
  assert.equal(pub.deliveries, 3);
  const dl = t.messages.filter((m) => m.delivery);
  assert.deepEqual(dl.map((m) => [m.delivery, m.group === pub.group, m.from.slice(0, 3), m.to.slice(0, 3)]),
    [[1, true, 'ch:', 'ch:'], [1, true, 'ch:', 'svc'], [2, true, 'ch:', 'ch:'], [2, true, 'ch:', 'svc'], [3, true, 'ch:', 'ch:'], [3, true, 'ch:', 'svc']]);
  assert.deepEqual(dl.filter((m) => m.to.startsWith('svc')).map((m) => m.target?.service), ['analytics-svc', 'shipping-svc', 'inventory-svc']);
  // the consumer's own calls sit between its delivery and the next one, in order
  const idx = (n: number) => t.messages.findIndex((m) => m.delivery === n && m.to.startsWith('ch:'));
  assert.ok(t.messages.slice(idx(2), idx(3)).some((m) => m.from === 'svc:shipping-svc' && m.kind === 'call'));
  assert.ok(!t.messages.slice(idx(1), idx(2)).some((m) => m.from === 'svc:shipping-svc'));
});

test('a send to a single queue is not a fan-out: no group, no delivery', () => {
  const single = full().messages.filter((m) => m.to === 'ch:sns:payment-events' || m.from === 'ch:sns:payment-events');
  assert.equal(single.length, 2);
  for (const m of single) assert.ok(!m.group && !m.delivery && !m.deliveries);
  assert.ok(full({ service: 'account-lambda-erase-controller', ingress: 'in.notifyBilling' }).messages.every((m) => !m.group && !m.delivery));
});

test('rows: the two halves of a delivery share a row; without the fields every message has its own', async () => {
  const { rowsOf } = await import('../web/js/views/sequence-render.js');
  const t = full();
  const { rows, count } = rowsOf(t.messages);
  assert.equal(count, t.messages.length - 3);
  for (const n of [1, 2, 3]) {
    const a = t.messages.findIndex((m) => m.delivery === n);
    assert.equal(rows[a], rows[a + 1]);
  }
  assert.equal(rowsOf(t.messages.map(({ group, deliveries, delivery, ...m }) => m)).count, t.messages.length);
});

test('API and MCP trace return the fan-out fields', async () => {
  const app = await startApp();
  try {
    const r = await app.call('POST', '/api/ingest', { manifests: sampleManifests() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const api = (await app.call('GET', '/api/envs/prod/trace?service=api-gateway&ingress=in.createOrder')).body;
    assert.equal(api.messages.filter((m: any) => m.deliveries === 3).length, 1);
    assert.deepEqual(api.messages.filter((m: any) => m.delivery).map((m: any) => m.delivery), [1, 1, 2, 2, 3, 3]);
    const mcp = JSON.parse((await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'trace_flow', arguments: { env: 'prod', service: 'api-gateway', ingress: 'in.createOrder' } } })).body.result.content[0].text);
    assert.equal(mcp.messages.filter((m: any) => m.delivery).length, 6);
  } finally { app.close(); }
});
