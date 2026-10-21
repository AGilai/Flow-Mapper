// Core graph logic against the sample system.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { keyMatches, specificity, compareSpecificity } from '../core/glob.ts';
import { health } from '../core/health.ts';
import { trace } from '../core/trace.ts';
import { findPaths } from '../core/paths.ts';
import { systemGraph } from '../core/system-graph.ts';
import { suggestPriority } from '../core/impact.ts';
import { integrityErrors } from '../core/integrity.ts';
import { dtoSlots } from '../core/endpoint-info.ts';
import type { Model } from '../core/types.ts';
import { sampleManifests } from './helpers.ts';

function sampleModel(): Model {
  const model: Model = { env: 'prod', services: [], functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [] };
  for (const m of sampleManifests()) {
    model.services.push({ ...m.service, version: m.version, harvestedAt: m.harvestedAt });
    for (const l of ['functions', 'ingress', 'egress', 'resources', 'channels', 'bindings'] as const)
      for (const e of m[l] ?? []) (model[l] as any[]).push({ ...e, service: m.service.name, ...(l === 'functions' ? { steps: e.steps ?? [] } : {}) });
  }
  return model;
}

test('glob matching', () => {
  assert.ok(keyMatches('http:GET public/api/users/**', 'glob', 'http:GET public/api/users/{id}/contact'));
  assert.ok(keyMatches('sns:*-events', 'glob', 'sns:order-events'));
  assert.ok(!keyMatches('sns:*-events', 'glob', 'sns:payment-disputes'));
  assert.ok(!keyMatches('amqp:x/a.*', 'glob', 'amqp:x/a.b/c'), '* does not cross /');
  assert.ok(keyMatches('a.b', 'exact', 'a.b') && !keyMatches('a.*', undefined, 'a.b'));
  assert.ok(compareSpecificity(specificity('x/a/*', 'glob'), specificity('x/**', 'glob')) > 0);
});

test('resolution over the samples finds the planted problems', () => {
  const g = buildIndex(sampleModel());
  const h = health(g);
  assert.deepEqual(h.items.dangling.map((d) => `${d.service}:${d.id}`).sort(), ['cp-middleware:firmwareUpdated.publish', 'cp-middleware:geo.locate', 'orders-svc:users.getPrefs', 'payments-svc:disputes.publish']); // the first two: the 0.18.0 RabbitMQ demo (a publish no binding matches, an RPC nobody serves)
  assert.deepEqual(h.items.orphans.map((d) => `${d.service}:${d.id}`).sort(), ['orders-svc:in.touch', 'payments-svc:in.legacyRefund', 'users-svc:in.getPosture', 'users-svc:in.getUser']); // in.getPosture: the 0.25.0 demo endpoint (a prod endpoint nothing calls)
  assert.deepEqual(h.items.unbound.map((u) => u.bindKey).sort(), ['sns:payment-disputes', 'sqs:orders-dlq']);
  assert.equal(h.totals.ambiguous, 0);
});

test('unicast picks the most specific match; ties are ambiguous', () => {
  const m = sampleModel();
  m.ingress.push({ service: 'users-svc', id: 'in.wild', bindKey: 'http:GET users-svc/users/*/contact', match: 'glob', transport: 'http', handler: 'get_contact' });
  let g = buildIndex(m);
  const contact = g.resolution.links.filter((l) => l.from.type === 'egress' && l.from.service === 'api-gateway' && l.from.id === 'users.contact');
  assert.equal(contact.length, 1);
  assert.equal((contact[0].to as any).id, 'in.getContact', 'exact beats glob');
  m.ingress.push({ service: 'users-svc', id: 'in.dupe', bindKey: 'http:GET users-svc/users/{id}/contact', transport: 'http', handler: 'get_contact' });
  g = buildIndex(m);
  // every caller of the tied key is ambiguous: the gateway and catalog-svc's reviewer lookup
  assert.deepEqual(g.resolution.ambiguous.map((a) => a.egress.service).sort(), ['api-gateway', 'catalog-svc']);
});

test('full trace follows REST, SNS→SQS fan-out and AMQP into other services', () => {
  const g = buildIndex(sampleModel());
  const t = trace(g, { service: 'api-gateway', ingress: 'in.createOrder' }, { scope: 'full' })!;
  const ids = t.participants.map((p) => p.id);
  for (const p of ['svc:orders-svc', 'svc:inventory-svc', 'svc:payments-svc', 'ch:sns:order-events', 'svc:shipping-svc', 'svc:notifications-svc', 'svc:analytics-svc'])
    assert.ok(ids.includes(p), `missing ${p}`);
  assert.ok(t.messages.some((m) => m.broken && m.to === 'missing:http:GET users-svc/users/{id}/prefs'));
  assert.ok(t.messages.some((m) => m.mode === 'async' && m.to === 'ch:sns:order-events'));
});

test('a subscription declared by both the topic owner and the consumer is drawn once (#33)', () => {
  const g = buildIndex(sampleModel());
  const t = trace(g, { service: 'api-gateway', ingress: 'in.createOrder' }, { scope: 'full' })!;
  const hop = t.messages.filter((m) => m.from === 'ch:sns:order-events' && m.to === 'ch:sqs:shipping-order-events');
  assert.equal(hop.length, 1);
  const keys = t.messages.map((m) => [m.from, m.to, m.label, m.kind, m.service, m.fn, m.seq, m.depth].join('|'));
  assert.equal(new Set(keys).size, keys.length, 'no arrow is drawn twice');
});

test('intra trace stays inside the service', () => {
  const g = buildIndex(sampleModel());
  const t = trace(g, { service: 'orders-svc', ingress: 'in.create' }, { scope: 'intra' })!;
  const fns = t.participants.filter((p) => p.kind === 'function').map((p) => p.label);
  assert.deepEqual(fns.sort(), ['OrderController.create', 'OrderService.place', 'OrderService.validate']);
  assert.ok(!t.participants.some((p) => p.id === 'svc:shipping-svc'), 'does not cross into downstream services');
});

test('paths go through queues', () => {
  const g = buildIndex(sampleModel());
  const p = findPaths(g, 'orders-svc', 'notifications-svc');
  assert.ok(p.length >= 1);
  assert.deepEqual(p[0].map((h) => h.to), ['shipping-svc', 'notifications-svc']);
  assert.ok(p[0][0].via.includes('sns:order-events'));
});

test('system graph marks broken edges and collapses channels', () => {
  const sg = systemGraph(buildIndex(sampleModel()));
  assert.ok(sg.nodes.some((n) => n.kind === 'missing'));
  assert.ok(sg.edges.some((e) => e.broken));
  assert.ok(sg.collapsedEdges.some((e) => e.from === 'svc:orders-svc' && e.to === 'svc:shipping-svc'));
});

test('system graph edge calls carry egress and ingress ids and subscription filters', () => {
  const sg = systemGraph(buildIndex(sampleModel()));
  const call = sg.collapsedEdges.find((e) => e.from === 'svc:orders-svc' && e.to === 'svc:shipping-svc')!.endpoints[0];
  assert.ok(call.egress && call.ingress);
  assert.ok(sg.edges.some((e) => e.endpoints.some((p) => p.filter)), 'a hop through a filtered subscription reports its filter');
});

test('priority suggestion', () => {
  assert.equal(suggestPriority('S1', 5, 10), 'P0');
  assert.equal(suggestPriority('S1', 0, 10), 'P1');
  assert.equal(suggestPriority('S3', 1, 100), 'P2');
  assert.equal(suggestPriority('S4', 0, 10), 'P3');
});

test('integrity catches broken references', () => {
  const errs = integrityErrors({ functions: [{ id: 'a', steps: [{ seq: 1, type: 'call', target: 'nope' }] }], ingress: [{ id: 'i', bindKey: 'http:GET a/x', handler: 'x' }] });
  assert.equal(errs.length, 2);
  // a missing bind key or step target is fine only when `unresolved` explains it
  const gap = { what: 'target', reason: 'no_endpoint' };
  assert.equal(integrityErrors({ functions: [{ id: 'a', steps: [{ seq: 1, type: 'egress' }] }], egress: [{ id: 'e' }], ingress: [{ id: 'i', handler: 'a' }] }).length, 3);
  assert.deepEqual(integrityErrors({ functions: [{ id: 'a', steps: [{ seq: 1, type: 'egress', unresolved: [gap] }] }], egress: [{ id: 'e', unresolved: [gap] }], ingress: [{ id: 'i', handler: 'a', unresolved: [gap] }] }), []);
});

test('rpc is a synchronous request/reply transport with request and response DTOs', () => {
  const g = buildIndex(sampleModel());
  const link = g.resolution.links.find((l) => l.from.type === 'egress' && l.from.id === 'inventory.checkStock');
  assert.deepEqual([link?.to, link?.mode, link?.transport], [{ type: 'ingress', service: 'inventory-svc', id: 'in.rpc.checkStock' }, 'sync', 'rpc']);
  const i = g.model.ingress.find((x) => x.id === 'in.rpc.checkStock')!;
  assert.deepEqual(dtoSlots(i).slots.map((s) => s.role), ['request', 'response']);
});
