// What harvesters report about their own data (issues #7–#10): unresolved targets and event types,
// per-item source and commit, provenance and drift.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readSample, sampleManifests, startApp } from './helpers.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
});
after(() => app.close());
const health = async () => (await app.call('GET', '/api/envs/prod/health')).body;

test('an unresolved call is reported with its reason, not as a broken link', async () => {
  const h = await health();
  assert.ok(!h.items.dangling.some((d: any) => d.id === 'audit.record'), 'not dangling');
  const u = h.items.unresolved.find((x: any) => x.id === 'audit.record');
  assert.deepEqual([u.kind, u.what, u.reason, u.detail], ['egress', 'target', 'method_or_path_unresolved', 'POST ${AUDIT_URL}/events']);
  assert.deepEqual(u.possible, [{ candidate: 'http:GET users-svc/users/{id}', service: 'users-svc', ingress: 'in.getUser' }], 'candidates are checked against real endpoints');
  assert.ok(h.items.unresolved.some((x: any) => x.kind === 'step' && x.reason === 'dynamic_dispatch' && x.fn === 'createShipment'));
  assert.equal(h.totals.unresolved, h.items.unresolved.length);
});

test('a trace shows the gap where the harvester lost the call', async () => {
  const t = (await app.call('GET', '/api/envs/prod/trace?service=orders-svc&ingress=in.create&scope=full')).body;
  const gap = t.messages.find((m: any) => m.gap?.reason === 'method_or_path_unresolved');
  assert.ok(gap && !gap.broken);
  assert.equal(t.participants.find((p: any) => p.id === gap.to).kind, 'unresolved');
  assert.match(t.code['egress:orders-svc:audit.record'].url, /src\/clients\/audit\.ts#L12$/, 'call site link');
});

test('candidate event types are possible deliveries, never unhandled or undelivered', async () => {
  const h = await health();
  assert.ok(!h.items.unhandledEvents.some((x: any) => x.event.startsWith('Payment')));
  assert.ok(!h.items.undeliveredEvents.some((x: any) => x.egress === 'refundEvents.publish'));
  const rows = (await app.call('GET', '/api/envs/prod/endpoints/analytics-svc/in.events')).body.events;
  const refund = rows.find((r: any) => r.type === 'PaymentRefunded');
  assert.equal(refund.status, 'possible');
  assert.deepEqual(refund.producers.map((p: any) => [p.service, p.possible]), [['payments-svc', true]]);
  const ev = (await app.call('GET', '/api/envs/prod/events/PaymentChargeback')).body;
  assert.deepEqual(ev.producers, [{ service: 'payments-svc', egress: 'refundEvents.publish', possible: true }]);
});

test('items link to their own source and commit; mixed commits and drift are flagged', async () => {
  const info = (await app.call('GET', '/api/envs/prod/endpoints/orders-svc/in.create')).body;
  const orders = readSample('orders-svc.json');
  assert.equal(info.definedAt.url, `https://${orders.service.repo}/blob/${orders.commit}/src/routes/orders.ts#L8`);
  const view = (await app.call('GET', '/api/envs/prod/views/service/orders-svc')).body;
  assert.match(view.egress.find((e: any) => e.id === 'inventory.reserve').at.url, /\/blob\/a51c0d2\/src\/clients\/inventory\.ts#L31$/, 'own commit wins');
  const h = await health();
  assert.deepEqual(h.items.mixedCommits.map((x: any) => [x.service, x.others]), [['orders-svc', [{ commit: 'a51c0d2', items: 1 }]]]);
  assert.deepEqual(h.items.drift.map((x: any) => [x.service, x.kind, x.id]), [['infra', 'binding', 'sub.shipping']]);
  const ch = (await app.call('GET', `/api/envs/prod/channels/${encodeURIComponent('sns:order-events')}`)).body;
  assert.match(ch.definedAt.url, /infra\/messaging\/order-events\.tf#L4$/);
  assert.ok(ch.subscriptions.some((s: any) => s.id === 'sub.shipping' && s.verified === 'drift'));
});

test('a missing bind key is accepted only with an unresolved reason', async () => {
  const m = readSample('users-svc.json');
  const base = { ...m, version: m.version + 100 };
  const bad = await app.call('POST', '/api/ingest?dryRun=1', { ...base, egress: [...m.egress, { id: 'x.out', transport: 'http' }] });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.error.details.some((d: string) => d.includes("egress 'x.out': bindKey is required")));
  const ok = await app.call('POST', '/api/ingest?dryRun=1', { ...base, egress: [...m.egress, { id: 'x.out', transport: 'http', unresolved: [{ what: 'target', reason: 'no_endpoint' }] }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});
