// 0.17.4 (#46): ingress transport `socket`: an entry point by default, no producer searched, caller outside the system.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace, entryPoints } from '../core/trace.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS module shared with the browser
import { callerFor } from '../web/js/views/flow-sub.js';

const g = buildIndex(sampleModel());

test('socket ingress is an entry point by default and never "never called"', () => {
  const eps = entryPoints(g).filter((e) => e.service === 'sdp-controller');
  assert.deepEqual(eps.map((e) => [e.id, e.transport, e.entryPoint]), [['in.deviceConnect', 'socket', true], ['in.deviceTimeout', 'socket', true]]);
  assert.deepEqual(eps[0].middleware, ['verifyClientCert', 'checkDeviceToken']);
  assert.ok(!g.resolution.orphans.some((i) => i.service === 'sdp-controller'));
});

test('trace of a socket event: client caller outside the system, middleware chain, store, publish to SQS', () => {
  const t = trace(g, { service: 'sdp-controller', ingress: 'in.deviceConnect' }, { scope: 'full' })!;
  const first = t.messages[0] as any;
  assert.deepEqual([first.kind, first.transport, first.protocol], ['entry', 'socket', 'tls']);
  assert.equal(first.middlewareChain.length, 2);
  assert.equal(t.participants.find((p) => p.id === 'client')!.label, 'client');
  assert.ok(t.messages.some((m) => m.kind === 'resource'));
  assert.ok(t.messages.some((m) => m.kind === 'egress' && m.transport === 'sqs'));
  const c = callerFor(first);
  assert.deepEqual([c.label, c.sub, c.kind], ['client', 'tls socket', 'client']);
  assert.equal(callerFor({ kind: 'entry', transport: 'socket', label: 'x' }).sub, 'tcp socket');
});

test('an explicit entryPoint: false on a socket ingress is kept', () => {
  const m = sampleModel();
  m.ingress.find((i: any) => i.id === 'in.deviceTimeout').entryPoint = false;
  const g2 = buildIndex(m);
  assert.ok(g2.resolution.orphans.some((i) => i.id === 'in.deviceTimeout'));
});
