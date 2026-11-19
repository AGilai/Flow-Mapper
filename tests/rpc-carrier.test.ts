// #137: an rpc egress (transport rpc, not RabbitMQ) carries details.carrier / details.via. Demo: samples/demo-rpc-caller.json -> demo-rpc-server.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { callView } from '../core/call-view.ts';
import { endpointInfo } from '../core/endpoint-info.ts';
import { carrierOf, rpcEndpointOf, rpcTransportText, rpcReceivedText, rpcCalledOf } from '../core/rpc-carrier.ts';
import { readSample, sampleModel, startApp } from './helpers.ts';

test('rpcTransportText: carrier, endpoint and via are built from the data', () => {
  assert.equal(rpcTransportText({ carrier: 'http', via: 'saferxlib', at: 'POST /internal/rpc', service: 'users-svc' }), 'RPC over HTTP (POST /internal/rpc on users-svc, via saferxlib)');
  assert.equal(rpcTransportText({ carrier: 'http', via: 'otherlib' }), 'RPC over HTTP (via otherlib)');
  assert.equal(rpcTransportText({ carrier: 'http', at: 'POST /internal/rpc' }), 'RPC over HTTP (POST /internal/rpc)');
  assert.equal(rpcTransportText({ carrier: 'http' }), 'RPC over HTTP');
  assert.equal(rpcTransportText({ via: 'saferxlib' }), 'RPC (carrier unknown)');
  assert.equal(rpcTransportText({}), 'RPC (carrier unknown)');
});

test('rpcReceivedText: one carrier, mixed carriers, unknown, none', () => {
  assert.equal(rpcReceivedText([{ service: 'a', carrier: 'http' }, { service: 'b', carrier: 'http' }, { service: 'a', carrier: 'http' }]), 'Called as RPC over HTTP by 2 callers');
  assert.equal(rpcReceivedText([{ service: 'a', carrier: 'http' }]), 'Called as RPC over HTTP by 1 caller');
  assert.equal(rpcReceivedText([{ service: 'a' }]), 'Called as RPC by 1 caller (carrier unknown)');
  assert.equal(rpcReceivedText([{ service: 'a', carrier: 'http' }, { service: 'b' }]), 'Called as RPC by 2 callers (HTTP: 1, carrier unknown: 1)');
  assert.equal(rpcReceivedText([]), null);
});

test('carrierOf reads only transport rpc; rpcEndpointOf only an http ingress on /internal/rpc', () => {
  assert.deepEqual(carrierOf({ transport: 'rpc', details: { carrier: 'http', via: 'saferxlib' } }), { carrier: 'http', via: 'saferxlib' });
  assert.deepEqual(carrierOf({ transport: 'rpc', details: { carrier: 3, via: ' ' } }), {});
  assert.deepEqual(carrierOf({ transport: 'http', details: { carrier: 'http' } }), {});
  assert.equal(rpcEndpointOf({ transport: 'http', bindKey: 'http:POST svc/internal/rpc', details: { method: 'POST', path: '/internal/rpc' } }), 'POST /internal/rpc');
  assert.equal(rpcEndpointOf({ transport: 'http', bindKey: 'http:post svc/internal/rpc' }), 'POST /internal/rpc');
  assert.equal(rpcEndpointOf({ transport: 'http', bindKey: 'http:POST svc/internal/other' }), undefined);
  assert.equal(rpcEndpointOf({ transport: 'sqs', bindKey: 'sqs:internal/rpc' }), undefined);
});

const g = buildIndex(sampleModel());
const flow = trace(g, { service: 'demo-rpc-caller', ingress: 'in.sync' }, { scope: 'full' })!;
const calls = flow.messages.filter((m: any) => m.kind === 'egress');

test('trace: the rpc messages carry carrier, carrierVia and carrierAt (additive); no carrier, none', () => {
  const [a, b] = calls as any[];
  assert.deepEqual([a.transport, a.carrier, a.carrierVia, a.carrierAt, a.target.service], ['rpc', 'http', 'saferxlib', 'POST /internal/rpc', 'demo-rpc-server']);
  assert.deepEqual([b.transport, b.carrier, b.carrierVia, b.carrierAt], ['rpc', undefined, undefined, undefined]);
  assert.ok(!('rpc' in a), 'not an AMQP rpc');
});

test('Info texts of the two steps are built from the trace fields', () => {
  const [a, b] = calls as any[];
  const text = (m: any) => rpcTransportText({ carrier: m.carrier, via: m.carrierVia, at: m.carrierAt, service: m.target?.service });
  assert.equal(text(a), 'RPC over HTTP (POST /internal/rpc on demo-rpc-server, via saferxlib)');
  assert.equal(text(b), 'RPC (carrier unknown)');
});

test('get_call (callView) and the endpoint info carry the carrier', () => {
  const v: any = callView(g, { endpoints: {} } as any, 'demo-rpc-caller', 'out.rpc.profile');
  assert.deepEqual([v.egress.carrier, v.egress.via], ['http', 'saferxlib']);
  assert.ok(!('carrier' in callView(g, { endpoints: {} } as any, 'demo-rpc-caller', 'out.rpc.legacy')!.egress));
  const info: any = endpointInfo(g, 'demo-rpc-server', 'in.rpc', []);
  assert.equal(info.rpcCalled.text, 'Called as RPC over HTTP by 1 caller');
  assert.deepEqual(info.rpcCalled.callers, [{ service: 'demo-rpc-caller', egress: 'out.rpc.profile', carrier: 'http', via: 'saferxlib' }]);
  assert.equal((endpointInfo(g, 'demo-rpc-server', 'in.legacyRpc', []) as any).rpcCalled.text, 'Called as RPC by 1 caller (carrier unknown)');
  assert.equal(rpcCalledOf(g, g.model.ingress.find((i) => i.service === 'demo-rpc-caller')!), null, 'nobody calls the caller as rpc');
});

test('REST: trace and endpoint info expose the fields', async () => {
  const app = await startApp();
  try {
    for (const f of ['demo-rpc-caller', 'demo-rpc-server']) assert.equal((await app.call('POST', '/api/ingest', readSample(`${f}.json`))).status, 201);
    const t = (await app.call('GET', '/api/envs/prod/trace?detail=full&service=demo-rpc-caller&ingress=in.sync')).body;
    const m = t.messages.find((x: any) => x.transport === 'rpc');
    assert.deepEqual([m.carrier, m.carrierVia, m.carrierAt], ['http', 'saferxlib', 'POST /internal/rpc']);
  } finally { await app.close(); }
});
