// 0.11.0: the async index under a diagram: rows per consumer flow, "seen" rows, suspect rows, nested groups and the
// messages that belong to each row's own flow (flow-async.js, pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { asyncTree, indexStats, groupOf, summaryOf } from '../web/js/views/flow-async.js';
// @ts-ignore
import { buildLane } from '../web/js/views/flow-lane.js';

const g = buildIndex(sampleModel());
const run = (service: string, ingress: string) => trace(g, { service, ingress }, { scope: 'full', maxMessages: 800 })!;

test('rows: one per consumer flow, grouped by publish, numbered in order; a repeat of the same consumer is a "seen" row', () => {
  const t = run('api-gateway', 'in.createOrder');
  const tree = asyncTree(t.messages);
  assert.equal(tree.groups.length, 3, 'the publish nobody consumes is a group without rows');
  assert.equal(tree.groups[0].rows.length, 0);
  assert.deepEqual(tree.groups.map((x: any) => x.topic), ['sns:payment-disputes', 'sns:payment-events', 'sns:order-events']);
  assert.deepEqual(tree.groups.flatMap((x: any) => x.rows.map((r: any) => r.label)), ['1', '2', '3', '4']);
  const [r1, r2, r3, r4] = tree.groups.flatMap((x: any) => x.rows);
  assert.equal(r1.service, 'analytics-svc');
  assert.equal(r2.seenIn, '1', 'analytics ingest_event again via another publish');
  assert.equal(r2.range, null, 'a seen row has no flow of its own');
  assert.equal(r3.service, 'shipping-svc');
  assert.equal(r4.service, 'inventory-svc');
  const s = indexStats(tree);
  assert.equal(s.deliveries, 5);
  assert.equal(s.distinct, 4, '1, 3, 4 and the nested 3.1');
});

test('a row owns the consumer\'s own messages, and the flows it starts are nested groups labelled 3.1', () => {
  const t = run('api-gateway', 'in.createOrder');
  const tree = asyncTree(t.messages);
  const ship = tree.rows.find((r: any) => r.service === 'shipping-svc');
  assert.equal(ship.msgs[0].kind, 'deliver');
  assert.ok(ship.msgs.slice(1).every((m: any) => m.depth > ship.msgs[0].depth));
  assert.ok(ship.msgs.slice(1).some((m: any) => m.service === 'shipping-svc'));
  assert.ok(!ship.msgs.some((m: any) => m.service === 'inventory-svc'), 'another consumer\'s work is not in it');
  assert.equal(ship.groups.length, 1);
  assert.equal(ship.groups[0].rows[0].label, '3.1');
  assert.equal(ship.groups[0].rows[0].service, 'notifications-svc');
  assert.match(ship.summary, /calls? · \d+ stores? · publishes amqp/);
  // the row's own lane draws a bar for the consumer
  const lane = buildLane(ship.msgs, { participants: t.participants });
  assert.equal(lane.bars[0].service, 'shipping-svc');
  // every delivery of the trace is a row once, nested or not
  assert.equal(tree.rows.length, t.messages.filter((m: any) => m.kind === 'deliver' && !m.gap).length);
});

test('alt branches: each publish of an alt group is its own group with its branch and condition', () => {
  const t = run('account-lambda-erase-controller', 'in.advanceErase');
  const tree = asyncTree(t.messages);
  assert.equal(tree.groups.length, 4);
  assert.deepEqual(tree.groups.map((x: any) => x.branch.n), [1, 2, 3, 4]);
  assert.equal(tree.groups[0].branch.condition, 'nextPriority == 10');
  assert.equal(tree.groups[0].rows.length, 8);
  assert.ok(tree.groups.slice(1).every((x: any) => x.rows.some((r: any) => r.seenIn)), 'later branches point back to earlier rows');
  const crm = tree.groups[0].rows.find((r: any) => r.service === 'crm-sync');
  assert.ok(crm.noHandler && crm.range === null);
  assert.equal(groupOf(tree, tree.groups[2].pub), tree.groups[2]);
});

test('the same consumer and handler twice by one publish is a suspect row, not a seen one', () => {
  const pub = { kind: 'egress', from: 'svc:p', to: 'ch:sns:t', depth: 1, transport: 'sns', event: 'E', label: 'publish sns:t · E', mode: 'async', deliveries: 2, group: 'm1' };
  const hop = (q: string) => ({ kind: 'egress', from: 'ch:sns:t', to: `ch:sqs:${q}`, depth: 1, transport: 'sns', label: 'x' });
  const del = (q: string) => ({ kind: 'deliver', from: `ch:sqs:${q}`, to: 'svc:c', depth: 1, transport: 'sqs', label: `sqs:${q} → h`, target: { service: 'c', ingress: 'in.h', fn: 'h' } });
  const msgs = [{ kind: 'entry', from: 'client', to: 'svc:p', depth: 0, label: 'x' }, pub, hop('q1'), del('q1'), hop('q2'), del('q2')];
  const tree = asyncTree(msgs);
  const [a, b] = tree.groups[0].rows;
  assert.equal(a.suspect, false);
  assert.equal(b.suspect, true);
  assert.equal(b.seenIn, null);
});

test('summary: calls, distinct stores, what it publishes', () => {
  const m = (kind: string, extra = {}) => ({ kind, depth: 1, from: 'svc:a', to: 'svc:a', label: 'x', ...extra });
  assert.equal(summaryOf([m('call'), m('call'), m('resource', { store: 'pg:a' }), m('resource', { store: 'pg:a' })]), '2 calls · 1 store');
  assert.equal(summaryOf([m('egress', { to: 'ch:amqp:q', transport: 'amqp' })]), '0 calls · publishes amqp');
});
