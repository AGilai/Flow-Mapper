// flowCounts (reachability) must agree with the components a Full-flow trace draws.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace, entryPoints } from '../core/trace.ts';
import { flowCounts, describeCount } from '../core/flow-counts.ts';
import type { Model } from '../core/types.ts';
import { generateMock } from '../scripts/mock/generate.ts';
import { sampleManifests } from './helpers.ts';

function modelOf(manifests: any[]): Model {
  const model: Model = { env: 'prod', services: [], functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [] };
  for (const m of manifests) {
    model.services.push({ ...m.service, version: m.version, harvestedAt: m.harvestedAt });
    for (const l of ['functions', 'ingress', 'egress', 'resources', 'channels', 'bindings'] as const)
      for (const e of m[l] ?? []) (model[l] as any[]).push({ ...e, service: m.service.name, ...(l === 'functions' ? { steps: e.steps ?? [] } : {}) });
  }
  return model;
}

/** What a default Full-flow trace touches: services, channels, stores (not clients, gaps or broken targets). */
function traced(g: ReturnType<typeof buildIndex>, service: string, ingress: string) {
  const t = trace(g, { service, ingress }, { scope: 'full', maxDepth: 1000, maxMessages: 100000 })!;
  assert.ok(!t.truncated);
  return t.participants.filter((p) => ['service', 'channel', 'resource'].includes(p.kind)).map((p) => p.id).sort();
}

function check(g: ReturnType<typeof buildIndex>) {
  const counts = flowCounts(g);
  assert.equal(counts.length, entryPoints(g).length);
  for (const c of counts) {
    const ids = traced(g, c.service, c.ingress);
    const by = (p: string) => ids.filter((x) => x.startsWith(p)).length;
    assert.equal(c.total, ids.length, `${c.service}:${c.ingress} total`);
    assert.equal(c.services, by('svc:'), `${c.service}:${c.ingress} services`);
    assert.equal(c.stores, by('res:'), `${c.service}:${c.ingress} stores`);
    assert.equal(c.topics + c.queues + c.buses + c.otherChannels, by('ch:'), `${c.service}:${c.ingress} channels`);
  }
  return counts;
}

test('flow counts equal the components of a full trace, for every sample entry point', () => {
  const counts = check(buildIndex(modelOf(sampleManifests())));
  assert.ok(counts.length > 5 && counts.some((c) => c.total > 3));
});

test('flow counts equal the components of a full trace on the mock system', () => {
  check(buildIndex(modelOf(generateMock({ services: 40, seed: 7, env: 'prod' }))));
});

test('flow counts: computed once per graph; tooltip text', () => {
  const g = buildIndex(modelOf(sampleManifests()));
  assert.deepEqual(flowCounts(g), flowCounts(g));
  assert.equal(describeCount({ service: 'a', ingress: 'b', total: 8, services: 4, topics: 2, queues: 1, buses: 0, stores: 1, otherChannels: 0 }), '4 services, 2 topics, 1 queue, 1 store');
});
