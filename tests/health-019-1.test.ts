// 0.19.1: an RPC command nobody calls is an entry point (not "never called"); the socket demo publishes to a handled queue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { health } from '../core/health.ts';
import { handlerFor } from '../core/events.ts';
import { sampleModel } from './helpers.ts';

test('an RPC command with no caller is not listed as never called', () => {
  const m = sampleModel();
  m.ingress.push({ service: 'dpc-worker', id: 'in.rpcNobody', bindKey: 'amqp-rpc:rpc.dpc.nobody.calls', transport: 'amqp', handler: 'h' } as any);
  const g = buildIndex(m);
  assert.ok(!g.resolution.orphans.some((i) => i.id === 'in.rpcNobody'));
  assert.ok(!health(g).items.orphans.some((o) => o.id === 'in.rpcNobody'));
  // an ordinary ingress with no caller still is
  m.ingress.push({ service: 'dpc-worker', id: 'in.plain', bindKey: 'sqs:nobody-sends', transport: 'sqs', handler: 'h' } as any);
  assert.ok(health(buildIndex(m)).items.orphans.some((o) => o.id === 'in.plain'));
});

test('the sdp-controller device-connect publish reaches a consumer that handles the event', () => {
  const g = buildIndex(sampleModel());
  const e = g.model.egress.find((x) => x.service === 'sdp-controller' && x.id === 'tenant.notify')!;
  const consumers = g.model.ingress.filter((i) => i.transport === 'sqs' && i.bindKey === e.bindKey);
  assert.ok(consumers.length > 0);
  assert.ok(consumers.every((i) => handlerFor(i, 'device.connected')));
});
