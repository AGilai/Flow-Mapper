// Event types: derived producers, subscription filters, per-event handlers, the event checks in link
// health, event-aware traces, and event DTOs. Uses the sample system, which plants one of each problem.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readSample, sampleManifests, startApp } from './helpers.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
});
after(() => app.close());

const events = async (service: string, ingress: string) =>
  (await app.call('GET', `/api/envs/prod/endpoints/${service}/${ingress}`)).body.events as any[];
const row = (rows: any[], type: string) => rows.find((r) => r.type === type);

test('producers are derived through topic, subscription and queue', async () => {
  const rows = await events('shipping-svc', 'in.orderPlaced');
  const placed = row(rows, 'OrderPlaced');
  assert.equal(placed.status, 'ok');
  assert.equal(placed.handler, 'onOrderPlaced');
  assert.deepEqual(placed.producers.map((p: any) => [p.service, p.egress, p.derived]), [['orders-svc', 'orderEvents.publish', true]]);
  assert.match(placed.source.url, /blob\/.+#L\d+$/);
});

test('an event that arrives without a handler is unhandled', async () => {
  const cancelled = row(await events('shipping-svc', 'in.orderPlaced'), 'OrderCancelled');
  assert.equal(cancelled.status, 'unhandled');
  assert.equal(cancelled.handler, null);
  assert.equal(cancelled.producers[0].service, 'orders-svc');
});

test('declared producers: external ones are declared-only, harvested ones must be seen', async () => {
  const rows = await events('inventory-svc', 'in.orderEvents');
  const refunded = row(rows, 'OrderRefunded');
  assert.equal(refunded.status, 'declared-only');
  assert.deepEqual(refunded.producers.map((p: any) => [p.service, p.declared, p.harvested]), [['billing-legacy', true, false]]);
  assert.equal(row(rows, 'PaymentCaptured').producers[0].harvested, true); // payments-svc never sends it to this queue
  assert.equal(row(rows, 'StockRecount').status, 'never');
  assert.equal(row(rows, 'OrderPlaced').status, 'ok');
});

test('glob filters and handlers: analytics takes every event through sns:*-events and User* from the bus', async () => {
  const types = (await events('analytics-svc', 'in.events')).map((r) => [r.type, r.pattern, r.handler]);
  for (const t of ['OrderPlaced', 'OrderCancelled', 'PaymentCaptured', 'UserRegistered']) assert.ok(types.some((x) => x[0] === t && x[1] === '*' && x[2] === 'ingest_event'), t);
  assert.ok(!types.some((x) => x[0] === 'ProfileViewed'), 'the User* rule filters ProfileViewed out');
});

test('link health reports every event problem', async () => {
  const h = (await app.call('GET', '/api/envs/prod/health')).body;
  assert.deepEqual(h.items.unhandledEvents.map((x: any) => [x.service, x.event]), [['shipping-svc', 'OrderCancelled']]);
  assert.deepEqual(h.items.undeliveredEvents.map((x: any) => [x.service, x.event]), [['users-svc', 'ProfileViewed']]);
  assert.deepEqual(h.items.neverArrives.map((x: any) => x.event), ['StockRecount']);
  assert.deepEqual(h.items.declaredNotSeen.map((x: any) => [x.event, x.producer]), [['PaymentCaptured', 'payments-svc']]);
  assert.equal(h.items.subscriptionConflicts.length, 1);
  const c = h.items.subscriptionConflicts[0];
  assert.deepEqual([c.from, c.to], ['sns:order-events', 'sqs:shipping-order-events']);
  assert.deepEqual(c.declarations.map((d: any) => [d.service, d.events]).sort(), [['infra', ['OrderPlaced']], ['shipping-svc', '*']]);
  assert.equal(h.totals.unhandledEvents, 1);
});

test('traces carry the event type and run the handler for it', async () => {
  const t = (await app.call('GET', '/api/envs/prod/trace?service=orders-svc&ingress=in.create&scope=full')).body;
  const deliveries = t.messages.filter((m: any) => m.kind === 'deliver' && m.event === 'OrderPlaced');
  assert.ok(deliveries.some((m: any) => m.label.endsWith('→ onOrderPlaced')));
  assert.ok(deliveries.some((m: any) => m.label.endsWith('→ OnOrderEvent')));
  assert.ok(!t.messages.some((m: any) => m.unhandled));
  const start = (await app.call('GET', '/api/envs/prod/trace?service=inventory-svc&ingress=in.orderEvents&event=OrderPlaced&scope=intra')).body;
  assert.equal(start.start.fn, 'OnOrderEvent');
  assert.equal(start.start.event, 'OrderPlaced');
});

test('event DTOs: put, show on the consumer, reject patterns', async () => {
  assert.equal((await app.call('PUT', '/api/envs/prod/event-dtos/OrderPlaced', { orderId: 'o1' })).status, 200);
  assert.deepEqual(row(await events('shipping-svc', 'in.orderPlaced'), 'OrderPlaced').dto.content, { orderId: 'o1' });
  const one = (await app.call('GET', '/api/envs/prod/events/OrderPlaced')).body;
  assert.deepEqual(one.producers, [{ service: 'orders-svc', egress: 'orderEvents.publish' }]);
  assert.ok(one.consumers.some((c: any) => c.service === 'analytics-svc'));
  assert.equal((await app.call('PUT', '/api/envs/prod/event-dtos/Order*', {})).status, 400);
  const bulk = await app.call('POST', '/api/envs/prod/dtos', { dtos: [{ event: 'UserRegistered', content: { userId: 'u1' } }] });
  assert.equal(bulk.status, 201);
  const flags = async () => Object.fromEntries(((await app.call('GET', '/api/envs/prod/inventory')).body as any[]).filter((x) => x.type === 'event').map((x) => [x.id, x.hasDto]));
  assert.equal((await flags()).OrderPlaced, true, 'inventory marks event types that have a DTO');
  assert.equal((await flags()).UserRegistered, true);
  assert.equal((await app.call('DELETE', '/api/envs/prod/event-dtos/UserRegistered')).status, 200);
  assert.equal((await flags()).UserRegistered, false);
});

test('an event handler that is not a function is rejected', async () => {
  const m = readSample('shipping-svc.json');
  m.version += 50;
  m.ingress[0].events = [{ type: 'OrderPlaced', handler: 'nope' }];
  const r = await app.call('POST', '/api/ingest', m);
  assert.equal(r.status, 422);
  assert.ok(r.body.error.details.some((d: string) => d.includes("event 'OrderPlaced'")));
});

test('MCP event_types lists producers and consumers', async () => {
  const r = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'event_types', arguments: { env: 'prod', type: 'UserRegistered' } } });
  const t = JSON.parse(r.body.result.content[0].text);
  assert.deepEqual(t.producers, [{ service: 'users-svc', egress: 'userEvents.publish' }]);
  assert.deepEqual(t.consumers.map((c: any) => [c.service, c.handler]), [['analytics-svc', 'ingest_event']]);
});

test('trace arrows say where the call is made, what handles it, and which store they touch', async () => {
  const t = (await app.call('GET', '/api/envs/prod/trace?service=orders-svc&ingress=in.create&scope=full')).body;
  const publish = t.messages.find((m: any) => m.kind === 'egress' && m.event === 'OrderPlaced');
  assert.equal(publish.fn, 'OrderService.place');
  assert.ok(publish.seq > 0);
  assert.match(t.code[`orders-svc:${publish.fn}`].url, /#L\d+$/);
  const delivery = t.messages.find((m: any) => m.kind === 'deliver' && m.target?.service === 'shipping-svc');
  assert.deepEqual(delivery.target, { service: 'shipping-svc', ingress: 'in.orderPlaced', fn: 'onOrderPlaced' });
  assert.ok(t.code['shipping-svc:onOrderPlaced']);
  assert.ok(t.messages.some((m: any) => m.kind === 'resource' && m.store === 'mongodb:orders-db/orders'));
  assert.ok(t.messages.some((m: any) => m.kind === 'call' && m.calls === 'OrderService.place'));
});

test('expanding a service in a full trace draws its functions as lifelines', async () => {
  const base = '/api/envs/prod/trace?service=api-gateway&ingress=in.createOrder&scope=full';
  const t = (await app.call('GET', base)).body;
  const orders = t.participants.find((p: any) => p.id === 'svc:orders-svc');
  assert.ok(orders.internalCalls > 0, 'collapsed service reports its internal calls');
  const x = (await app.call('GET', `${base}&expand=orders-svc`)).body;
  assert.ok(!x.participants.some((p: any) => p.id === 'svc:orders-svc'));
  const fns = x.participants.filter((p: any) => p.kind === 'function' && p.service === 'orders-svc').map((p: any) => p.id);
  assert.ok(fns.includes('fn:orders-svc:OrderService.place'));
  assert.ok(x.messages.some((m: any) => m.kind === 'call' && m.from === 'fn:orders-svc:OrderController.create' && m.to === 'fn:orders-svc:OrderService.validate'));
});

test('subscription filters support "!" exclusions (anything-but, negated prefix)', async () => {
  const { filterAllows } = await import('../core/glob.ts');
  assert.equal(filterAllows(['!revision.status'], 'revision.status'), false);
  assert.equal(filterAllows(['!revision.status'], 'OrderPlaced'), true);
  assert.equal(filterAllows(['Order*', '!OrderDraft*'], 'OrderDraftSaved'), false);
  assert.equal(filterAllows(['Order*', '!OrderDraft*'], 'OrderPlaced'), true);
  assert.equal(filterAllows(['Order*', '!OrderDraft*'], 'User'), false);
  assert.equal(filterAllows(['A', 'B'], 'A'), true);
});
