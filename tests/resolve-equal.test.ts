// perf F1: the indexed resolve() gives the same Resolution as the old O(egress x ingress) one (tests/resolve-reference.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, withPlaceholderKeys } from '../core/resolve.ts';
import { resolve as reference } from './resolve-reference.ts';
import { generateMock } from '../scripts/mock/generate.ts';
import { sampleModel } from './helpers.ts';
import type { Model } from '../core/types.ts';

function modelOf(manifests: any[]): Model {
  const model: any = { env: 'x', services: [], functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [] };
  for (const m of manifests) {
    model.services.push({ ...m.service, version: m.version, harvestedAt: m.harvestedAt });
    for (const l of ['functions', 'ingress', 'egress', 'resources', 'channels', 'bindings'])
      for (const e of m[l] ?? []) model[l].push({ ...e, service: m.service.name, ...(l === 'functions' ? { steps: e.steps ?? [] } : {}) });
  }
  return model;
}

function same(model: Model, what: string) {
  const m = withPlaceholderKeys(model);
  const a = resolve(m), b = reference(m);
  assert.deepEqual(a, b, what);
  return b;
}

test('indexed resolve equals the reference on the samples', () => assert.ok(same(sampleModel(), 'samples').links.length > 0));

test('indexed resolve equals the reference on mock data', () => {
  for (const [services, seed] of [[30, 1], [125, 1], [80, 7]]) same(modelOf(generateMock({ services, seed })), `mock ${services}/${seed}`);
});

test('indexed resolve equals the reference on random keys, patterns and ties', () => {
  let s = 12345;
  const rnd = (n: number) => ((s = (s * 1664525 + 1013904223) >>> 0) % n);
  const word = () => ['a', 'b', 'c', 'x.y', 'x.z'][rnd(5)];
  const keyOf = () => `amqp:ex${rnd(2)}/${word()}.${word()}`;
  const plainKey = () => `http:GET ${word()}/${word()}`;
  const patOf = (k: string) => (rnd(2) ? k : k.replace(/\.[^./]+$/, '.*').replace(/\/[^/]+$/, rnd(2) ? '/**' : '/*'));
  const modeOf = () => ['exact', 'glob', 'amqp-topic', undefined][rnd(4)];
  let links = 0, ambiguous = 0, unbound = 0;
  for (let round = 0; round < 60; round++) {
    const model: any = { env: 'x', services: [], functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [] };
    for (let i = 0; i < 40; i++) {
      const k = rnd(2) ? keyOf() : plainKey();
      const match = modeOf();
      const unresolved = rnd(5) ? {} : { unresolved: [{ what: 'target', reason: 'dynamic' }] };
      model.ingress.push({ service: `s${rnd(5)}`, id: `i${i}`, transport: rnd(2) ? 'http' : 'amqp', bindKey: match === 'glob' || match === 'amqp-topic' ? patOf(k) : k, ...(match ? { match } : {}), ...unresolved });
    }
    for (let i = 0; i < 40; i++) {
      model.egress.push({ service: `s${rnd(5)}`, id: `e${i}`, transport: ['http', 'amqp', 'sns', 'sqs'][rnd(4)], bindKey: rnd(2) ? keyOf() : plainKey(), ...(rnd(4) ? {} : { delivery: 'multicast' }) });
    }
    for (const [n, kind] of [['q0', 'amqp-queue'], ['q1', 'sqs-queue'], ['t0', 'sns-topic']] as const)
      model.channels.push({ service: 's0', id: n, kind, bindKey: n === 'q0' ? 'amqp:ex0/a.b' : `${kind}:${n}` });
    model.channels.push({ service: 's0', id: 'ex0', kind: 'amqp-exchange', bindKey: 'amqp:ex0' }, { service: 's0', id: 'ex1', kind: 'amqp-exchange', bindKey: 'amqp:ex1/x', details: { type: 'direct' } });
    for (let i = 0; i < 15; i++) {
      const k = rnd(3) ? keyOf() : 'sns:t0';
      const match = modeOf();
      model.bindings.push({ service: `s${rnd(5)}`, id: `b${i}`, from: match === 'glob' || match === 'amqp-topic' ? patOf(k) : k, ...(match ? { match } : {}), to: rnd(2) ? 'amqp:ex0/a.b' : keyOf() });
    }
    const r = same(model, `random round ${round}`);
    links += r.links.length; ambiguous += r.ambiguous.length; unbound += r.unbound.length;
  }
  assert.ok(links > 100 && ambiguous > 0 && unbound > 0, `the random data exercises links, ties and unbound (${links}/${ambiguous}/${unbound})`);
});
