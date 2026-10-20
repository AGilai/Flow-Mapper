// Wrapper hops ("via", #28): a call through a wrapper is one call. The chain is display data only.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.ts';
import { normaliseVia, viaLabel } from '../core/via.ts';

let app: Awaited<ReturnType<typeof startApp>>;
const base = (name: string, repo?: string) => ({ schemaVersion: '1.0', kind: 'full', env: 'e', service: { name, kind: 'service', repo }, version: 1, harvestedAt: '2026-10-19T08:00:00Z', commit: 'abc123' });
const hops = [
  { function: 'AddonPublisher.publish', file: 'src/addon.ts', line: 51, kind: 'wrapper' },
  { function: 'SNSManager.publish', file: 'src/common/SNSManager.ts', line: 20, kind: 'wrapper' },
];
const fn = [{ id: 'f', name: 'f', steps: [{ seq: 1, type: 'egress', target: 'pub', event: 'a.hit' }] }];
const mcp = async (name: string, args: object) => JSON.parse((await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { env: 'e', ...args } } })).body.result.content[0].text);

before(async () => {
  app = await startApp();
  const r = await app.call('POST', '/api/ingest', { manifests: [
    { ...base('infra'), service: { name: 'infra', kind: 'infra' }, channels: [{ bindKey: 'sns:t', kind: 'sns-topic' }, { bindKey: 'sqs:q', kind: 'sqs-queue' }], bindings: [{ id: 's', from: 'sns:t', to: 'sqs:q' }] },
    { ...base('consumer'), functions: [{ id: 'h', name: 'h', steps: [] }], ingress: [{ id: 'in', bindKey: 'sqs:q', transport: 'sqs', handler: 'h', events: [{ type: 'a.hit', handler: 'h', producers: [] }] }] },
    // via as schema fields, with call sites
    { ...base('wrapped', 'github.com/acme/wrapped'), functions: fn,
      egress: [{ id: 'pub', bindKey: 'sns:t', transport: 'sns', events: ['a.hit'], via: hops,
        callSites: [{ file: 'src/a.ts', line: 60, function: 'A.run', via: hops }, { file: 'src/b.ts', line: 7 }] }] },
    // via only in free-form details (as harvesters send it today)
    { ...base('legacy'), functions: fn, egress: [{ id: 'pub', bindKey: 'sns:t', transport: 'sns', events: ['a.hit'], details: { via: hops, callSites: [{ file: 'x.ts', line: 3, via: hops.slice(1) }] } }] },
    { ...base('plain'), functions: fn, egress: [{ id: 'pub', bindKey: 'sns:t', transport: 'sns', events: ['a.hit'] }] },
  ] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});
after(() => app.close());

const egressOf = async (svc: string) => (await app.call('GET', `/api/envs/e/views/service/${svc}`)).body.egress[0];

test('the schema accepts via and callSites on egress and rejects a hop with no function', async () => {
  const bad = await app.call('POST', '/api/ingest', { manifests: [{ ...base('bad'), egress: [{ id: 'x', bindKey: 'sns:t', transport: 'sns', via: [{ file: 'a.ts' }] }] }] });
  assert.ok(bad.status >= 400 && bad.status < 500, `status ${bad.status}`);
});

test('service view normalises via from the field and from details, with code links', async () => {
  const w = await egressOf('wrapped');
  assert.deepEqual(w.via.map((h: any) => h.function), ['AddonPublisher.publish', 'SNSManager.publish']);
  assert.equal(w.via[1].link.url, 'https://github.com/acme/wrapped/blob/abc123/src/common/SNSManager.ts#L20');
  assert.equal(w.callSites.length, 2);
  assert.equal(w.callSites[0].via.length, 2);
  assert.equal(w.callSites[0].link.url, 'https://github.com/acme/wrapped/blob/abc123/src/a.ts#L60');
  assert.deepEqual(w.callSites[1].via, []);
  const l = await egressOf('legacy');
  assert.deepEqual(l.via.map((h: any) => h.function), ['AddonPublisher.publish', 'SNSManager.publish']);
  assert.deepEqual(l.callSites[0].via.map((h: any) => h.function), ['SNSManager.publish']);
  const p = await egressOf('plain');
  assert.deepEqual([p.via, p.callSites], [[], []]);
});

test('a wrapper is never a producer, node or edge: each service publishes once', async () => {
  const consumer = (await app.call('GET', '/api/envs/e/views/service/consumer')).body.ingress[0];
  assert.deepEqual(consumer.callers.map((c: any) => c.service).sort(), ['legacy', 'plain', 'wrapped']);
  const sys = (await app.call('GET', '/api/envs/e/views/system')).body;
  const text = JSON.stringify(sys);
  assert.ok(!text.includes('SNSManager') && !text.includes('AddonPublisher'), 'wrapper names leaked into the system graph');
  const ev = (await app.call('GET', '/api/envs/e/events/a.hit')).body;
  const producers = ev?.producers ?? ev?.deliveries?.map((d: any) => d.producer) ?? [];
  assert.ok(!JSON.stringify(producers).includes('SNSManager'));
});

test('trace messages carry via on the egress call, once', async () => {
  const t = (await app.call('GET', '/api/envs/e/trace?service=wrapped&fn=f&scope=full')).body;
  const withVia = t.messages.filter((m: any) => m.via);
  assert.equal(withVia.length, 1);
  assert.equal(viaLabel(withVia[0].via), 'SNSManager.publish');
  assert.ok(!t.participants.some((p: any) => /SNSManager|AddonPublisher/.test(JSON.stringify(p))));
});

test('endpoint info shows via on a producer', async () => {
  const info = (await app.call('GET', '/api/envs/e/endpoints/consumer/in')).body;
  const prods = info.events[0].producers;
  assert.deepEqual(prods.map((p: any) => p.service).sort(), ['legacy', 'plain', 'wrapped']);
  assert.equal(viaLabel(prods.find((p: any) => p.service === 'wrapped').via), 'SNSManager.publish');
  assert.equal(prods.find((p: any) => p.service === 'plain').via, undefined);
});

test('MCP get_service includes via and filters egress by a wrapper substring', async () => {
  const all = await mcp('get_service', { service: 'wrapped' });
  assert.equal(viaLabel(all.egress[0].via), 'SNSManager.publish');
  assert.equal((await mcp('get_service', { service: 'wrapped', via: 'snsmanager' })).egress.length, 1);
  assert.equal((await mcp('get_service', { service: 'wrapped', via: 'nothing' })).egress.length, 0);
  assert.equal((await mcp('get_service', { service: 'plain', via: 'SNSManager' })).egress.length, 0);
});

test('normaliseVia drops junk and keeps order', () => {
  assert.deepEqual(normaliseVia('x'), []);
  assert.deepEqual(normaliseVia([null, 3, {}, { function: 'A.b', line: 'x' }, { file: 'f.ts' }]).map((h) => h.function), ['A.b', 'f.ts']);
  assert.equal(viaLabel([]), null);
});
