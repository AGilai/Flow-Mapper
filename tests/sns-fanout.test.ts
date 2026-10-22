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
  // the consumers' own calls hang under the bar, after the last delivery, one delivery after another (never between deliveries)
  const lastDelivery = t.messages.reduce((a, m, i) => (m.delivery ? i : a), -1);
  const first = t.messages.indexOf(pub);
  assert.ok(t.messages.slice(first, lastDelivery + 1).every((m) => m === pub || m.delivery), 'only the deliveries sit inside the bar');
  const after = t.messages.slice(lastDelivery + 1);
  const at = (svc: string) => after.findIndex((m) => m.from === `svc:${svc}`);
  assert.ok(at('shipping-svc') >= 0 && at('inventory-svc') > at('shipping-svc'), 'delivery 2 is expanded before delivery 3');
  assert.ok(after.some((m) => m.from === 'svc:shipping-svc' && m.kind === 'call'));
});

test('a send to a single queue is not a fan-out: no group, no delivery', () => {
  const single = full().messages.filter((m) => m.to === 'ch:sns:payment-events' || m.from === 'ch:sns:payment-events');
  assert.equal(single.length, 2);
  for (const m of single) assert.ok(!m.group && !m.delivery && !m.deliveries);
  assert.ok(full({ service: 'account-lambda-erase-controller', ingress: 'in.notifyBilling' }).messages.every((m) => !m.group && !m.delivery));
});

test('lifelines run producer > topic > queue > consumer even when the consumer was met first (#35)', async () => {
  const t = full();
  const at = (id: string) => t.participants.findIndex((p) => p.id === id);
  for (const m of t.messages) if (m.to.startsWith('ch:') && !m.from.startsWith('ch:') && m.from !== m.to) assert.ok(at(m.from) < at(m.to), `${m.from} -> ${m.to}`);
});

test('API and MCP trace return the fan-out fields', async () => {
  const app = await startApp();
  try {
    const r = await app.call('POST', '/api/ingest', { manifests: sampleManifests() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const api = (await app.call('GET', '/api/envs/prod/trace?detail=full&service=api-gateway&ingress=in.createOrder')).body;
    assert.equal(api.messages.filter((m: any) => m.deliveries === 3).length, 1);
    assert.deepEqual(api.messages.filter((m: any) => m.delivery).map((m: any) => m.delivery), [1, 1, 2, 2, 3, 3]);
    const mcp = JSON.parse((await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'trace_flow', arguments: { detail: 'full', env: 'prod', service: 'api-gateway', ingress: 'in.createOrder' } } })).body.result.content[0].text);
    assert.equal(mcp.messages.filter((m: any) => m.delivery).length, 6);
  } finally { app.close(); }
});

test('a topic sits right of its producer even when the consumer service comes first on the trace (#35)', () => {
  const svc = (name: string) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01' }) as any;
  const m: any = {
    env: 't', services: ['c', 'p', 'infra'].map(svc),
    functions: [
      { service: 'c', id: 'h', name: 'h', steps: [{ seq: 1, type: 'egress', target: 'toP' }] },
      { service: 'c', id: 'hq', name: 'hq', steps: [] },
      { service: 'p', id: 'hp', name: 'hp', steps: [{ seq: 1, type: 'egress', target: 'pub', event: 'A' }] },
    ],
    ingress: [
      { service: 'c', id: 'in.s', bindKey: 'http:GET c/s', transport: 'http', handler: 'h', entryPoint: true },
      { service: 'c', id: 'in.q', bindKey: 'sqs:q', transport: 'sqs', handler: 'hq' },
      { service: 'p', id: 'in.x', bindKey: 'http:GET p/x', transport: 'http', handler: 'hp' },
    ],
    egress: [
      { service: 'c', id: 'toP', bindKey: 'http:GET p/x', transport: 'http' },
      { service: 'p', id: 'pub', bindKey: 'sns:t', transport: 'sns', events: ['A'] },
    ],
    resources: [],
    channels: [{ service: 'infra', bindKey: 'sns:t', kind: 'sns-topic' }, { service: 'infra', bindKey: 'sqs:q', kind: 'sqs-queue' }],
    bindings: [{ service: 'infra', id: 'b', from: 'sns:t', to: 'sqs:q' }],
  };
  const t = trace(buildIndex(m), { service: 'c', ingress: 'in.s' }, { scope: 'full' })!;
  const ids = t.participants.map((p) => p.id);
  assert.ok(t.messages.some((x) => x.to === 'ch:sns:t'), JSON.stringify(t.messages.map((x) => [x.from, x.to])));
  assert.ok(ids.indexOf('svc:p') < ids.indexOf('ch:sns:t'), ids.join(' '));
  assert.ok(ids.indexOf('ch:sns:t') < ids.indexOf('ch:sqs:q'), ids.join(' '));
});

