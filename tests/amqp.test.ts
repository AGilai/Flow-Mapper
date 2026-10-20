// 0.18.0 RabbitMQ: topic matching, routing by exchange type, RPC over AMQP (amqp-rpc:{command}), sendToQueue, and the lane helpers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleModel } from './helpers.ts';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { topicMatch, headersMatch } from '../core/amqp.ts';
import { keyMatches } from '../core/glob.ts';
import { deliveryOf } from '../core/resolve.ts';
import { pairPlan, exchangeMarker, nonMatchText, timeoutText } from '../web/js/views/flow-amqp.js';
import { buildLane } from '../web/js/views/flow-lane.js';

const g = buildIndex(sampleModel());
const run = (service: string, ingress: string) => trace(g, { service, ingress }, { scope: 'full' })!;

test('topic match: * is one word, # is zero or more words', () => {
  assert.ok(topicMatch('audit.#', 'audit'));
  assert.ok(topicMatch('audit.#', 'audit.a.b'));
  assert.ok(topicMatch('device.*.logout', 'device.{deviceId}.logout'));
  assert.ok(!topicMatch('device.*.logout', 'device.a.b.logout'));
  assert.ok(topicMatch('#.logout', 'device.x.logout') && topicMatch('#', 'a.b') && topicMatch('#', ''));
  assert.ok(!topicMatch('device.#', 'firmware.x.updated'));
  assert.ok(keyMatches('amqp:ex/device.*.logout', 'amqp-topic', 'amqp:ex/device.a.logout'));
  assert.ok(!keyMatches('amqp:ex/#', 'amqp-topic', 'amqp:other/a'), 'the exchange must be the same');
});

test('headers exchange: x-match all / any; unknown publisher headers are "unknown"', () => {
  const b = { headers: { type: 'logout', tier: 'edge' }, xMatch: 'all' };
  assert.equal(headersMatch(b, { headers: { type: 'logout', tier: 'edge' } }), true);
  assert.equal(headersMatch(b, { headers: { type: 'logout' } }), false);
  assert.equal(headersMatch({ ...b, xMatch: 'any' }, { headers: { type: 'logout' } }), true);
  assert.equal(headersMatch(b, undefined), 'unknown');
});

test('a publish to the topic exchange: 3 of 5 bindings, one trunk, one hop per binding, the others listed', () => {
  const t = run('cp-middleware', 'in.deviceLogout');
  const pub = t.messages.find((m) => m.to === 'ch:amqp:saferx.EventExchange' && m.event === 'DeviceLoggedOut')!;
  assert.equal(pub.deliveries, 3);
  assert.equal(pub.amqp!.matched, 3);
  assert.deepEqual(pub.amqp!.nonMatching.map((b) => b.key).sort(), ['audit.#', 'system.#']);
  const hops = t.messages.filter((m) => m.from === 'ch:amqp:saferx.EventExchange' && m.group === pub.group);
  assert.deepEqual(hops.map((m) => m.filter!.bindingKey).sort(), ['#.logout', 'device.#', 'device.*.logout']);
  const none = t.messages.find((m) => m.event === 'FirmwareUpdated')!;
  assert.equal(none.amqp!.matched, 0);
  assert.equal(none.to, 'ch:amqp:saferx.EventExchange', 'the arrow ends at the exchange');
  assert.ok(!none.broken);
});

test('a single matching binding goes straight to the queue (as before); the existing exchange sample is untouched', () => {
  const t = run('cp-middleware', 'in.deviceSync');
  const pub = t.messages.find((m) => m.event === 'DeviceSynced')!;
  assert.equal(pub.to, 'ch:amqp-queue:domain-events-dpc');
  assert.equal(pub.amqp!.exchange, 'saferx.EventExchange');
  const ship = run('shipping-svc', 'in.orderPlaced');
  assert.ok(ship.messages.some((m) => m.to === 'ch:amqp-queue:notify-shipping' && m.amqp?.exchange === 'shipping'));
});

test('RPC over AMQP: linked by amqp-rpc:{command}, sync, unicast, details from both sides, nested RPC, no server', () => {
  assert.equal(deliveryOf({ transport: 'amqp', mode: 'sync' }), 'unicast');
  assert.equal(deliveryOf({ transport: 'amqp', mode: 'async' }), 'multicast');
  const t = run('swg-api', 'in.policyCheck');
  const rpcs = t.messages.filter((m) => m.rpc);
  assert.deepEqual(rpcs.map((m) => [m.rpc!.command, m.depth, m.mode]), [['rpc.sxdns.dns.resolve', 1, 'sync'], ['rpc.dpc.zone.lookup', 2, 'sync']]);
  assert.equal(rpcs[0].rpc!.timeoutMs, 5000);
  assert.equal(rpcs[0].rpc!.prefetch, 4, 'the server adds prefetch');
  assert.equal(rpcs[0].rpc!.declaredBy, 'both');
  assert.equal(rpcs[0].target!.service, 'sxdns');
  const sync = run('cp-middleware', 'in.deviceSync');
  const geo = sync.messages.find((m) => m.rpc?.command === 'rpc.geo.locate')!;
  assert.ok(geo.broken && geo.rpc!.declaredBy === 'caller');
});

test('sendToQueue goes straight from the service to the queue, no exchange', () => {
  const t = run('cp-middleware', 'in.deviceAudit');
  const send = t.messages[1];
  assert.equal(send.to, 'ch:amqp-queue:saferx.activitylog');
  assert.ok(!send.amqp);
});

test('lane: chip on the first call per pair, glyph on later ones, replies, olive bars, one trunk with the "N bindings don\'t match" line', () => {
  const t = run('cp-middleware', 'in.deviceSync');
  const lane = buildLane(t.messages, { participants: t.participants });
  const calls = lane.events.filter((e: any) => e.type === 'call' && e.rpc);
  assert.deepEqual(calls.map((e: any) => [e.label, !!e.rpc.chip, !!e.rpc.glyph]), [
    ['rpc.sxdns.dns.resolve', true, false], ['rpc.dpc.zone.lookup', true, false], ['rpc.sxdns.dns.reverse', false, true], ['rpc.dpc.device.get', true, false], ['rpc.activitylog.log.append', true, false]]);
  assert.ok(lane.bars.filter((b: any) => b.rpc).every((b: any) => b.transport === 'rpc' && b.sync));
  assert.ok(lane.events.some((e: any) => e.type === 'unresolved' && e.chip === 'no server harvested'));
  const lo = buildLane(run('cp-middleware', 'in.deviceLogout').messages, { participants: run('cp-middleware', 'in.deviceLogout').participants });
  assert.equal(lo.events.filter((e: any) => e.type === 'hop' && e.trunk).length, 2);
  assert.ok(lo.events.some((e: any) => e.type === 'amqpnote' && /2 bindings don't match: audit\.#, system\.#/.test(e.text)));
  assert.ok(lo.events.some((e: any) => e.type === 'hop' && e.end?.none === 'no binding matches'));
});

test('lane helpers: replies, timeout text, marker by exchange type', () => {
  const plan = pairPlan();
  assert.equal(plan(0, 'a', {}).reply, 'reply');
  assert.equal(plan(0, 'a', {}).reply, '');
  assert.equal(plan(0, 'a', { timeoutMs: 5000 }).reply, 'reply or timeout 5 s');
  assert.equal(timeoutText(1500), '1.5 s');
  const f = { id: 'b', service: 's', from: 'amqp:x/a.*', bindingKey: 'a.*' };
  assert.equal(exchangeMarker(f, { type: 'topic' })!.label, 'a.*');
  assert.equal(exchangeMarker(f, { type: 'direct' }), null);
  assert.equal(exchangeMarker(f, { type: 'fanout' }), null);
  assert.equal(exchangeMarker({ ...f, headers: { type: 'logout' }, xMatch: 'all' }, { type: 'headers' })!.label, 'all: type=logout');
  assert.equal(nonMatchText({ matched: 0, nonMatching: [{ key: 'a' }] }), null);
});
