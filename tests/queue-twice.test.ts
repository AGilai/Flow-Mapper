// Bug #35: an egress straight to a queue that a service also consumes is drawn once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { sampleManifests } from './helpers.ts';
import type { Model } from '../core/types.ts';

function sampleModel(): Model {
  const model: Model = { env: 'prod', services: [], functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [] };
  for (const m of sampleManifests()) {
    model.services.push({ ...m.service, version: m.version, harvestedAt: m.harvestedAt });
    for (const l of ['functions', 'ingress', 'egress', 'resources', 'channels', 'bindings'] as const)
      for (const e of m[l] ?? []) (model[l] as any[]).push({ ...e, service: m.service.name, ...(l === 'functions' ? { steps: e.steps ?? [] } : {}) });
  }
  return model;
}

test('a queue or topic lifeline sits left of what it delivers to, in every sample trace (#35)', () => {
  const g = buildIndex(sampleModel());
  for (const i of g.model.ingress) {
    const t = trace(g, { service: i.service, ingress: i.id }, { scope: 'full' })!;
    const at = (id: string) => t.participants.findIndex((p) => p.id === id);
    // A target met earlier on the trace (it is also an upstream caller, or a queue fed by two topics) cannot be on both sides: that arrow may point left (#35).
    t.messages.forEach((m, k) => {
      if (!m.from.startsWith('ch:') || m.from === m.to) return;
      const earlier = t.messages.slice(0, k).some((x) => x.from === m.to || x.to === m.to) || (m.to.startsWith('svc:') && t.messages.some((x) => x.cycle && x.to === m.to)); // or a consumer the saga loops back into
      assert.ok(at(m.from) < at(m.to) || earlier, `${i.service}/${i.id}: ${m.from} before ${m.to}`);
    });
  }
});

test('with queues hidden the send is one arrow from the sender to the consumer (#35)', async () => {
  const { bridgeChannels } = await import('../web/js/views/sequence-render.js');
  const g = buildIndex(sampleModel());
  const t = trace(g, { service: 'account-lambda-erase-controller', ingress: 'in.notifyBilling' }, { scope: 'full' })!;
  const hops = bridgeChannels(t.messages).filter((m: any) => m.kind === 'egress').map((m: any) => `${m.from} > ${m.to}`);
  assert.deepEqual(hops, ['svc:account-lambda-erase-controller > svc:billing-eraser']);
  const o = trace(g, { service: 'api-gateway', ingress: 'in.createOrder' }, { scope: 'full' })!;
  assert.ok(!bridgeChannels(o.messages).some((m: any) => m.to === 'ch:sns:order-events'), 'the topic is bridged');
});

test('one send to a queue a service consumes: service > queue > consumer, no direct arrow (#35)', () => {
  const g = buildIndex(sampleModel());
  const t = trace(g, { service: 'account-lambda-erase-controller', ingress: 'in.notifyBilling' }, { scope: 'full' })!;
  const hops = t.messages.filter((m) => m.kind === 'egress' || m.kind === 'deliver').map((m) => `${m.from} > ${m.to}`);
  assert.deepEqual(hops, ['svc:account-lambda-erase-controller > ch:sqs:billing-erase-priority10', 'ch:sqs:billing-erase-priority10 > svc:billing-eraser']);
});
