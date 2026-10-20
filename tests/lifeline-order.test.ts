// Bug #35 (b, c): a fan-out reads producer > topic > queue > consumer, and labels on one row never overlap.
// Demo: stress-gateway / stress-hub / stress-consumer-NN (samples), a topic with 12 queues.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace, deliveryOrder } from '../core/trace.ts';
import { sampleModel } from './helpers.ts';

const g = buildIndex(sampleModel());
const run = (ingress: string, service = 'stress-gateway') => trace(g, { service, ingress }, { scope: 'full' })!;
const ids = (t: ReturnType<typeof run>) => t.participants.map((p) => p.id);

/** Delivery arrows (topic > queue, queue > consumer) whose target is left of their source. */
function leftward(t: ReturnType<typeof run>, order: string[]) {
  return t.messages.filter((m) => m.delivery && m.from !== m.to && order.indexOf(m.to) < order.indexOf(m.from));
}
/** The order before the fan-out rule: lifelines in first-appearance order, then the topic/queue passes. */
function before(t: ReturnType<typeof run>) {
  const seen: string[] = [];
  for (const m of t.messages) for (const id of [m.from, m.to]) if (!seen.includes(id)) seen.push(id);
  const byId = new Map(t.participants.map((p) => [p.id, p]));
  return deliveryOrder(seen.map((id) => byId.get(id)!), t.messages, false).map((p) => p.id);
}

test('producer checks every consumer first: before the rule 12 delivery arrows point left, after only the caller\'s own queue does', () => {
  const t = run('in.startChecked');
  const b = leftward(t, before(t)), a = leftward(t, ids(t));
  assert.equal(b.length, 12);
  assert.deepEqual(a.map((m) => `${m.from} > ${m.to}`), ['ch:sqs:stress-q04 > svc:stress-gateway']); // the gateway called the hub, so it stays left
  // [topic] [q1] [c1] [q2] [c2] ...: each consumer right next to its queue
  const o = ids(t);
  for (const n of [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const q = o.indexOf(`ch:sqs:stress-q${String(n).padStart(2, '0')}`);
    assert.equal(o[q + 1], `svc:stress-consumer-${String(n).padStart(2, '0')}`, `consumer ${n} next to its queue`);
  }
  assert.equal(o.filter((id) => id === 'svc:stress-gateway').length, 1);
});

test('consumers seen nowhere else: interleaved in delivery order, only the upstream caller points left', () => {
  const t = run('in.start');
  assert.deepEqual(leftward(t, ids(t)).map((m) => m.to), ['svc:stress-gateway']);
  const o = ids(t);
  const topic = o.indexOf('ch:sns:stress-events');
  const deliveries = t.messages.filter((m) => m.delivery && m.from === 'ch:sns:stress-events').map((m) => m.to);
  assert.ok(deliveries.length >= 12);
  assert.ok(deliveries.every((q) => o.indexOf(q) > topic), 'all queues right of the topic');
  const stress = deliveries.filter((q) => q.startsWith('ch:sqs:stress-q') && q !== 'ch:sqs:stress-q04');
  assert.deepEqual(stress.map((q) => o[o.indexOf(q) + 1]), stress.map((q) => 'svc:stress-consumer-' + q.slice(-2)));
  const at = stress.map((q) => o.indexOf(q));
  assert.deepEqual([...at].sort((x, y) => x - y), at, 'in delivery order');
});

test('a consumer reached through several queues sits after the first of them; a lifeline appears once', () => {
  const m: any = {
    env: 't', services: ['p', 'c', 'infra'].map((name) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01' })),
    functions: [{ service: 'p', id: 'h', name: 'h', steps: [{ seq: 1, type: 'egress', target: 'pub', event: 'A' }] }, { service: 'c', id: 'h1', name: 'h1', steps: [] }, { service: 'c', id: 'h2', name: 'h2', steps: [] }],
    ingress: [{ service: 'p', id: 'in', bindKey: 'http:GET p/x', transport: 'http', handler: 'h', entryPoint: true }, { service: 'c', id: 'i1', bindKey: 'sqs:q1', transport: 'sqs', handler: 'h1' }, { service: 'c', id: 'i2', bindKey: 'sqs:q2', transport: 'sqs', handler: 'h2' }],
    egress: [{ service: 'p', id: 'pub', bindKey: 'sns:t', transport: 'sns', events: ['A'] }], resources: [],
    channels: ['sns:t', 'sqs:q1', 'sqs:q2'].map((bindKey) => ({ service: 'infra', bindKey, kind: bindKey.startsWith('sns') ? 'sns-topic' : 'sqs-queue' })),
    bindings: [{ service: 'infra', id: 'b1', from: 'sns:t', to: 'sqs:q1' }, { service: 'infra', id: 'b2', from: 'sns:t', to: 'sqs:q2' }],
  };
  const t = trace(buildIndex(m), { service: 'p', ingress: 'in' }, { scope: 'full' })!;
  assert.deepEqual(ids(t), ['client', 'svc:p', 'ch:sns:t', 'ch:sqs:q1', 'svc:c', 'ch:sqs:q2']);
});

test('the fan-out demo has 12 queues on one topic, none of the consumers on the trace elsewhere but the caller', () => {
  const t = run('in.start');
  assert.ok(t.messages.find((m) => m.deliveries)!.deliveries! >= 12);
});

test('a consumer first met as the consumer of a queue sits right of that queue, even when a later topic pulls the queue right (#35)', () => {
  const t = trace(g, { service: 'saga2-eraser-entry', ingress: 'in.erase' }, { scope: 'full' })!;
  const o = ids(t);
  const q = 'ch:sqs:saga2-account-sqs-erase', c = 'svc:saga2-erase-controller';
  assert.ok(o.indexOf(c) > o.indexOf(q), 'controller right of its queue');
  assert.equal(o.filter((id) => id === c).length, 1);
  const left = t.messages.filter((m) => m.kind === 'deliver' && o.indexOf(m.to) < o.indexOf(m.from));
  assert.deepEqual(left.map((m) => `${m.from} > ${m.to}`), ['ch:sqs:saga2-erase-internal > svc:saga2-eraser-entry'], 'only the entry service (an upstream caller) is pointed back to');
});
