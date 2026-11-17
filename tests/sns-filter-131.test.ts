// #131: a binding from an SNS topic straight to a service ingress (`to` = the ingress key, `events` = the filter) filters what that
// ingress receives, like a topic -> queue binding. An ingress with no such binding still gets every event.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, readSample } from './helpers.ts';
import { eventReport } from '../core/events.ts';

let app: Awaited<ReturnType<typeof startApp>>;
const names = ['order-events-pub', 'order-lambda-placed', 'order-lambda-cancelled'];
before(async () => {
  app = await startApp();
  const r = await app.call('POST', '/api/ingest', { manifests: names.map((n) => readSample(`${n}.json`)) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});
after(() => app.close());

const flow = async () => (await app.call('GET', '/api/envs/prod/trace?detail=full&service=order-events-pub&ingress=in.place')).body;
const pairs = (r: any) => r.deliveries.map((d: any) => `${d.event}>${d.consumer.service}:${d.handler}`).sort();

test('the trace: each direct SNS consumer gets only its events, no "no handler" delivery', async () => {
  const t = await flow();
  const txt = JSON.stringify(t.messages);
  assert.ok(!t.messages.some((m: any) => m.noHandler || m.unhandled), txt);
  const got = t.messages.filter((m: any) => /order-lambda/.test(m.to)).map((m: any) => `${m.event}>${m.to}`);
  assert.deepEqual(got, ['order.placed>svc:order-lambda-placed', 'order.cancelled>svc:order-lambda-cancelled'], txt);
});

test('the report: only filtered deliveries, no unhandled, no orphan, no broken binding', () => {
  const g = app.ctx.graph('prod');
  const r = eventReport(g);
  assert.deepEqual(pairs(r), ['order.cancelled>order-lambda-cancelled:onCancelled', 'order.placed>order-lambda-placed:onPlaced']);
  assert.equal(r.unhandled.length, 0);
  assert.equal(g.resolution.orphans.length, 0);
  assert.equal(g.resolution.brokenBindings.length, 0);
});

test('a direct-sns ingress with no binding keeps getting every event', async () => {
  const m = readSample('order-lambda-cancelled.json');
  m.bindings = [];
  m.version = 2;
  assert.equal((await app.call('POST', '/api/ingest', { manifests: [m] })).status, 201);
  const r = eventReport(app.ctx.graph('prod'));
  assert.deepEqual(pairs(r), ['order.cancelled>order-lambda-cancelled:onCancelled', 'order.placed>order-lambda-cancelled:null', 'order.placed>order-lambda-placed:onPlaced']);
  assert.equal((await app.call('POST', '/api/ingest', { manifests: [{ ...readSample('order-lambda-cancelled.json'), version: 3 }] })).status, 201); // back to the sample
});

test('drafts: a binding op with to = an ingress key and events filters the trace in the draft', async () => {
  const e = await app.call('POST', '/api/envs', { name: 'ord', source: 'prod', mode: 'components', groups: [{ key: 'orders', label: 'Orders' }], entryPoints: 'keep',
    services: names.map((s) => ({ name: s, groupPath: 'orders' })) });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  assert.equal((await app.call('POST', '/api/envs/ord/drafts', { name: 'f', slug: 'f' })).status, 201);
  const url = '/api/envs/ord/trace?detail=full&service=order-events-pub&ingress=in.place&draft=f';
  const seen = async () => (await app.call('GET', url)).body.messages.filter((m: any) => /order-lambda/.test(m.to)).map((m: any) => `${m.event}>${m.to.replace('svc:order-lambda-', '')}`).sort();
  const filtered = ['order.cancelled>cancelled', 'order.placed>placed'];
  const op = (events: string[]) => ({ ops: [{ op: 'upsert', anchor: 'bind:order-lambda-cancelled/sub.order-events', data: { id: 'sub.order-events', from: 'sns:order-events-131', to: 'sns:order-events-131', events, filter: { eventType: events } } }] });
  const fn = readSample('order-events-pub.json').functions[0]; // a Components copy keeps no handler code: bring it into the draft
  assert.equal((await app.call('POST', '/api/envs/ord/drafts/f/ops', { ops: [{ op: 'upsert', anchor: 'fn:order-events-pub/placeOrder', data: fn }] })).status, 201);
  assert.deepEqual(await seen(), filtered, 'the copy brings the filtered subscriptions');
  assert.equal((await app.call('POST', '/api/envs/ord/drafts/f/ops', { ops: [{ op: 'delete', anchor: 'bind:order-lambda-cancelled/sub.order-events' }] })).status, 201);
  const before = await seen();
  assert.ok(before.includes('order.placed>cancelled'), before.join());
  assert.equal((await app.call('POST', '/api/envs/ord/drafts/f/ops', op(['order.cancelled']))).status, 201);
  assert.deepEqual(await seen(), filtered);
  assert.equal((await app.call('POST', '/api/envs/ord/drafts/f/ops', op(['order.placed']))).status, 201);
  assert.deepEqual(await seen(), ['order.placed>cancelled', 'order.placed>placed']);
});
