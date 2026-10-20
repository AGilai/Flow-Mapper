// 0.15.0: a sub-flow is a full flow that starts at the consumer: caller lifeline, request from a delivery row, cache key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { callerFor, subRequest, requestKey, flowId } from '../web/js/views/flow-sub.js';
// @ts-ignore
import { asyncTree } from '../web/js/views/flow-async.js';
// @ts-ignore
import { buildLane } from '../web/js/views/flow-lane.js';

const g = buildIndex(sampleModel());

test('caller label: client for http, the queue for queue ingress, schedule for cron', () => {
  assert.deepEqual(callerFor({ kind: 'entry', transport: 'http', label: 'POST x' }), { id: 'client', label: 'client', sub: 'browser', kind: 'client' });
  const q = callerFor({ kind: 'entry', transport: 'sqs', label: 'sqs:erase-queue · Erase' });
  assert.deepEqual([q.label, q.sub, q.kind], ['erase-queue', 'sqs queue', 'source']);
  assert.equal(callerFor({ kind: 'entry', transport: 'amqp', label: 'amqp:jobs' }).sub, 'amqp queue');
  assert.equal(callerFor({ kind: 'entry', transport: 'cron', label: 'cron:nightly' }).label, 'schedule');
  assert.equal(callerFor({ kind: 'deliver', from: 'ch:sqs:q' }).label, 'sqs:q');
});

test('a sub-flow request starts at the consumer ingress with the delivered event; one cache key per consumer', () => {
  const t = trace(g, { service: 'api-gateway', ingress: 'in.createOrder' }, { scope: 'full', maxMessages: 800 })!;
  const row = asyncTree(t.messages).rows.find((r: any) => r.service === 'shipping-svc');
  const q = subRequest(row, { frontier: false });
  assert.deepEqual([q.service, q.ingress, q.scope, q.event], ['shipping-svc', row.ingress, 'full', row.event]);
  assert.notEqual(requestKey(q), requestKey(subRequest(row, { frontier: true })));
  assert.equal(requestKey(q), requestKey(subRequest({ ...row, label: '9' })), 'the row label is not part of it');
  assert.equal(flowId(q), flowId(subRequest(row, { frontier: true })));
  const sub = trace(g, { service: q.service, ingress: q.ingress, event: q.event ?? undefined }, { scope: 'full', maxMessages: 800 })!;
  const lane = buildLane(sub.messages, { participants: sub.participants });
  assert.equal(lane.columns[0].kind, 'source', 'the lane opens on the queue');
  assert.ok(!lane.columns.some((c: any) => /^sns:/.test(c.label)), 'never the topic');
});
