// The compact hub views' pure helpers: edge markers, queue outcomes, order and fold, event consumers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { channelFlow } from '../core/channel-flow.ts';
import { eventFlow } from '../core/event-flow.ts';
import { consumerOutcomes, declarationOutcomes, eventHub, foldList, markerOf, matchesQuery, orderQueues, queueSummaries } from '../core/hub.ts';
import { sampleModel } from './helpers.ts';

const g = buildIndex(sampleModel());
const decl = (events: any) => ({ service: 's', id: 'x', events, at: null, verified: null });
const filter = (events: any, agree = true) => ({ events, agree, differs: agree ? null : 'filter', declarations: [decl(events), decl(events)] }) as any;

test('markers: none for all events, N types, all but N, disagree', () => {
  assert.equal(markerOf(null), null);
  assert.equal(markerOf(filter('*')), null);
  assert.deepEqual(markerOf(filter(['A', 'B'])), { kind: 'types', n: 2, label: '2 types' });
  assert.equal(markerOf(filter(['A']))!.label, '1 type');
  assert.deepEqual(markerOf(filter(['!A', '!B', '!C'])), { kind: 'all-but', n: 3, label: 'all but 3' });
  assert.equal(markerOf(filter('*', false))!.kind, 'disagree');
});

test('order puts problem queues first then by name; the fold keeps problems and the first 12', () => {
  const qs = ['m', 'c', 'z', 'a'].map((name, i) => ({ queue: { name }, problem: i === 2 }));
  assert.deepEqual(orderQueues(qs).map((q) => q.queue.name), ['z', 'a', 'c', 'm']);
  const many = Array.from({ length: 20 }, (_, i) => ({ queue: { name: `q${String(i).padStart(2, '0')}` }, problem: i === 18 }));
  const o = orderQueues(many);
  const f = foldList(o, 12);
  assert.equal(f.shown.length, 12);
  assert.equal(f.shown[0].queue.name, 'q18');
  assert.equal(f.hidden.length, 8);
  assert.equal(foldList(o.slice(0, 13), 12).hidden.length, 1);
  assert.equal(foldList(o.slice(0, 12), 12).hidden.length, 0);
  const allBad = foldList(many.map((q) => ({ ...q, problem: true })), 12);
  assert.equal(allBad.hidden.length, 0);
});

test('the filter box matches every word in the queue or service name', () => {
  assert.ok(matchesQuery('crm sync', 'crm-sync-events', 'crm-sync'));
  assert.ok(!matchesQuery('billing', 'crm-sync-events', 'crm-sync'));
  assert.ok(matchesQuery('', 'x'));
});

test("topic page: a disagreeing queue is a problem; a queue whose consumer lacks a handler is one too", () => {
  const flow = channelFlow(g, "sns:order-events");
  const qs = queueSummaries(flow);
  const ship = qs.find((q) => q.queue.name === "shipping-order-events")!;
  assert.ok(ship.disagree && ship.problem && ship.marker!.kind === "disagree");
  assert.deepEqual(ship.noHandler, ["OrderCancelled"]);
  assert.ok(!qs.find((q) => q.queue.name === "analytics-all-events")!.problem);
  const prod = channelFlow(g, "sns:production-event-bus-sns");
  const tn = queueSummaries(prod).find((q) => q.queue.name === "tenant-notifications")!;
  assert.equal(tn.noHandler.length, 3);
  assert.deepEqual(tn.marker, { kind: "all-but", n: 1, label: "all but 1" });
  for (const q of queueSummaries(prod)) assert.equal(q.handled.length + q.noHandler.length + q.filtered.length, prod.grid.rows.filter((r) => !r.possible).length, q.queue.name);
});

test("the pane splits the topic's event types per declaration", () => {
  const flow = channelFlow(g, "sns:order-events");
  const row = flow.rows.find((r) => r.to.name === "shipping-order-events")!;
  const outs = declarationOutcomes(flow, row);
  assert.equal(outs.length, 2);
  const all = outs.find((o) => o.events === "*")!, narrow = outs.find((o) => o.events !== "*")!;
  assert.deepEqual([all.noHandler, narrow.noHandler, narrow.filtered], [["OrderCancelled"], [], ["OrderCancelled"]]);
  for (const o of outs) assert.equal(o.handled.length + o.noHandler.length + o.filtered.length, flow.grid.rows.filter((r) => !r.possible).length);
});

test('queue page: outcome per consumer, possible types counted apart', () => {
  const flow = channelFlow(g, 'sqs:analytics-all-events');
  const [o] = consumerOutcomes(flow);
  assert.equal(o.consumer!.service, 'analytics-svc');
  assert.ok(o.handled > 0 && o.possible > 0 && o.noHandler === 0);
});

test('event page: one consumer per service, no-handler first, possible last', () => {
  const hub = eventHub(eventFlow(g, 'account.tenant.terminated.priority10'));
  assert.ok(hub.producers.some((p) => p.possible) && hub.producers.some((p) => !p.possible));
  assert.equal(hub.consumers[0].service, 'crm-sync');
  assert.equal(hub.consumers[0].outcome, 'no-handler');
  assert.equal(new Set(hub.consumers.map((c) => c.service)).size, hub.consumers.length);
  const outcomes = hub.consumers.map((c) => c.outcome);
  assert.deepEqual(outcomes, [...outcomes].sort((a, b) => ['no-handler', 'handled', 'possible'].indexOf(a) - ['no-handler', 'handled', 'possible'].indexOf(b)));
  assert.ok(hub.consumers.filter((c) => c.outcome === 'possible').every((c) => c.ifSent && c.maybe.length));
});
