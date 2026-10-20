// Per-caller event types (#42): a call step's `bind` hands a value down, an egress step's `eventFrom` reads the nearest one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { flowCounts } from '../core/flow-counts.ts';
import { eventReport } from '../core/events.ts';
import { contractReport } from '../core/contract.ts';

const A = 'a.event', B = 'b.event';
const call = (seq: number, target: string, bind?: object) => ({ seq, type: 'call', target, ...(bind ? { bind } : {}) });
const src = { file: 'a.ts', line: 1 };

/** Entries in.a and in.b both reach `publish`, which sends to topic T; one queue and consumer per event type (A, B). */
function build(opts: { fns?: any[]; egress?: object } = {}) {
  const fns = opts.fns ?? [
    { id: 'onA', steps: [call(1, 'publish', { event: A })] }, { id: 'onB', steps: [call(1, 'publish', { event: B })] },
    { id: 'publish', steps: [{ seq: 1, type: 'egress', target: 'out', eventFrom: 'event' }] },
  ];
  const consumer = (id: string, q: string, ev: string) => ({ service: 'c', id, bindKey: q, transport: 'sqs', handler: `h${id}`, events: [{ type: ev, handler: `h${id}` }] });
  return buildIndex({
    env: 't', services: ['s', 'c'].map((name) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01' })) as any,
    functions: [...fns.map((f) => ({ service: 's', name: f.id, ...f })), ...['ha', 'hb'].map((id) => ({ service: 'c', id, name: id, steps: [] }))] as any,
    ingress: [
      ...['a', 'b', 'x'].map((i) => ({ service: 's', id: `in.${i}`, bindKey: `http:GET s/${i}`, transport: 'http', handler: i === 'x' ? 'publish' : `on${i.toUpperCase()}`, entryPoint: true })),
      consumer('a', 'sqs:qa', A), consumer('b', 'sqs:qb', B),
    ] as any,
    egress: [{ service: 's', id: 'out', bindKey: 'sns:T', transport: 'sns', mode: 'async', source: src, ...(opts.egress ?? {}) }] as any,
    resources: [],
    channels: ['sns:T', 'sqs:qa', 'sqs:qb'].map((bindKey) => ({ service: 's', bindKey, kind: bindKey.startsWith('sns') ? 'sns-topic' : 'sqs-queue', name: bindKey.slice(4) })) as any,
    bindings: [{ service: 's', id: 'sa', from: 'sns:T', to: 'sqs:qa', events: [A] }, { service: 's', id: 'sb', from: 'sns:T', to: 'sqs:qb', events: [B] }] as any,
  });
}
const run = (g: any, ingress: string) => trace(g, { service: 's', ingress }, { scope: 'full' })!;
const consumers = (t: any) => t.messages.filter((m: any) => m.target?.service === 'c' && m.kind === 'deliver').map((m: any) => m.target.fn).sort();

test('two callers bind different events into one shared publish: each trace reaches only its subscriber', () => {
  const g = build();
  for (const [ing, ev, fn, caller] of [['in.a', A, 'ha', 'onA'], ['in.b', B, 'hb', 'onB']]) {
    const t = run(g, ing);
    assert.deepEqual(consumers(t), [fn], ing);
    const pub = t.messages.find((m) => m.kind === 'egress' && m.egress === 'out')!;
    assert.equal(pub.event, ev);
    assert.match(pub.label, new RegExp(`· ${ev.replace('.', '\\.')}`));
    assert.deepEqual(pub.eventFrom, { name: 'event', boundAt: `${caller}:1` });
    assert.ok(!t.messages.some((m) => m.possible), 'a bound event is not a guess');
  }
});

test('no bind on the path: the #40 fallback (events and candidates of the egress, possible; none known stops at the topic)', () => {
  const x = run(build({ egress: { unresolved: [{ what: 'event', reason: 'param', candidates: [A] }] } }), 'in.x');
  assert.deepEqual(consumers(x), ['ha'], 'only the candidate matches');
  assert.ok(x.messages.filter((m) => m.kind === 'deliver').every((m) => m.possible));
  const pub = x.messages.find((m) => m.egress === 'out' && m.kind === 'egress')!;
  assert.deepEqual(pub.eventFrom, { name: 'event' }, 'named, but nothing bound it');
  assert.equal(pub.event, undefined);

  const none = run(build(), 'in.x');
  assert.deepEqual(consumers(none), []);
  assert.ok(none.messages.some((m) => m.gap?.reason === 'event_unknown'), 'stops at the topic');
  // a single known event on the egress is no longer a typed step once eventFrom is unbound: same set, so same delivery
  assert.deepEqual(consumers(run(build({ egress: { events: [B] } }), 'in.x')), ['hb']);
});

test('nested binds: the nearest one wins; a bind does not leak to a sibling path', () => {
  const g = build({ fns: [
    { id: 'onA', steps: [call(1, 'mid', { event: A })] },
    { id: 'mid', steps: [call(1, 'publish', { event: B })] },
    { id: 'onB', steps: [call(1, 'publish', { event: B })] },
    { id: 'publish', steps: [{ seq: 1, type: 'egress', target: 'out', eventFrom: 'event' }] },
  ] });
  const t = run(g, 'in.a');
  assert.deepEqual(consumers(t), ['hb']);
  assert.deepEqual(t.messages.find((m) => m.egress === 'out' && m.kind === 'egress')!.eventFrom, { name: 'event', boundAt: 'mid:1' });
  // A bind is visible below the call that made it only: after returning, a later step of the caller sees none.
  const g2 = build({ fns: [
    { id: 'onA', steps: [call(1, 'mid', { event: A }), call(2, 'publish')] },
    { id: 'mid', steps: [] },
    { id: 'onB', steps: [] },
    { id: 'publish', steps: [{ seq: 1, type: 'egress', target: 'out', eventFrom: 'event' }] },
  ] });
  assert.equal(run(g2, 'in.a').messages.find((m) => m.egress === 'out' && m.kind === 'egress')!.eventFrom!.boundAt, undefined);
});

test('flow counts: the union of every bound value, so a count can exceed the trace through one caller (never fall short of it)', () => {
  const g = build();
  const ids = (ingress: string) => run(g, ingress).participants.filter((p) => ['service', 'channel', 'resource'].includes(p.kind)).map((p) => p.id);
  const count = (ingress: string) => flowCounts(g).find((c) => c.ingress === ingress)!;
  // The trace through in.a: s, topic, qa, c = 4 components. Counts follow every bind of `event` (A and B): qb too = 5.
  assert.equal(ids('in.a').length, 4);
  assert.equal(ids('in.b').length, 4);
  assert.equal(count('in.a').total, 5);
  assert.equal(count('in.b').total, 5);
  assert.deepEqual([count('in.a').queues, count('in.b').queues], [2, 2]);
  assert.ok(ids('in.a').every((id) => !id.includes('qb')) && ids('in.b').every((id) => !id.includes('qa')));
  // Unbound entry (in.x calls publish directly): the trace falls back to the egress's own events and candidates (none: stops at the topic),
  // counts still add the values bound elsewhere. Same direction: counts are a superset.
  assert.equal(count('in.x').queues, 2);
  assert.equal(ids('in.x').filter((id) => id.startsWith('ch:sqs')).length, 0);
});

test('the event report counts bound events as published, and the contract flags an unbound name (info)', () => {
  const g = build();
  assert.deepEqual(eventReport(g).neverArrives, []);
  assert.deepEqual(eventReport(g).deliveries.map((d) => [d.event, d.consumer.ingress, d.possible]).sort(), [[A, 'a', undefined], [B, 'b', undefined]]);
  const m = { service: 's', functions: g.model.functions.filter((f) => f.service === 's') as any };
  assert.equal(contractReport(m, g).findings.filter((f) => f.code === 'eventfrom-unbound').length, 0);
  const lone = build({ fns: [{ id: 'onA', steps: [] }, { id: 'onB', steps: [] }, { id: 'publish', steps: [{ seq: 1, type: 'egress', target: 'out', eventFrom: 'event' }] }] });
  const f = contractReport({ service: 's', functions: lone.model.functions.filter((x) => x.service === 's') as any }, lone).findings.filter((x) => x.code === 'eventfrom-unbound');
  assert.deepEqual(f.map((x) => [x.level, x.id]), [['info', 'publish#1']]);
});
