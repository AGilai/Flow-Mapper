// 0.17.0: a publish is drawn as a routing chain that ends at the queue (flow-chain.js, flow-lane.js). Pure helpers, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { scanLane } from '../web/js/views/flow-scan.js';
// @ts-ignore
import { chainOf, planChains, foldFanout, filterMarker, badgesAt, rangeLabel, hopLabel } from '../web/js/views/flow-chain.js';
// @ts-ignore
import { buildLane, crossings } from '../web/js/views/flow-lane.js';
// @ts-ignore
import { asyncTree, deliveryNumbers } from '../web/js/views/flow-async.js';
// @ts-ignore
import { subRequest } from '../web/js/views/flow-sub.js';

const model = sampleModel();
const g = buildIndex(model);
const run = (service: string, ingress: string, gx = g) => trace(gx, { service, ingress }, { scope: 'full', maxMessages: 800 })!;
const tiles = (e: any) => e.end?.tiles.map((t: any) => t.text) ?? [];

test('chainOf: a publish becomes service -> topic -> queue legs; deliveries hang on the queue they start at', () => {
  const t = run('api-gateway', 'in.createOrder');
  const { publishes } = scanLane(t.messages);
  const order = publishes.map((p: any) => chainOf(t.messages, p)).find((c: any) => c.root === 'sns:order-events');
  assert.deepEqual(order.legs.map((l: any) => [l.from, l.to]), [[null, 'sns:order-events'], ['sns:order-events', 'sqs:analytics-all-events'], ['sns:order-events', 'sqs:shipping-order-events'], ['sns:order-events', 'sqs:inventory-order-events']]);
  assert.ok(order.legs[0].first && order.legs.slice(1).every((l: any) => !l.first));
  assert.deepEqual(order.legs.map((l: any) => l.delivers.length), [0, 1, 1, 1]);
  assert.ok(order.legs.flatMap((l: any) => l.delivers).every((d: any) => d.kind === 'deliver' && d.from === `ch:${order.legs.find((x: any) => x.delivers.includes(d)).to}`));
  // a topic nobody subscribes to is a chain of one leg
  const none = publishes.map((p: any) => chainOf(t.messages, p)).find((c: any) => c.root === 'sns:payment-disputes');
  assert.equal(none.legs.length, 1);
});

test('stops at the queue: the producer lane holds no delivery, no consumer lifeline and nothing below a delivery', () => {
  for (const [s, i] of [['api-gateway', 'in.createOrder'], ['account-lambda-erase-controller', 'in.advanceErase'], ['saga-controller', 'in.start']]) {
    const t = run(s, i);
    const lane = buildLane(t.messages, { participants: t.participants });
    assert.ok(!lane.events.some((e: any) => e.msg?.kind === 'deliver'), `${s}: no delivery message is an event`);
    const consumers = new Set(t.messages.filter((m: any) => m.kind === 'deliver').map((m: any) => m.target?.service).filter(Boolean));
    const services = new Set(lane.columns.filter((c: any) => c.kind === 'service').map((c: any) => c.service));
    for (const c of consumers) if (!lane.bars.some((b: any) => b.service === c && b.sync)) assert.ok(!services.has(c) || c === s || lane.bars.some((b: any) => b.service === c), `${s}: consumer ${c} only through a sync call`);
    assert.ok(lane.events.filter((e: any) => e.type === 'hop' && e.end).every((e: any) => e.to.kind === 'channel'), 'every end sits on a topic or queue lifeline');
  }
  const t = run('saga-controller', 'in.start');
  const lane = buildLane(t.messages, { participants: t.participants });
  assert.ok(!lane.bars.some((b: any) => b.service.startsWith('saga-eraser')), 'the consumer saga-eraser-a is not drawn in the controller lane');
});

test('every arrow carries the event type; topics and queues are lifelines right of the services, narrow and grouped per topic', () => {
  const t = run('account-lambda-erase-controller', 'in.advanceErase');
  const lane = buildLane(t.messages, { participants: t.participants });
  const hops = lane.events.filter((e: any) => e.type === 'hop');
  assert.ok(hops.every((h: any) => /^account\.tenant\.terminated\.priority\d+$/.test(h.label)));
  assert.ok(hops.every((h: any) => h.transport === 'sns'), 'routing hops are solid arrows in the hop transport colour');
  const kinds = lane.columns.map((c: any) => c.kind);
  assert.deepEqual(kinds.slice(kinds.indexOf('channel')).filter((k: string) => k !== 'channel'), [], 'channels are the last columns');
  assert.equal(lane.columns[kinds.indexOf('channel')].label, 'production-event-bus-sns', 'the topic comes first, then its queues');
  assert.ok(lane.columns.filter((c: any) => c.kind === 'channel').every((c: any) => c.sub === 'sqs' || c.sub === 'sns'));
});

test('lifeline order and reuse: one lifeline per queue even when several topics reach it', () => {
  const t = run('api-gateway', 'in.createOrder');
  const { publishes } = scanLane(t.messages);
  const plan = planChains(publishes.map((p: any) => chainOf(t.messages, p)));
  const keys = plan.order.map((o: any) => o.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(keys, ['sns:payment-disputes', 'sns:payment-events', 'sns:order-events', 'sqs:analytics-all-events', 'sqs:shipping-order-events', 'sqs:inventory-order-events']);
  assert.deepEqual(plan.order.map((o: any) => o.role), ['topic', 'topic', 'topic', 'queue', 'queue', 'queue']);
  assert.ok(plan.order.every((o: any, i: number) => i === 0 || o.group >= plan.order[i - 1].group), 'grouped per topic');
});

test('foldFanout: beyond six queues the healthy ones fold into "+N queues"; the ones with a problem stay; "open" shows all', () => {
  const q = (n: number, bad: number[] = []) => Array.from({ length: n }, (_, i) => ({ key: `q${i + 1}`, healthy: !bad.includes(i + 1) }));
  assert.deepEqual(foldFanout(q(6)).folded, []);
  assert.deepEqual(foldFanout(q(7)).folded, [], 'a fold of one is not worth a lifeline');
  const r = foldFanout(q(13));
  assert.deepEqual(r.shown, ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
  assert.equal(r.folded.length, 7);
  const bad = foldFanout(q(13, [9, 12]));
  assert.ok(bad.shown.includes('q9') && bad.shown.includes('q12'));
  assert.equal(bad.shown.length, 6);
  assert.equal(bad.shown.length + bad.folded.length, 13);
  assert.deepEqual(bad.shown, [...bad.shown].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))), 'lifeline order kept');
  assert.deepEqual(foldFanout(q(13), { open: true }).folded, []);
});

test('erase controller: 9 queues fold to 6 + "+3 queues"; the folded arrow merges its legs; "no handler" queues stay drawn', () => {
  const t = run('account-lambda-erase-controller', 'in.advanceErase');
  const lane = buildLane(t.messages, { participants: t.participants, numbers: deliveryNumbers(asyncTree(t.messages)) });
  const ch = lane.columns.filter((c: any) => c.kind === 'channel');
  assert.equal(ch.length, 1 + 6 + 1);
  const fold = ch.find((c: any) => c.folded);
  assert.equal(fold.label, '+3 queues');
  assert.ok(['crm-sync-events', 'tenant-notifications'].every((n) => ch.some((c: any) => c.label === n)), 'queues with no handler are not folded');
  const merged = lane.events.find((e: any) => e.type === 'hop' && e.to === fold);
  assert.equal(merged.legs.length, 3);
  assert.equal(merged.marker.label, '3 queues');
  assert.equal(merged.end.tiles.length, 1, 'one range tile for the folded deliveries');
  // unfolded: every queue has its lifeline
  const open = buildLane(t.messages, { participants: t.participants, fanOpen: true });
  assert.equal(open.columns.filter((c: any) => c.kind === 'channel').length, 1 + 9);
  assert.ok(!open.columns.some((c: any) => c.folded));
  // stress: 13 queues on one topic
  const s = run('stress-gateway', 'in.startChecked');
  const sl = buildLane(s.messages, { participants: s.participants });
  const sch = sl.columns.filter((c: any) => c.kind === 'channel');
  assert.ok(sch.length <= 1 + 1 + 6 + 1 + 1, 'topic, the shared queue, six queues, the fold');
  assert.ok(sch.some((c: any) => c.label === '+7 queues'));
});

test('filter marker text: "1 type", "all but 1", the rule of a bus, the routing key of an exchange; nothing when everything passes', () => {
  const f = (events: any, extra: any = {}) => ({ id: 'sub.x', service: 'infra', from: 'sns:t', events, ...extra });
  assert.deepEqual(filterMarker(f(['OrderPlaced']), 'sns'), { kind: 'types', label: '1 type', full: 'Subscription sub.x (infra) lets through OrderPlaced only' });
  assert.equal(filterMarker(f(['A', 'B*']), 'sns').label, '2 types');
  assert.equal(filterMarker(f(['!Debug']), 'sns').label, 'all but 1');
  assert.equal(filterMarker(f(['!Debug', '!Trace']), 'sns').label, 'all but 2');
  assert.match(filterMarker(f(['!Debug']), 'sns').full, /every type except Debug/);
  assert.equal(filterMarker(f('*'), 'sns'), null);
  assert.equal(filterMarker(f(undefined), 'sns'), null);
  assert.equal(filterMarker(null, 'sns'), null);
  const rule = filterMarker(f(['User*'], { id: 'rule.userEvents', from: 'eventbridge:acme-bus' }), 'eventbridge');
  assert.equal(rule.kind, 'rule'); assert.equal(rule.label, 'rule userEvents'); assert.match(rule.full, /lets through User\* only/);
  const key = filterMarker({ id: 'bind.shipping', service: 'notifications-svc', from: 'amqp:shipping/shipping.*' }, 'amqp');
  assert.equal(key.kind, 'key'); assert.equal(key.label, 'shipping.*');
});

test('filters on the arrows: the trace carries the subscription of a hop, the lane shows it, filtered-out deliveries are not drawn', () => {
  const t = run('account-lambda-erase-controller', 'in.advanceErase');
  const hop = t.messages.find((m: any) => m.to === 'ch:sqs:billing-tenant-events');
  assert.deepEqual(hop.filter.events, ['account.tenant.*']);
  assert.ok(t.messages.filter((m: any) => m.kind === 'deliver').every((m: any) => !m.filter), 'only the hop into the queue carries it');
  const lane = buildLane(t.messages, { participants: t.participants });
  const billing = lane.events.filter((e: any) => e.type === 'hop' && e.to.label === 'billing-tenant-events');
  assert.equal(billing.length, 4);
  assert.ok(billing.every((e: any) => e.marker.label === '1 type' || e.marker.label === '2 types' || e.marker.kind === 'types'));
  // the priority-15 branch reaches 4 queues; the ones its subscriptions filter out have no arrow in that branch
  const rows15 = lane.events.filter((e: any) => e.type === 'hop' && e.label.endsWith('priority15') && !e.fromBar);
  assert.equal(rows15.length, 4);
});

test('EventBridge: service -> bus -> (rule marker) -> target queue; AMQP: service -> exchange -> queue (routing key marker); a direct send is service -> queue', () => {
  const eb = trace(g, { service: 'users-svc', fn: 'register_user' }, { scope: 'full' })!;
  const el = buildLane(eb.messages, { participants: eb.participants });
  const ebh = el.events.filter((e: any) => e.type === 'hop');
  assert.deepEqual(ebh.map((e: any) => [e.from.label, e.to.label, e.transport]), [['users-svc', 'acme-bus', 'eventbridge'], ['acme-bus', 'analytics-all-events', 'eventbridge']]);
  assert.equal(ebh[1].marker.label, 'rule userEvents');
  assert.ok(ebh.every((e: any) => e.label === 'UserRegistered'));
  const t = run('shipping-svc', 'in.orderPlaced');
  const al = buildLane(t.messages, { participants: t.participants });
  const ah = al.events.filter((e: any) => e.type === 'hop');
  assert.deepEqual(ah.map((e: any) => [e.from.label, e.to.label, e.to.sub]), [['shipping-svc', 'shipping', 'amqp'], ['shipping', 'notify-shipping', 'amqp']]);
  assert.equal(ah[1].marker.label, 'shipping.*');
  assert.equal(ah[0].label, 'shipping.created');
  // a send straight to a queue with no topic
  const m2 = sampleModel();
  m2.bindings = m2.bindings.filter((b: any) => b.to !== 'amqp-queue:notify-shipping');
  const d = trace(buildIndex(m2), { service: 'shipping-svc', ingress: 'in.orderPlaced' }, { scope: 'full' })!;
  const dl = buildLane(d.messages, { participants: d.participants });
  assert.ok(!dl.events.some((e: any) => e.type === 'hop' && e.to.kind === 'channel' && e.from.kind === 'channel'));
});

test('"no consumers" at a topic without subscriptions and "no reader" at a queue nobody reads', () => {
  const t = run('api-gateway', 'in.createOrder');
  const lane = buildLane(t.messages, { participants: t.participants });
  assert.equal(lane.events.find((e: any) => e.type === 'hop' && e.to.label === 'payment-disputes').end.none, 'no consumers');
  const m2 = sampleModel();
  m2.ingress = m2.ingress.filter((i: any) => i.bindKey !== 'sqs:shipping-order-events');
  const t2 = trace(buildIndex(m2), { service: 'api-gateway', ingress: 'in.createOrder' }, { scope: 'full', maxMessages: 800 })!;
  const l2 = buildLane(t2.messages, { participants: t2.participants });
  const q = l2.events.find((e: any) => e.type === 'hop' && e.to.label === 'shipping-order-events');
  assert.equal(q.end.none, 'no reader');
  assert.equal(q.end.tiles.length, 0);
});

test('rangeLabel and badgesAt: one tile per consumer row up to two, then a range; repeats are muted tiles of the row they repeat', () => {
  assert.equal(rangeLabel(['3', '4', '5']), '3–5');
  assert.equal(rangeLabel(['1.1', '1.2', '1.3']), '1.1–1.3');
  assert.equal(rangeLabel(['1', '4']), '1, 4');
  assert.equal(rangeLabel(['1', '4', '6', '9']), '1 … 9');
  assert.equal(rangeLabel(['10', '9', '8']), '8–10');
  const item = (label: string, shows = label, seen = false) => ({ label, shows, seen });
  assert.deepEqual(badgesAt([item('1')]).map((b: any) => b.text), ['1']);
  assert.deepEqual(badgesAt([item('1'), item('2')]).map((b: any) => b.text), ['1', '2']);
  const r = badgesAt([item('3'), item('4'), item('5')]);
  assert.deepEqual(r.map((b: any) => [b.text, b.jump, b.n]), [['3–5', '3', 3]]);
  assert.deepEqual(r[0].own, ['3', '4', '5']);
  const s = badgesAt([item('2', '1', true)]);
  assert.deepEqual(s.map((b: any) => [b.text, b.seen, b.jump, b.own]), [['↩1', true, '1', ['2']]]);
  assert.equal(hopLabel({ event: 'X', label: 'a' }), 'X');
});

// ---- the number on a tile is the number of the row in the list below ----

const topLabels = (tree: any) => tree.groups.flatMap((gr: any) => gr.rows.map((r: any) => r.label)).sort();
const tileLabels = (lane: any) => lane.events.filter((e: any) => e.type === 'hop' && e.end).flatMap((e: any) => e.end.items.map((i: any) => i.label)).sort();
const shown = (lane: any) => lane.events.filter((e: any) => e.type === 'hop' && e.end).flatMap((e: any) => e.end.items.map((i: any) => i.shows));

for (const [s, i] of [['account-lambda-erase-controller', 'in.advanceErase'], ['saga-controller', 'in.start'], ['api-gateway', 'in.createOrder']]) {
  test(`diagram tiles and index rows share one numbering (${s} ${i}), also inside a card`, () => {
    const t = run(s, i);
    const tree = asyncTree(t.messages);
    const lane = buildLane(t.messages, { participants: t.participants, numbers: deliveryNumbers(tree) });
    assert.deepEqual(tileLabels(lane), topLabels(tree), 'every delivery of the list has its tile, none more');
    // a repeat shows the row it repeats, and that row exists
    const byLabel = new Set(tree.rows.map((r: any) => r.label));
    for (const sh of shown(lane)) assert.ok(byLabel.has(sh), `tile ${sh} jumps to a row`);
    const top = new Set(topLabels(tree));
    for (const r of tree.rows.filter((r: any) => r.seenIn && top.has(r.label))) assert.ok(shown(lane).includes(r.seenIn), 'repeat tile reads the row it repeats');
    // the card of the first openable row draws its own publishes with the row's prefix
    const row = tree.rows.find((r: any) => !r.seenIn && !r.noHandler && r.ingress && r.groups.length);
    if (!row) return;
    const st = trace(g, { service: row.service, ingress: row.ingress, event: row.event ?? undefined }, { scope: 'full', maxMessages: 800 })!;
    const sub = asyncTree(st.messages, row.label);
    const subLane = buildLane(st.messages, { participants: st.participants, numbers: deliveryNumbers(sub) });
    assert.deepEqual(tileLabels(subLane), topLabels(sub));
    assert.ok(tileLabels(subLane).every((l: string) => l.startsWith(`${row.label}.`)));
    assert.deepEqual(subRequest(row).service, row.service);
  });
}

test('the tiles of the erase controller read 1..8 for the first branch and the repeats point back at them', () => {
  const t = run('account-lambda-erase-controller', 'in.advanceErase');
  const tree = asyncTree(t.messages);
  const lane = buildLane(t.messages, { participants: t.participants, numbers: deliveryNumbers(tree) });
  const first = lane.events.filter((e: any) => e.type === 'hop' && e.end && e.label.endsWith('priority10')).flatMap((e: any) => e.end.tiles.map((x: any) => x.text));
  assert.deepEqual(first.slice(0, 5), ['1', '2', '3', '4', '5']);
  assert.ok(first.some((x: string) => x.includes('–')), 'the folded queues show a range');
  const seen = lane.events.filter((e: any) => e.type === 'hop' && e.end && e.label.endsWith('priority20')).flatMap((e: any) => e.end.tiles);
  assert.ok(seen.every((x: any) => x.seen === true), 'later branches repeat the first');
});

test('arrows from a bar to a topic cross no unrelated bar in the sample demos', () => {
  for (const [s, i] of [['api-gateway', 'in.createOrder'], ['account-lambda-erase-controller', 'in.advanceErase'], ['saga-controller', 'in.start'], ['stress-gateway', 'in.startChecked']]) {
    const t = run(s, i);
    const lane = buildLane(t.messages, { participants: t.participants });
    assert.deepEqual(crossings(lane).filter((c: any) => c.event.type === 'hop').map((c: any) => `${c.event.label}x${c.bar.service}`), [], `${s}: no hop crosses a bar`);
  }
});

test('routing runs left to right: no topic -> queue hop has its queue left of its topic', () => {
  for (const [s, i] of [['api-gateway', 'in.createOrder'], ['account-lambda-erase-controller', 'in.advanceErase'], ['saga-controller', 'in.start'], ['stress-gateway', 'in.startChecked'], ['shipping-svc', 'in.orderPlaced']]) {
    const t = run(s, i);
    const lane = buildLane(t.messages, { participants: t.participants });
    const at = new Map(lane.columns.map((c: any, k: number) => [c, k]));
    for (const e of lane.events.filter((x: any) => x.type === 'hop')) assert.ok(at.get(e.to)! > at.get(e.from)!, `${s}: ${e.label} runs left to right`);
  }
});

test('lifeline head names: at most two lines, broken after - . _ : and never with a separator alone', async () => {
  // @ts-ignore
  const { wrapId, clampLines } = await import('../web/js/views/flow-cols.js');
  assert.deepEqual(clampLines(wrapId('account-lambda-erase-controller', 16), 16), ['account-lambda-', 'erase-controller']);
  assert.deepEqual(clampLines(wrapId('saga-erase-a-q', 14), 14), ['saga-erase-a-q']);
  assert.deepEqual(wrapId('abcdefghijkl-m', 12).filter((l: string) => /^[-._:]$/.test(l)), []);
  const long = clampLines(wrapId('a-very-long-queue-name-that-goes-on-and-on-forever', 12), 12);
  assert.equal(long.length, 2); assert.ok(long[1].endsWith('…'));
});
