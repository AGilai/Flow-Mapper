// step.origin 'frontier' (folded in traces) and classified leaf steps without a target (#34).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { integrityErrors } from '../core/integrity.ts';
import { unresolvedItems } from '../core/harvest-quality.ts';
import type { Model } from '../core/types.ts';
import { sampleManifests, readSample, startApp } from './helpers.ts';

function sampleModel(): Model {
  const model: Model = { env: 'prod', services: [], functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [] };
  for (const m of sampleManifests()) {
    model.services.push({ ...m.service, version: m.version, harvestedAt: m.harvestedAt });
    for (const l of ['functions', 'ingress', 'egress', 'resources', 'channels', 'bindings'] as const)
      for (const e of m[l] ?? []) (model[l] as any[]).push({ ...e, service: m.service.name, ...(l === 'functions' ? { steps: e.steps ?? [] } : {}) });
  }
  return model;
}
const demo = { service: 'orders-svc', ingress: 'in.remove' };
const demo35 = { service: 'account-lambda-erase-controller', ingress: 'in.notifyBilling' }; // added with the #35 demo, after the hash was taken
const demo26 = { service: 'account-lambda-erase-controller', ingress: 'in.eraseStatus' }; // added with the #26 demo
const demo36 = { service: 'orders-svc', ingress: 'in.touch' }; // read_write and fields added with the #36/#37 demo
const demo40 = [{ service: 'account-lambda-erase-controller', ingress: 'in.publishDeviceEvent' }, { service: 'account-lambda-erase-controller', ingress: 'in.publishUnknownEvent' }]; // untyped publishes, added with the #40 demo
const demo42 = [{ service: 'account-lambda-agent-info', ingress: 'in.unknownEntry' }, { service: 'account-lambda-agent-info', ingress: 'in.invalidSchema' }, { service: 'account-session-cleaner', ingress: 'in.unknownEntry' }, { service: 'account-session-cleaner', ingress: 'in.schemaViolation' }]; // per-caller event types, added with the #42 demo
const demo44 = [{ service: 'account-lambda-device-events', ingress: 'in.logout' }, { service: 'account-lambda-device-events', ingress: 'in.loggedOut' }]; // eventFrom in a second service, added with the #44 demo
const demo45 = { service: 'orders-svc', ingress: 'in.get' }; // a step with unresolved what=detail fields (#45 demo; the trace gains `unknown`)
const demoPosture = { service: 'users-svc', ingress: 'in.getPosture' }; // the 0.25.0 reference demo (golden entry added in trace-golden.json)
const demo41 = { service: 'account-lambda-erase-controller', ingress: 'in.advanceErase' }; // alt frame, added with the #41 demo

test('traces of every sample entry without frontier steps are unchanged (0.24.0: the additive `operation` on calls out is left out of the hash; 0.17.0: the additive `filter` on hops through a subscription is left out of the hash, see flow-chain.test.ts; hash retaken on 0.9.4: fan-out consumers are expanded after the last delivery (orders-svc/in.create changed, order only); orders-svc/in.get left out on 0.17.3 (#45 demo step); the #46 socket demo (sdp-controller) and the saga demo (saga-* services) and the 0.12.0 middleware demo (reports-api, auth-svc) are excluded; 0.9.3: three traces of the saga demo added, every earlier trace identical; 0.9.2: lifeline order of 3 fan-out traces changed, content identical, see lifeline-order.test.ts; 0.8.5: SNS fan-out fields group/deliveries/delivery added to 2 traces, see sns-fanout.test.ts)', () => {
  const m = sampleModel();
  const g = buildIndex(m);
  const h = createHash('sha256');
  let n = 0;
  for (const i of m.ingress.filter((x) => !x.service.startsWith('stress-') && !x.service.startsWith('saga') && !['reports-api', 'auth-svc', 'sdp-controller', 'cp-middleware', 'swg-api', 'dpc-worker', 'activitylog', 'sxdns'].includes(x.service) && ![demo, demo35, demo26, demo36, ...demo40, demo41, ...demo42, ...demo44, demo45, demoPosture].some((d) => x.service === d.service && x.id === d.ingress))) for (const scope of ['intra', 'full'] as const) {
    h.update(JSON.stringify([i.service, i.id, scope, trace(g, { service: i.service, ingress: i.id }, { scope })], (k, v) => (k === 'filter' || k === 'amqp' || k === 'rpc' || k === 'operation' ? undefined : v)));
    n++;
  }
  assert.equal(n, 152);
  assert.equal(h.digest('hex'), 'df81622b7c3592bf30e996391cf5a5485fd12b155bd46399d35d7882062f66ec');
});

test('origin "path" is the same as no origin', () => {
  const m = sampleModel();
  const plain = trace(buildIndex(m), { service: 'orders-svc', ingress: 'in.create' }, { scope: 'full' });
  for (const f of m.functions) for (const s of f.steps) if (!s.origin) s.origin = 'path';
  assert.deepEqual(trace(buildIndex(m), { service: 'orders-svc', ingress: 'in.create' }, { scope: 'full' }), plain);
});

test('frontier steps fold into one marker per function and are not counted in maxMessages', () => {
  const g = buildIndex(sampleModel());
  const t = trace(g, demo, { scope: 'full' })!;
  assert.deepEqual(t.messages.map((m) => m.kind), ['entry', 'resource', 'frontier']);
  assert.equal(t.messages[2].label, 'frontier: 8 steps');
  assert.equal(t.messages[2].frontierSteps, 8);
  // room for the entry, the real step and the marker only: nothing is lost
  assert.equal(trace(g, demo, { scope: 'full', maxMessages: 3 })!.truncated, false);
});

test('frontier: true shows the subtree; classified leaves appear as leaf messages', () => {
  const g = buildIndex(sampleModel());
  const t = trace(g, demo, { scope: 'full', frontier: true })!;
  assert.ok(!t.messages.some((m) => m.kind === 'frontier'));
  assert.equal(t.messages.length, 1 + 1 + 8);
  assert.deepEqual(t.messages.filter((m) => m.kind === 'leaf').map((m) => [m.label, m.note, m.from === m.to]),
    [['findOne · db_access: Order.findOne (mongoose)', 'db_access: Order.findOne (mongoose)', true], ['uuid.v4 · external_pkg: uuid', 'external_pkg: uuid', true]]);
  assert.equal(t.messages.filter((m) => m.origin === 'frontier').length, 8);
  assert.equal(trace(g, demo, { scope: 'full', frontier: true, maxMessages: 4 })!.truncated, true);
});

test('a leaf step needs no unresolved entry and is not a gap in health', () => {
  const m = sampleModel();
  assert.deepEqual(integrityErrors(readSample('orders-svc.json')), []);
  assert.equal(unresolvedItems(buildIndex(m)).filter((u) => u.service === 'orders-svc' && /remove|archive|collectRefs|loadAddons/.test(u.fn ?? '')).length, 0);
  const noTarget = { functions: [{ id: 'f', steps: [{ seq: 1, type: 'call' }, { seq: 2, type: 'call', kind: 'leaf' as const }, { seq: 3, type: 'call', operation: 'findOne' }] }] };
  assert.deepEqual(integrityErrors(noTarget).map((e) => e.replace(/ target is.*/, '')), ["function 'f' step 1:"]);
});

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); });
after(() => app.close());

test('API: ingest accepts origin and leaf, reports no unresolved; trace takes frontier=1; MCP trace_flow takes frontier', async () => {
  const r = await app.call('POST', '/api/ingest', { manifests: [readSample('orders-svc.json')] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const q = '/api/envs/prod/trace?service=orders-svc&ingress=in.remove';
  assert.equal((await app.call('GET', q)).body.messages.length, 3);
  assert.equal((await app.call('GET', `${q}&frontier=1`)).body.messages.length, 10);
  const mcp = async (args: object) => JSON.parse((await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'trace_flow', arguments: { env: 'prod', service: 'orders-svc', ingress: 'in.remove', ...args } } })).body.result.content[0].text);
  assert.equal((await mcp({})).messages.length, 3);
  assert.equal((await mcp({ frontier: true })).messages.length, 10);
  const h = (await app.call('GET', '/api/envs/prod/health')).body;
  assert.equal(h.items.unresolved.filter((u: any) => /collectRefs|loadAddons|archive|remove/.test(u.fn ?? '')).length, 0);
  const bad = await app.call('POST', '/api/ingest?dryRun=1', { manifests: [{ ...readSample('orders-svc.json'), version: 9, functions: [{ id: 'x', name: 'x', steps: [{ seq: 1, type: 'call', origin: 'nope' }] }] }] });
  assert.ok(bad.status >= 400 && bad.status < 500);
});

test('many frontier markers do not use up maxMessages: the real messages are the same as without frontier steps (#39)', () => {
  const build = (withFrontier: boolean) => {
    const n = 10;
    const fns: any[] = [{ service: 's', id: 'main', name: 'main', steps: Array.from({ length: n }, (_, i) => ({ seq: i + 1, type: 'call', target: `f${i}` })) }];
    for (let i = 0; i < n; i++) fns.push({ service: 's', id: `f${i}`, name: `f${i}`, steps: [{ seq: 1, type: 'call', operation: 'op', note: 'x', kind: 'leaf' }, ...(withFrontier ? [{ seq: 2, type: 'call', target: 'main', origin: 'frontier' }] : [])] });
    return buildIndex({ env: 't', services: [{ name: 's', kind: 'service', version: 1, harvestedAt: '2026-01-01' } as any], functions: fns, ingress: [{ service: 's', id: 'in', bindKey: 'http:GET s/x', transport: 'http', handler: 'main' } as any], egress: [], resources: [], channels: [], bindings: [] });
  };
  const real = (t: any) => t.messages.filter((m: any) => m.kind !== 'frontier');
  for (const maxMessages of [8, 15, 500]) {
    const plain = trace(build(false), { service: 's', ingress: 'in' }, { scope: 'full', maxMessages })!;
    const folded = trace(build(true), { service: 's', ingress: 'in' }, { scope: 'full', maxMessages })!;
    assert.equal(real(folded).length, real(plain).length, `maxMessages ${maxMessages}`);
    assert.equal(folded.truncated, plain.truncated);
  }
  const t = trace(build(true), { service: 's', ingress: 'in' }, { scope: 'full', maxMessages: 500 })!;
  assert.equal(t.messages.filter((m) => m.kind === 'frontier').length, 10);
});
