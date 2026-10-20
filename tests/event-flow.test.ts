// The event flow: producer service -> topic -> queue -> consumer service, with outcomes that must
// agree with eventReport(). A small hand-built model for the cases, the sample system for the agreement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { eventFlow, type EventRow } from '../core/event-flow.ts';
import { eventReport, eventTypes } from '../core/events.ts';
import type { Model } from '../core/types.ts';
import { sampleManifests, startApp } from './helpers.ts';

const model = (over: Partial<Model> = {}): Model => ({
  env: 't',
  services: ['pub', 'pub2', 'infra', 'sub', 'sub2'].map((name) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01' }) as any),
  functions: [],
  ingress: [
    { service: 'sub', id: 'in.a', bindKey: 'sqs:q1', transport: 'sqs', handler: 'h', events: [{ type: 'A', handler: 'onA' }] },
    { service: 'sub', id: 'in.b', bindKey: 'sqs:q2', transport: 'sqs', handler: 'h', events: [{ type: 'A', handler: 'onA2' }] },
    { service: 'sub2', id: 'in.c', bindKey: 'sqs:q3', transport: 'sqs', handler: 'h', events: [{ type: 'Z', handler: 'onZ' }] },
  ],
  egress: [
    { service: 'pub', id: 'out', bindKey: 'sns:t', transport: 'sns', events: ['A'] },
    { service: 'pub', id: 'direct', bindKey: 'sqs:q2', transport: 'sqs', events: ['A'] },
  ],
  resources: [],
  channels: ['sns:t', 'sqs:q1', 'sqs:q2', 'sqs:q3'].map((bindKey) => ({ service: 'infra', bindKey, kind: bindKey.startsWith('sns') ? 'sns-topic' : 'sqs-queue' }) as any),
  bindings: [
    { service: 'infra', id: 's1', from: 'sns:t', to: 'sqs:q1' },
    { service: 'infra', id: 's2', from: 'sns:t', to: 'sqs:q2', events: ['A'] },
    { service: 'infra', id: 's3', from: 'sns:t', to: 'sqs:q3', events: ['Z'] },
  ],
  ...over,
});
const rows = (m: Model, type = 'A') => eventFlow(buildIndex(m), type).groups.flatMap((p) => p.targets.flatMap((t) => t.rows));

test('one producer node, a direct send and a topic, consumers per service, filtered rows kept but marked', () => {
  const f = eventFlow(buildIndex(model()), 'A');
  assert.equal(f.groups.length, 1);
  const [g] = f.groups;
  assert.deepEqual([g.producer, g.possible, g.callSites.length], ['pub', false, 2]);
  assert.deepEqual(g.targets.map((t) => [t.topic?.key ?? null, t.direct]), [[null, true], ['sns:t', false]]);
  const topic = g.targets[1].rows;
  assert.deepEqual(topic.map((r) => [r.queue?.key, r.consumer, r.outcome]), [['sqs:q1', 'sub', 'handled'], ['sqs:q2', 'sub', 'handled'], ['sqs:q3', 'sub2', 'filtered']]);
  assert.equal(topic[0].ingresses[0].handler, 'onA');
  assert.match(f.summary.text, /pub publishes it to sns:t and straight to one queue\. It reaches 1 service through 2 queues\./);
  assert.ok(!/q3|sub2/.test(f.summary.text));
});

test('a consumer that lists other types has no handler; any-type consumers are marked', () => {
  const m = model({ ingress: [
    { service: 'sub', id: 'in.a', bindKey: 'sqs:q1', transport: 'sqs', handler: 'h', events: [{ type: 'B', handler: 'onB' }] },
    { service: 'sub', id: 'in.b', bindKey: 'sqs:q2', transport: 'sqs', handler: 'h', events: [{ type: '*', handler: 'all' }] },
  ] });
  const r = rows(m);
  const q1 = r.find((x) => x.queue?.key === 'sqs:q1')!, q2 = r.find((x) => x.queue?.key === 'sqs:q2' && x.outcome !== 'filtered')!;
  assert.deepEqual([q1.outcome, q1.ingresses[0].any, q1.ingresses[0].handles], ['no-handler', false, ['B']]);
  assert.deepEqual([q2.outcome, q2.ingresses[0].any, q2.ingresses[0].handler], ['handled', true, 'all']);
  assert.match(eventFlow(buildIndex(m), 'A').summary.callouts[0].text, /sub receives it on sqs:q1 but has no handler/);
});

test('a candidate producer is possible; its rows say what would happen', () => {
  const m = model({ egress: [{ service: 'pub2', id: 'out', bindKey: 'sns:t', transport: 'sns', events: [], unresolved: [{ what: 'event', reason: 'runtime', candidates: ['A', 'B'] }] } as any] });
  const f = eventFlow(buildIndex(m), 'A');
  assert.equal(f.groups[0].possible, true);
  assert.deepEqual(f.groups[0].targets[0].rows.filter((r) => r.outcome !== 'filtered').map((r) => [r.outcome, r.ifSent]), [['possible', 'handled'], ['possible', 'handled']]);
  assert.deepEqual(f.groups[0].callSites[0].candidates, ['A', 'B']);
  assert.match(f.summary.text, /^No service is known to publish A; pub2 may/);
});

test('no producer: consumers that list the type are reported as unfed, with their queue and topic', () => {
  const f = eventFlow(buildIndex(model({ egress: [] })), 'A');
  assert.equal(f.groups.length, 0);
  assert.deepEqual(f.unfed.map((t) => [t.topic?.key, t.rows.map((r) => r.queue?.key)]), [['sns:t', ['sqs:q1', 'sqs:q2']]]);
  assert.match(f.summary.text, /^Nothing harvested publishes A, but 1 service handles it\./);
});

test('every subscription filters it out: no visible row and the verdict says so', () => {
  const m = model({ bindings: [{ service: 'infra', id: 's3', from: 'sns:t', to: 'sqs:q1', events: ['Z'] }], egress: [{ service: 'pub', id: 'out', bindKey: 'sns:t', transport: 'sns', events: ['A'] }] });
  const f = eventFlow(buildIndex(m), 'A');
  assert.ok(f.groups[0].targets[0].rows.every((r) => r.outcome === 'filtered'));
  assert.match(f.summary.text, /no subscription lets it through/);
});

test('an unresolved target is listed', () => {
  const m = model({ egress: [{ service: 'pub', id: 'out', bindKey: 'sns:nowhere', transport: 'sns', events: ['A'], unresolved: [{ what: 'target', reason: 'ARN read at runtime' }] } as any] });
  const f = eventFlow(buildIndex(m), 'A');
  assert.equal(f.unresolved.length, 1);
  assert.match(f.unresolved[0].reason, /runtime/);
  assert.equal(f.groups[0].targets.length, 0);
});

test('on the samples the outcomes agree with eventReport for every event type', async () => {
  const app = await startApp();
  try {
    assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
    const g = app.ctx.graph('prod');
    const report = eventReport(g);
    let checked = 0;
    for (const { type } of eventTypes(g)) {
      const f = eventFlow(g, type);
      const mine = new Set<string>(), want = new Set<string>();
      for (const grp of f.groups) for (const t of grp.targets) for (const r of t.rows as EventRow[]) {
        if (r.outcome === 'filtered') continue;
        for (const i of r.ingresses) mine.add([grp.producer, r.consumer, i.id, i.handler, r.outcome === 'possible'].join('|'));
      }
      for (const d of report.deliveries.filter((x) => x.event === type)) want.add([d.producer.service, d.consumer.service, d.consumer.ingress, d.handler, !!d.possible].join('|'));
      assert.deepEqual([...mine].sort(), [...want].sort(), type);
      const unhandled = f.groups.flatMap((p) => p.targets.flatMap((t) => t.rows)).filter((r) => r.outcome === 'no-handler').flatMap((r) => r.ingresses.map((i) => `${r.consumer}:${i.id}`));
      assert.deepEqual([...new Set(unhandled)].sort(), [...new Set(report.unhandled.filter((d) => d.event === type).map((d) => `${d.consumer.service}:${d.consumer.ingress}`))].sort(), type);
      checked += want.size;
    }
    assert.ok(checked > 5);
    const res = await app.call('GET', '/api/envs/prod/events/OrderPlaced');
    assert.ok(res.body.flow.groups.length && res.body.flow.summary.text);
    const refunded = (await app.call('GET', '/api/envs/prod/events/PaymentRefunded')).body.flow;
    assert.ok(refunded.groups.some((p: any) => p.possible));
  } finally { await app.close(); }
});
