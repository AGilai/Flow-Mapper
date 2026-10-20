// #40: a publish step with no event type does not fan out to every subscriber of the topic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { flowCounts } from '../core/flow-counts.ts';
import { sampleModel } from './helpers.ts';

const svc = 'account-lambda-erase-controller';
const consumers = (t: ReturnType<typeof trace>) => t!.messages.filter((m) => m.kind === 'deliver' && m.target).map((m) => m.target!.service).sort();

test('untyped publish with candidates reaches matching and unfiltered subscribers only; candidate-only ones are possible', () => {
  const g = buildIndex(sampleModel());
  const t = trace(g, { service: svc, ingress: 'in.publishDeviceEvent' }, { scope: 'full' })!;
  // candidates: account.tenant.deleted, agent.device.loggedOut
  assert.deepEqual(consumers(t), ['billing-eraser', 'crm-sync', 'data-lake-ingest', 'tenant-notifier']);
  const possible = t.messages.filter((m) => m.possible);
  assert.ok(possible.length > 0);
  assert.ok(possible.every((m) => m.label.includes(' · possible')));
  const by = (s: string) => t.messages.filter((m) => m.target?.service === s || m.to === `svc:${s}`);
  assert.ok(by('billing-eraser').every((m) => m.possible), 'filtered by a candidate only');
  assert.ok(by('data-lake-ingest').every((m) => !m.possible), 'unfiltered subscription gets it for sure');
  assert.ok(!t.messages.some((m) => m.gap));
});

test('untyped publish with no known event stops at the topic for filtered subscriptions and says so', () => {
  const g = buildIndex(sampleModel());
  const t = trace(g, { service: svc, ingress: 'in.publishUnknownEvent' }, { scope: 'full' })!;
  assert.deepEqual(consumers(t), ['crm-sync', 'data-lake-ingest']); // unfiltered subscriptions only
  const gaps = t.messages.filter((m) => m.gap);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].label, 'event unknown: not delivered');
  assert.equal(gaps[0].from, 'ch:sns:production-event-bus-sns');
  assert.ok(!t.messages.some((m) => m.possible));
});

test('a typed publish is unchanged', () => {
  const g = buildIndex(sampleModel());
  const t = trace(g, { service: svc, ingress: 'in.notifyBilling' }, { scope: 'full' })!;
  assert.ok(!t.messages.some((m) => m.possible || m.gap));
});

test('flow counts agree with the traces of the untyped publishes', () => {
  const g = buildIndex(sampleModel());
  const counts = flowCounts(g);
  for (const ingress of ['in.publishDeviceEvent', 'in.publishUnknownEvent']) {
    const t = trace(g, { service: svc, ingress }, { scope: 'full' })!;
    const ids = t.participants.filter((p) => ['service', 'channel', 'resource'].includes(p.kind));
    assert.equal(counts.find((c) => c.service === svc && c.ingress === ingress)!.total, ids.length);
  }
});

test('a delivery matched through the egress events / candidates names the event on the arrow and in the message (#40)', () => {
  const t = trace(buildIndex(sampleModel()), { service: svc, ingress: 'in.publishDeviceEvent' }, { scope: 'full' })!;
  const billing = t.messages.filter((m) => m.delivery && (m.to === 'svc:billing-eraser' || m.target?.service === 'billing-eraser'));
  assert.ok(billing.length >= 1);
  for (const m of billing) {
    assert.deepEqual(m.matched, ['account.tenant.deleted']);
    assert.ok(m.label.includes(' · account.tenant.deleted'), m.label);
  }
  // a catch-all subscription says nothing about the type: no event on its arrows
  const lake = t.messages.filter((m) => m.target?.service === 'data-lake-ingest' || m.to === 'svc:data-lake-ingest');
  assert.ok(lake.length && lake.every((m) => !m.matched));
});
