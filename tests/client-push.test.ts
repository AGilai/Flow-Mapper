// #99: a socket push into a client app (schema, link by key, trace ends at the app, not an entry point / orphan, health)
// and the event names on a gap egress message.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, readSample, sampleManifests } from './helpers.ts';
import { gapLabel, gapNames } from '../core/client-push.ts';

const agent = () => readSample('demo-device-agent.json');
const pusher = () => readSample('device-push.json');
const trace = (app: any, q = 'service=device-push&ingress=in.pushUpdates') => app.call('GET', `/api/envs/prod/trace?${q}&scope=full`).then((r: any) => r.body);

async function seeded() {
  const app = await startApp();
  const r = await app.call('POST', '/api/ingest', { manifests: sampleManifests() });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return app;
}

test('schema: a client-app push ingress (no handler, plain event names) is accepted and stored as {type}', async () => {
  const app = await startApp();
  const r = await app.call('POST', '/api/ingest', agent());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const s = await app.call('GET', '/api/envs/prod/services/demo-device-agent');
  assert.deepEqual(s.body.ingress.map((i: any) => i.events).flat().map((e: any) => e.type).sort(), ['CHANNEL_ONERROR', 'NETWORK_ONUPDATE']);
  assert.equal(s.body.ingress.length, 2);
  assert.ok(s.body.ingress.every((i: any) => i.handler === undefined && i.entryPoint === false));
  await app.close();
});

test('schema: older client-app manifests (egress only) stay valid; a normal ingress still needs its handler', async () => {
  const app = await startApp();
  const egressOnly = { schemaVersion: '1.0', kind: 'full', env: 'prod', service: { name: 'old-app', kind: 'client-app' }, version: 1, harvestedAt: '2026-11-03T08:00:00Z', functions: [], ingress: [], egress: [{ id: 'e', bindKey: 'http:GET x/y', transport: 'http' }], resources: [] };
  assert.equal((await app.call('POST', '/api/ingest', egressOnly)).status, 201);
  const bad = { ...agent(), service: { name: 'plain-svc', kind: 'service' }, ingress: [{ id: 'in.a', bindKey: 'http:GET plain/a', transport: 'http' }] };
  const r = await app.call('POST', '/api/ingest', bad);
  assert.equal(r.status, 422);
  assert.match(JSON.stringify(r.body), /handler/);
  const noHandler = { ...bad, ingress: [{ id: 'in.b', bindKey: 'socket:tls/plain-svc/X', transport: 'socket', entryPoint: true, events: ['X'] }] };
  assert.equal((await app.call('POST', '/api/ingest', noHandler)).status, 422, 'plain event names and no handler are for a push only');
  await app.close();
});

test('link by key, trace ends at the client app with a push arrow, the gap carries its event', async () => {
  const app = await seeded();
  const t = await trace(app);
  const pushes = t.messages.filter((m: any) => m.push);
  assert.deepEqual(pushes.map((m: any) => m.event), ['NETWORK_ONUPDATE', 'CHANNEL_ONERROR']);
  assert.ok(pushes.every((m: any) => m.to === 'svc:demo-device-agent' && m.kind === 'egress' && !m.gap && !m.broken && m.target?.ingress.startsWith('in.push.')));
  assert.ok(!t.messages.some((m: any) => m.from === 'svc:demo-device-agent'), 'nothing runs inside the agent');
  assert.ok(!t.participants.some((p: any) => p.kind === 'client' && /tls/.test(p.label)), 'not drawn as a client entry');
  assert.equal(t.participants.find((p: any) => p.id === 'svc:demo-device-agent').serviceKind, 'client-app');
  const gap = t.messages.find((m: any) => m.gap);
  assert.match(gap.label, /^CHANNEL_ONSESSIONTIMEOUT → demo-device-agent/);
  await app.close();
});

test('not an entry point, not an orphan, a matched push is not undelivered, the system map has the edge', async () => {
  const app = await seeded();
  const eps = (await app.call('GET', '/api/envs/prod/entry-points')).body;
  assert.ok(!JSON.stringify(eps).includes('demo-device-agent'));
  const h = (await app.call('GET', '/api/envs/prod/health')).body.items;
  assert.ok(!h.orphans.some((o: any) => o.service === 'demo-device-agent'));
  assert.ok(!h.neverArrives.some((o: any) => o.service === 'demo-device-agent'));
  const und = h.undeliveredEvents.filter((u: any) => u.service === 'device-push').map((u: any) => u.event);
  assert.deepEqual(und, ['CHANNEL_ONSESSIONTIMEOUT'], 'only the unmatched push');
  const sys = (await app.call('GET', '/api/envs/prod/views/system')).body;
  assert.ok(sys.edges.some((e: any) => e.from === 'svc:device-push' && e.to === 'svc:demo-device-agent'));
  await app.close();
});

test('a push with no agent ingress is dangling, not matched', async () => {
  const app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', pusher())).status, 201);
  const t = await trace(app);
  assert.ok(!t.messages.some((m: any) => m.push));
  assert.equal(t.messages.filter((m: any) => m.broken).length, 2);
  await app.close();
});

test('delta ingest: an ingress added to the client app links the push; plain events in an upsert are stored as {type}', async () => {
  const app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', pusher())).status, 201);
  const first = agent();
  const base = { ...first, ingress: [first.ingress[0]] };
  assert.equal((await app.call('POST', '/api/ingest', base)).status, 201);
  assert.equal((await trace(app)).messages.filter((m: any) => m.push).length, 1);
  const delta = { schemaVersion: '1.0', kind: 'delta', env: 'prod', service: { name: 'demo-device-agent' }, baseVersion: 1, version: 2, harvestedAt: '2026-11-03T09:00:00Z', upsert: { ingress: [first.ingress[1]] } };
  const r = await app.call('POST', '/api/ingest', delta);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await trace(app)).messages.filter((m: any) => m.push).length, 2);
  const s = await app.call('GET', '/api/envs/prod/services/demo-device-agent');
  assert.deepEqual(s.body.ingress.flatMap((i: any) => i.events).map((e: any) => e.type).sort(), ['CHANNEL_ONERROR', 'NETWORK_ONUPDATE']);
  assert.ok(s.body.ingress.every((i: any) => typeof i.events[0] === 'object'));
  await app.close();
});

test('gap label: events, else details.event, every transport, no duplication', () => {
  assert.equal(gapLabel('Harmony agent (device on channelId)', gapNames({ events: ['NETWORK_ONUPDATE'] })), 'NETWORK_ONUPDATE → Harmony agent (device on channelId)');
  assert.equal(gapLabel('x', gapNames({ details: { event: 'E1' } })), 'E1 → x');
  assert.equal(gapLabel('x', gapNames({ events: ['A', 'B'], details: { event: 'C' } })), 'A, B → x');
  assert.equal(gapLabel('NETWORK_ONUPDATE → Harmony agent', gapNames({ events: ['NETWORK_ONUPDATE'] })), 'NETWORK_ONUPDATE → Harmony agent');
  assert.equal(gapLabel('plain', gapNames({})), 'plain');
  assert.equal(gapLabel('plain', gapNames(undefined, 'STEP_EVT')), 'STEP_EVT → plain');
});
