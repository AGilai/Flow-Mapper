// 0.19.0 RabbitMQ pages: the exchange page data, the inventory rows (exchanges, queues, folded RPC plumbing, RPC commands),
// the service page's RPC fields and the endpoint panel's callers.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sampleManifests, sampleModel, startApp } from './helpers.ts';
import { buildIndex } from '../core/graph-index.ts';
import { routeKey } from '../core/amqp-route.ts';
import { exchangeView, exchanges, resolveExchange, routesTo as routes } from '../core/amqp-exchange.ts';
import { inventory } from '../core/inventory.ts';
import { serviceView } from '../core/service-view.ts';
import { endpointInfo } from '../core/endpoint-info.ts';

const g = buildIndex(sampleModel());
const ex = exchangeView(g, 'amqp:saferx.EventExchange')!;

test('an exchange is found by key or bare name; unknown ones are not', () => {
  assert.equal(resolveExchange(g, 'amqp:saferx.EventExchange'), 'saferx.EventExchange');
  assert.equal(resolveExchange(g, 'saferx.EventExchange'), 'saferx.EventExchange');
  assert.equal(resolveExchange(g, 'amqp:nope'), null);
  assert.equal(exchangeView(g, 'redis:cache-main'), null);
  assert.deepEqual(exchanges(g).map((e) => e.name), ['saferx.EventExchange', 'shipping']);
});

test('exchange page: type, publishers with what they reach, bindings with who feeds them', () => {
  assert.equal(ex.type, 'topic');
  assert.equal(ex.bindingCount, 5);
  const pub = (k: string) => ex.publishers.find((p) => p.routingKey === k)!;
  assert.deepEqual(pub('device.{deviceId}.logout').reaches.map((r) => r.key).sort(), ['#.logout', 'device.#', 'device.*.logout']);
  assert.ok(pub('firmware.{deviceId}.updated').dropped);
  assert.ok(pub('audit.policy.changed'), 'swg-api publishes audit keys (0.19.0 demo)');
  const bind = (k: string) => ex.bindings.find((b) => b.key === k)!;
  assert.deepEqual(bind('device.#').consumers.map((c) => c.handler), ['DeviceEventHandler.handle']);
  assert.ok(bind('device.#').matchedBy.some((m) => m.routingKey === 'device.{deviceId}.blocked'));
  assert.ok(bind('system.#').noPublisher);
  assert.ok(!bind('audit.#').noPublisher, 'audit.# is fed by swg-api and sxdns');
});

test('exchange page callouts: a dropped key and a binding nobody feeds, each pointing at its row', () => {
  assert.deepEqual(ex.callouts.map((c) => c.kind).sort(), ['dropped', 'no-publisher']);
  assert.match(ex.callouts.find((c) => c.kind === 'dropped')!.text, /`firmware\.\{deviceId\}\.updated` from cp-middleware matches no binding, so RabbitMQ drops it/);
  assert.equal(ex.problems, 2);
});

test('the routing-key tester uses the exchange type: topic, direct, fanout, headers', () => {
  const hit = (v: any, k: string) => [...(routes(v, k) ?? [])].sort();
  assert.equal(hit(ex, 'device.ab12.logout').length, 3);
  assert.equal(hit(ex, 'firmware.ab12.updated').length, 0);
  assert.equal(hit({ ...ex, type: 'fanout' }, 'anything').length, 5);
  assert.equal(hit({ ...ex, type: 'direct' }, 'device.#').length, 1, 'direct = equality with the binding key');
  assert.equal(routes({ ...ex, type: 'headers' }, 'x'), null);
});

test('inventory: exchanges and queues in their own words, RPC queues folded as plumbing, RPC commands listed', () => {
  const inv = inventory(g);
  const row = (id: string) => inv.find((x) => x.id === id)!;
  assert.equal(row('amqp:saferx.EventExchange').connections, '3 publishers, 5 bindings');
  assert.equal(row('amqp:saferx.EventExchange').exchangeType, 'topic');
  assert.equal(row('amqp-queue:domain-events-dpc').connections, 'bound by `device.#`, 1 consumer');
  assert.ok(row('amqp-queue:rpcv2.sxdns').plumbing && row('amqp-queue:rpcv2.sxdns').kind === 'rpc-command-queue');
  assert.match(row('amqp-queue:rpcv2.sxdns').connections, /carries 2 commands of sxdns/);
  assert.equal(inv.filter((x) => x.id === 'amqp-queue:domain-events-dpc').length, 1);
  assert.ok(row('rpc-reply:swg-api').plumbing);
  assert.equal(inv.filter((x) => x.type === 'channel' && x.kind === 'amqp-queue' && x.plumbing).length, 0);
  const cmd = row('amqp-rpc:rpc.sxdns.dns.resolve');
  assert.equal(cmd.type, 'rpc');
  assert.deepEqual(cmd.open, { service: 'sxdns', ingress: 'in.rpcResolve' });
  assert.match(cmd.connections, /served by sxdns, called by cp-middleware, swg-api/);
  assert.equal(row('amqp-rpc:rpc.geo.locate').problems, 1, 'called but not served');
  assert.equal(row('amqp-rpc:rpc.sxdns.dns.reverse').problems, 0);
});

test('service view: RPC commands and calls carry their rpc info, publishes what they reach; no caller is not "never called"', () => {
  const v = serviceView(g, 'sxdns')!;
  const i = v.ingress.find((x) => x.id === 'in.rpcResolve') as any;
  assert.equal(i.rpc.commandQueue, 'rpcv2.sxdns');
  assert.deepEqual(i.callers.map((c: any) => c.service).sort(), ['cp-middleware', 'swg-api']);
  const call = v.egress.find((e) => e.id === 'zone.lookup') as any;
  assert.equal(call.rpc.timeoutMs, 1500);
  const pub = v.egress.find((e) => e.id === 'dnsOverride.publish') as any;
  assert.deepEqual(pub.amqp, { exchange: 'saferx.EventExchange', routingKey: 'audit.dns.override', bindings: ['audit.#'] });
  const dpc = serviceView(g, 'dpc-worker')!;
  assert.ok(dpc.ingress.filter((x: any) => x.rpc).every((x) => !x.orphan));
});

test('endpoint panel of an RPC command: callers with their timeouts and functions, the command queue', () => {
  const info = endpointInfo(g, 'sxdns', 'in.rpcResolve', [])!;
  assert.deepEqual(info.rpc!.callers.map((c) => c.service), ['cp-middleware', 'swg-api']);
  assert.ok(info.rpc!.callers.every((c) => c.timeoutMs != null));
  assert.equal(info.rpc!.commandQueue, 'rpcv2.sxdns');
  assert.equal(info.rpc!.sharedBy, 2);
  assert.deepEqual(info.slots.map((s) => s.role), ['request', 'response']);
  assert.equal(endpointInfo(g, 'cp-middleware', 'in.deviceLogout', [])!.rpc, null);
});

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201); });
after(() => app.close());

test('API: the exchange page is the instance route; Redis instances and 404s keep working', async () => {
  const v = (await app.call('GET', `/api/envs/prod/instances/${encodeURIComponent('amqp:saferx.EventExchange')}`)).body;
  assert.equal(v.type, 'topic');
  assert.equal(v.publishers.length, 6);
  assert.equal((await app.call('GET', '/api/envs/prod/instances/saferx.EventExchange')).body.key, 'amqp:saferx.EventExchange');
  assert.equal((await app.call('GET', `/api/envs/prod/instances/${encodeURIComponent('amqp:nope')}`)).status, 404);
  assert.equal((await app.call('GET', `/api/envs/prod/instances/${encodeURIComponent('redis:cache-main')}`)).body.kind, 'redis');
  assert.deepEqual((await app.call('GET', '/api/envs/prod/exchanges')).body.map((x: any) => x.key), ['amqp:saferx.EventExchange', 'amqp:shipping']);
  assert.ok((await app.call('GET', '/api/envs/prod/instances')).body.every((x: any) => x.kind === 'redis'), 'the Redis list is unchanged');
});

test('a queue declared by infra and by its consumer is one inventory row; a direct exchange routes by equality', () => {
  const m = sampleModel();
  m.channels.push({ service: 'saferx-infra', bindKey: 'amqp-queue:domain-events-dpc', kind: 'amqp-queue', name: 'domain-events-dpc', details: { durable: true } });
  const inv = inventory(buildIndex(m));
  assert.equal(inv.filter((x) => x.id === 'amqp-queue:domain-events-dpc').length, 1);
  const b = (from: string, match?: string) => ({ service: 's', id: from, from, match, to: 'amqp-queue:q' }) as any;
  const bs = [b('amqp:d/a.b', 'glob'), b('amqp:d/a.*', 'glob'), b('amqp:d/a.b')];
  const r = routeKey(bs, { type: 'direct' }, 'amqp:d/a.b')!;
  assert.deepEqual(r.matched.map((x) => x.from), ['amqp:d/a.b', 'amqp:d/a.b'], 'direct = equality, a glob on the binding is not applied');
});

test('RPC commands are entry points of the Flows list, called or not', async () => {
  const { entryPoints } = await import('../core/trace.ts');
  assert.ok(entryPoints(g).some((e) => e.service === 'sxdns' && e.id === 'in.rpcResolve'));
});

test('a queue page says it is fed by the exchange via the binding key', async () => {
  const { channelView } = await import('../core/channels.ts');
  const v = channelView(g, 'amqp-queue:domain-events-dpc')!;
  assert.match(v.flow.summary.text, /Fed by saferx\.EventExchange via device\.#/);
});
