// 0.11.0: the Flows lane. One activation bar per call, internal calls folded into a pill, publishes end at the rail,
// async work is not in the lane. Layout rules live in web/js/views/flow-scan.js and flow-lane.js (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { scanLane, subflowRanges, asyncFlowOf } from '../web/js/views/flow-scan.js';
// @ts-ignore
import { buildLane, crossings, callLabel } from '../web/js/views/flow-lane.js';

const g = buildIndex(sampleModel());
const run = (service: string, ingress: string, scope: 'full' | 'intra' = 'full') => trace(g, { service, ingress }, { scope, maxMessages: 800 })!;
const laneOf = (t: any) => buildLane(t.messages, { scope: t.scope, participants: t.participants });
const create = () => run('api-gateway', 'in.createOrder');

test('asyncFlowOf: only deliveries that reach a handled consumer ingress', () => {
  assert.deepEqual(asyncFlowOf({ kind: 'deliver', target: { service: 'a', ingress: 'in.x' } }), { service: 'a', ingress: 'in.x' });
  assert.equal(asyncFlowOf({ kind: 'egress', target: { service: 'a', ingress: 'in.x' } }), null);
  assert.equal(asyncFlowOf({ kind: 'deliver', broken: true, unhandled: true, target: { service: 'a', ingress: 'in.x' } }), null);
  assert.equal(asyncFlowOf({ kind: 'deliver' }), null);
});

test('scanLane: a publish owns the hops out of its channel and everything deeper; the lane continues after it', () => {
  const t = create();
  const { lane, publishes } = scanLane(t.messages);
  const asyncIdx = new Set(publishes.flatMap((p: any) => Array.from({ length: p.end - p.i }, (_, k) => p.i + 1 + k)));
  assert.ok(publishes.length >= 3);
  for (const i of lane) assert.ok(!asyncIdx.has(i), `message ${i + 1} is in the lane and in a region`);
  assert.equal(lane.length + asyncIdx.size, t.messages.length);
  const fan = publishes.find((p: any) => t.messages[p.i].deliveries);
  assert.equal(fan.delivers.length, t.messages[fan.i].deliveries);
  // the lane messages after the fan-out are the sync ones again (orders-svc continues)
  assert.ok(lane.some((i: number) => i > fan.end));
});

test('subflowRanges: each delivery of a fan-out gets its own consumer subtree', () => {
  const t = create();
  const { publishes } = scanLane(t.messages);
  const fan = publishes.find((p: any) => t.messages[p.i].deliveries);
  const ranges = subflowRanges(t.messages, fan);
  const seen = new Set<number>();
  for (const [d, r] of ranges) {
    if (r.start > r.end) continue;
    const consumer = t.messages[d].to;
    for (let k = r.start; k <= r.end; k++) {
      assert.ok(!seen.has(k), 'ranges do not overlap');
      seen.add(k);
    }
    assert.equal(t.messages[r.start].from, consumer, 'a subtree starts in its own consumer');
  }
  assert.ok(seen.size >= 3);
});

test('one bar per call; a service called twice gets two bars; bar colour is the entering transport', () => {
  const t = create();
  const lane = laneOf(t);
  const entries = t.messages.filter((m: any) => m.kind === 'entry' || (m.kind === 'egress' && m.to.startsWith('svc:') && !m.broken));
  const inLane = new Set(scanLane(t.messages).lane);
  const expected = entries.filter((m: any) => inLane.has(t.messages.indexOf(m)));
  assert.equal(lane.bars.length, expected.length);
  assert.deepEqual(lane.bars.map((b: any) => b.service).slice(0, 2), ['api-gateway', 'orders-svc']);
  assert.ok(lane.bars.every((b: any) => b.transport === b.msg.transport));
  assert.ok(lane.bars.every((b: any) => b.end >= b.start));
  // a sync bar is closed by a return arrow to its caller; a delivery-entered bar is not
  const rets = lane.events.filter((e: any) => e.type === 'return');
  assert.equal(rets.length, lane.bars.filter((b: any) => b.sync).length);
  // bars nest: a callee's bar lies inside its caller's span
  for (const b of lane.bars) if (b.parent) assert.ok(b.start > b.parent.start && b.end <= b.parent.end, `${b.service} inside ${b.parent.service}`);
});

test('internal calls are folded into a pill per bar, with unresolved ones counted', () => {
  const t = create();
  const lane = laneOf(t);
  const orders = lane.bars.find((b: any) => b.service === 'orders-svc');
  const calls = t.messages.filter((m: any) => m.kind === 'call' && m.service === 'orders-svc' && !m.gap && m.depth >= 2 && m.depth <= 3);
  assert.ok(orders.internal.n >= 2 && orders.internal.n >= calls.length);
  const pills = lane.events.filter((e: any) => e.type === 'pill');
  assert.equal(pills.length, lane.bars.filter((b: any) => b.internal.n).length);
  assert.ok(!lane.events.some((e: any) => e.msg?.kind === 'call'), 'no call step is drawn as an arrow');
  // a call the harvester could not resolve inside a service tints the pill
  const sh = laneOf(trace(g, { service: 'api-gateway', ingress: 'in.createOrder' }, { scope: 'full', maxMessages: 800 })!);
  assert.ok(sh.bars.every((b: any) => b.internal.gaps <= b.internal.n));
});

test('publishes end at the rail with their consumer count; async work is not drawn in the lane', () => {
  const t = create();
  const lane = laneOf(t);
  const pubs = lane.events.filter((e: any) => e.type === 'publish');
  assert.deepEqual(pubs.map((e: any) => [e.topic, e.flows]), [['sns:payment-disputes', 0], ['sns:payment-events', 1], ['sns:order-events', 3]]);
  assert.equal(lane.columns[lane.columns.length - 1].kind, 'rail');
  assert.ok(!lane.columns.some((c: any) => c.id.startsWith('ch:')), 'no queue or topic lifelines');
  assert.ok(!lane.events.some((e: any) => e.msg?.kind === 'deliver'));
  assert.ok(!lane.columns.some((c: any) => ['shipping-svc', 'analytics-svc', 'notifications-svc'].includes(c.label)), 'consumers only appear in the async index');
});

test('unresolved calls: red arrow to the unresolved column, no bar, no return', () => {
  const t = create();
  const lane = laneOf(t);
  const un = lane.events.filter((e: any) => e.type === 'unresolved');
  assert.ok(un.length >= 2);
  assert.equal(lane.columns[lane.columns.length - 2].kind, 'unresolved');
  assert.ok(un.every((e: any) => e.col.kind === 'unresolved'));
  assert.ok(lane.bars.every((b: any) => !un.some((e: any) => e.msg === b.msg)));
});

test('stores are stubs on the bar and go away with "Data stores" off', () => {
  const t = create();
  const on = laneOf(t), off = buildLane(t.messages, { stores: false, scope: t.scope, participants: t.participants });
  const stubs = on.events.filter((e: any) => e.type === 'store');
  assert.ok(stubs.length >= 4 && stubs.every((e: any) => e.verb && e.name));
  assert.equal(off.events.filter((e: any) => e.type === 'store').length, 0);
  assert.equal(off.bars.length, on.bars.length);
});

test('no arrow crosses an unrelated bar, in any sample flow', () => {
  let flows = 0;
  for (const i of g.model.ingress) {
    const t = trace(g, { service: i.service, ingress: i.id }, { scope: 'full', maxMessages: 800 })!;
    const lane = laneOf(t);
    flows++;
    assert.deepEqual(crossings(lane).map((c: any) => `${c.event.type}@${c.event.row} over ${c.bar.service}`), [], `${i.service}/${i.id}`);
    for (const e of lane.events) assert.equal(e.row, lane.events.indexOf(e));
  }
  assert.ok(flows > 20);
});

test('"Inside the service": one root bar, callees are plain lifelines without bars, the publish keeps one leg', () => {
  const t = run('api-gateway', 'in.createOrder', 'intra');
  const lane = laneOf(t);
  assert.equal(lane.bars.length, 1);
  assert.ok(lane.columns.some((c: any) => c.kind === 'plain'));
  const outs = lane.events.filter((e: any) => e.type === 'call' && !e.bar);
  assert.ok(outs.length >= 1);
  const full = laneOf(create());
  assert.ok(lane.bars.length < full.bars.length);
});

test('a frontier marker is a stub on the bar, and a delivery starts an async flow lane from its queue', () => {
  const t = run('orders-svc', 'in.remove');
  assert.ok(laneOf(t).events.some((e: any) => e.type === 'frontier'));
  const c = create();
  const { publishes } = scanLane(c.messages);
  const p = publishes.find((x: any) => c.messages[x.i].event === 'OrderPlaced' || c.messages[x.i].deliveries);
  const d = p.delivers.find((i: number) => c.messages[i].target?.service === 'shipping-svc');
  const r = subflowRanges(c.messages, p).get(d);
  const flow = buildLane([c.messages[d], ...c.messages.slice(r.start, r.end + 1)], { scope: 'full', participants: c.participants });
  assert.equal(flow.columns[0].kind, 'source');
  assert.equal(flow.bars[0].service, 'shipping-svc');
  assert.equal(flow.bars[0].sync, false);
  assert.ok(flow.events.some((e: any) => e.type === 'publish'), 'the consumer publishes onward');
});

test('labels: http calls show verb and path; deliveries show event and handler', () => {
  assert.equal(callLabel({ transport: 'http', label: 'http:POST orders-svc/orders' }), 'POST /orders');
  assert.equal(callLabel({ transport: 'http', label: 'http:POST public/api/orders' }), 'POST /api/orders');
  assert.equal(callLabel({ kind: 'deliver', event: 'OrderPlaced', target: { fn: 'onOrderPlaced' }, label: 'x' }), 'OrderPlaced → onOrderPlaced');
});

// @ts-ignore
import { columnGaps, centres, wrapId, arrowEnds, labelWidth } from '../web/js/views/flow-cols.js';

test('columnGaps: a gap grows to fit the label that crosses it, never shrinks below the base', () => {
  assert.deepEqual(columnGaps(3, [], 138), [138, 138]);
  assert.deepEqual(columnGaps(3, [{ a: 0, b: 1, need: 200 }], 138), [200, 138]);
  assert.deepEqual(columnGaps(3, [{ a: 1, b: 0, need: 100 }], 138), [138, 138]);
  // a span over two gaps shares the deficit; shorter spans are met first
  assert.deepEqual(columnGaps(3, [{ a: 0, b: 2, need: 400 }, { a: 0, b: 1, need: 180 }], 138), [221, 179]);
  assert.deepEqual(centres(10, [100, 50]), [10, 110, 160]);
});

test('wrapId: wraps after separators, never cuts text', () => {
  assert.deepEqual(wrapId('sqs:analytics-all-events', 15), ['sqs:analytics-', 'all-events']);
  assert.deepEqual(wrapId('short', 15), ['short']);
  assert.equal(wrapId('averyveryverylongunbrokenname', 10).join(''), 'averyveryverylongunbrokenname');
});

test('lane arrows: every labelled arrow has two ends, and the label width is the natural text width', () => {
  const l = laneOf(create());
  const labelled = l.events.filter((e: any) => e.label && arrowEnds(e));
  assert.ok(labelled.length > 3);
  for (const e of labelled) { const [a, b] = arrowEnds(e); assert.ok(l.columns.includes(a) && l.columns.includes(b)); }
  assert.equal(labelWidth('GET /api/users/{id}'), Math.ceil(19 * 7.2));
});
