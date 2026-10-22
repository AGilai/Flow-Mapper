// #73: the tags that tie an async callee's work to the call that started it (`n` on the call, `of` on the work), and the views
// that read them: the caller's steps after an async publish come before the consumer's work, and the publish region still holds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { scanLane, subflowRanges } from '../web/js/views/flow-scan.js';
import { buildLane } from '../web/js/views/flow-lane.js';
import { asyncTree } from '../web/js/views/flow-async.js';

const src = { file: 'a.ts', line: 1 };
const svc = (name: string) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01' });

/** rotate: 1 publish (async, topic T -> queue q -> consumer `onEvent` in c, which calls store-less service d), 2 call cleanup, 3 sync call to e. */
function model(directAsync = false): any {
  return {
    env: 't', services: ['s', 'c', 'd', 'e'].map(svc),
    functions: [
      { service: 's', id: 'rotate', name: 'rotate', steps: [
        directAsync ? { seq: 1, type: 'egress', target: 'toC', mode: 'async' } : { seq: 1, type: 'egress', target: 'out', mode: 'async' },
        { seq: 2, type: 'call', target: 'cleanup' }, { seq: 3, type: 'egress', target: 'toE', mode: 'sync' }] },
      { service: 's', id: 'cleanup', name: 'cleanup', steps: [] },
      { service: 'c', id: 'onEvent', name: 'onEvent', steps: [{ seq: 1, type: 'egress', target: 'toD', mode: 'sync' }] },
      { service: 'd', id: 'handle', name: 'handle', steps: [] }, { service: 'e', id: 'handle', name: 'handle', steps: [] },
    ],
    ingress: [
      { service: 's', id: 'in.rotate', bindKey: 'http:POST s/rotate', transport: 'http', handler: 'rotate', entryPoint: true },
      { service: 'c', id: 'in.q', bindKey: directAsync ? 'http:POST c/event' : 'sqs:q', transport: directAsync ? 'http' : 'sqs', handler: 'onEvent' },
      { service: 'd', id: 'in.d', bindKey: 'http:POST d/x', transport: 'http', handler: 'handle' }, { service: 'e', id: 'in.e', bindKey: 'http:POST e/x', transport: 'http', handler: 'handle' },
    ],
    egress: [
      { service: 's', id: 'out', bindKey: 'sns:T', transport: 'sns', mode: 'async', source: src }, { service: 's', id: 'toC', bindKey: 'http:POST c/event', transport: 'http', mode: 'async', source: src },
      { service: 's', id: 'toE', bindKey: 'http:POST e/x', transport: 'http', mode: 'sync', source: src }, { service: 'c', id: 'toD', bindKey: 'http:POST d/x', transport: 'http', mode: 'sync', source: src },
    ],
    resources: [],
    channels: [{ service: 's', bindKey: 'sns:T', kind: 'sns-topic', name: 'T' }, { service: 's', bindKey: 'sqs:q', kind: 'sqs-queue', name: 'q' }],
    bindings: [{ service: 's', id: 'b', from: 'sns:T', to: 'sqs:q' }],
  };
}
const run = (directAsync = false) => trace(buildIndex(model(directAsync)), { service: 's', ingress: 'in.rotate' }, { scope: 'full' })!;
const at = (t: any, text: string) => t.messages.findIndex((m: any) => m.label.includes(text) || m.to.includes(text));

test('tags: the consumer\'s work carries `of` = its delivery\'s `n`; the caller\'s own steps carry none', () => {
  const t = run();
  const d = t.messages.findIndex((m: any) => m.kind === 'deliver');
  assert.equal(t.messages[d].n, d + 1);
  const work = t.messages.filter((m: any) => m.of === t.messages[d].n);
  assert.ok(work.length >= 1, 'the consumer calls d');
  assert.ok(t.messages.slice(0, d).every((m: any) => m.of === undefined));
  assert.equal(t.messages.filter((m: any) => m.to === 'svc:e').every((m: any) => m.of === undefined), true, 'the caller\'s later call has no tag');
});

test('reporter pattern: a caller step after an async publish sits before the consumer\'s work, and the region still holds', () => {
  const t = run();
  const o = t.messages, e = o.findIndex((m: any) => m.to === 'svc:e'), dlv = o.findIndex((m: any) => m.kind === 'deliver'), toD = o.findIndex((m: any) => m.to === 'svc:d');
  assert.ok(e >= 0 && dlv >= 0 && toD >= 0);
  assert.ok(dlv < e && e < toD, 'publish + delivery, then the caller\'s step, then the consumer\'s work');
  const { lane, publishes } = scanLane(o);
  assert.equal(publishes.length, 1);
  const p = publishes[0];
  assert.ok(p.members.includes(toD) && !lane.includes(toD), 'the consumer\'s work is in the region, not the lane');
  assert.ok(lane.includes(e), 'the caller\'s step stays in the lane');
  assert.ok(p.members.slice(1).every((j: number) => !lane.includes(j)));
  const r = subflowRanges(o, p).get(p.delivers[0]);
  assert.deepEqual(r, { start: toD, end: toD });
  const tree = asyncTree(o);
  assert.equal(tree.rows.length, 1);
  assert.equal(tree.rows[0].msgs.length, 2, 'the card draws the delivery and what the consumer does');
  const lanes = buildLane(o, { participants: t.participants });
  assert.ok(lanes.events.some((ev: any) => ev.type === 'call' && ev.to.service === 'e'), 'the caller\'s later call is drawn in the lane');
  assert.ok(!lanes.events.some((ev: any) => ev.type === 'call' && ev.to.service === 'd'), 'the consumer\'s call is not');
});

test('a direct async call: the callee\'s work keeps its own bar although the caller\'s step came between', () => {
  const t = run(true);
  const o = t.messages, e = o.findIndex((m: any) => m.to === 'svc:e'), c = o.findIndex((m: any) => m.to === 'svc:c'), toD = o.findIndex((m: any) => m.to === 'svc:d');
  assert.ok(c < e && e < toD, o.map((m: any) => m.label).join(' | '));
  assert.equal(o[toD].of, o[c].n);
  const lane = buildLane(o, { participants: t.participants });
  const bar = (name: string) => lane.bars.find((b: any) => b.service === name);
  assert.equal(bar('d').parent.service, 'c', 'd was called by c, not by the caller\'s later bar (e)');
  assert.ok(bar('d').start > bar('e').end, 'after e: it ran later');
});
