// Perf batch 2: the indexed / memoised code gives exactly what the scanning code it replaced gave. Each check keeps the old
// algorithm as a reference and compares on the samples and on a generated 125-service system.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, itemsOf, subscriptionsOf } from '../core/graph-index.ts';
import { health, healthCounts } from '../core/health.ts';
import { drift, mixedCommits, mixedCommitsOf, driftOf } from '../core/harvest-quality.ts';
import { deliveriesBetween, eventFromTypes, eventReport, eventTypes, boundValues } from '../core/events.ts';
import { keyMatches } from '../core/glob.ts';
import { carryChannelKeys } from '../core/carry-channels.ts';
import { channelsFor } from '../core/channels-for.ts';
import { carryRows } from '../core/neighbours.ts';
import { systemGraph } from '../core/system-graph.ts';
import { inventory } from '../core/inventory.ts';
import { stores } from '../core/stores.ts';
import { rowsToModel } from '../core/item-rows.ts';
import { loadModel } from '../server/store/snapshots.ts';
import { envItemRows } from '../server/store/item-rows.ts';
import { generateMock } from '../scripts/mock/generate.ts';
import { sampleManifests, sampleModel, startApp } from './helpers.ts';

function mockModel(n = 125): any {
  const model: any = { env: 'm', services: [], functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [] };
  for (const m of generateMock({ services: n, seed: 7, env: 'm' })) {
    model.services.push({ ...m.service, version: m.version, harvestedAt: m.harvestedAt, commit: m.commit });
    for (const l of ['functions', 'ingress', 'egress', 'resources', 'channels', 'bindings']) for (const e of m[l] ?? []) model[l].push({ ...e, service: m.service.name, ...(l === 'functions' ? { steps: e.steps ?? [] } : {}) });
  }
  return model;
}
const graphs = () => [['samples', buildIndex(sampleModel())], ['mock125', buildIndex(mockModel())]] as const;

// the reference: the code before batch 2
const oldMixed = (g: any) => {
  const out = [];
  for (const s of g.model.services) {
    const counts = new Map<string, number>();
    const add = (c?: string) => { if (c && c !== s.commit) counts.set(c, (counts.get(c) ?? 0) + 1); };
    const mine = (xs: any[]) => xs.filter((x) => x.service === s.name);
    for (const f of mine(g.model.functions)) add(f.commit);
    for (const x of [...mine(g.model.ingress), ...mine(g.model.egress), ...mine(g.model.resources), ...mine(g.model.channels), ...mine(g.model.bindings)]) add(x.source?.commit);
    if (counts.size) out.push({ service: s.name, commit: s.commit, others: [...counts].map(([commit, items]) => ({ commit, items })) });
  }
  return out;
};
const oldDrift = (g: any) => {
  const m = g.model;
  return [
    ...m.ingress.map((x: any) => ({ service: x.service, kind: 'ingress', id: x.id, provenance: x.provenance })),
    ...m.egress.map((x: any) => ({ service: x.service, kind: 'egress', id: x.id, provenance: x.provenance })),
    ...m.resources.map((x: any) => ({ service: x.service, kind: 'resource', id: x.id, provenance: x.provenance })),
    ...m.channels.map((x: any) => ({ service: x.service, kind: 'channel', id: x.bindKey, provenance: x.provenance })),
    ...m.bindings.map((x: any) => ({ service: x.service, kind: 'binding', id: x.id, provenance: x.provenance })),
  ].filter((r: any) => r.provenance?.verified === 'drift');
};

test('byService lists are the per-service filters of the model, in order', () => {
  for (const [name, g] of graphs()) {
    for (const s of g.model.services) for (const l of ['functions', 'ingress', 'egress', 'resources', 'channels', 'bindings'] as const) {
      assert.deepEqual(itemsOf(g, s.name)[l], (g.model[l] as any[]).filter((x) => x.service === s.name), `${name} ${s.name} ${l}`);
    }
    assert.deepEqual(itemsOf(g, 'no-such-service').functions, []);
  }
});

test('eventFromTypes (stepsToEgress) equals the scan over all functions', () => {
  for (const [name, g] of graphs()) {
    for (const e of g.model.egress) {
      const out = new Set<string>();
      for (const f of g.model.functions) if (f.service === e.service) for (const st of f.steps) if (st.type === 'egress' && st.target === e.id && st.eventFrom) for (const v of boundValues(g, f.service, f.id, st.eventFrom)) out.add(v);
      assert.deepEqual(eventFromTypes(g, e), [...out], `${name} ${e.service}:${e.id}`);
    }
  }
});

test('mixedCommits / drift per service equal the whole-env versions', () => {
  for (const [name, g] of graphs()) {
    assert.deepEqual(mixedCommits(g), oldMixed(g), `${name} mixedCommits`);
    assert.deepEqual(drift(g), oldDrift(g), `${name} drift`);
    for (const s of g.model.services) {
      assert.deepEqual(mixedCommitsOf(g, s.name), oldMixed(g).find((x) => x.service === s.name) ?? null);
      assert.deepEqual(driftOf(g, s.name), oldDrift(g).filter((d: any) => d.service === s.name));
    }
  }
  // the mock has no drift or mixed commits of its own: plant some
  const m = mockModel(30);
  m.egress[0].source = { file: 'a.ts', commit: 'other' }; m.ingress[1].provenance = { verified: 'drift' }; m.functions[2].commit = 'zzz'; m.bindings[0] && (m.bindings[0].provenance = { verified: 'drift' });
  const g = buildIndex(m);
  assert.ok(mixedCommits(g).length && drift(g).length);
  assert.deepEqual(mixedCommits(g), oldMixed(g));
  assert.deepEqual(drift(g), oldDrift(g));
  for (const s of g.model.services) assert.deepEqual(driftOf(g, s.name), oldDrift(g).filter((d: any) => d.service === s.name));
});

test('subscriptionsOf equals the keyMatches filter over all bindings', () => {
  for (const [name, g] of graphs()) {
    const keys = new Set<string>([...g.channels.keys(), ...g.model.egress.map((e) => e.bindKey), 'nothing', 'amqp:x/a.b.c']);
    for (const k of keys) assert.deepEqual(subscriptionsOf(g, k), g.model.bindings.filter((b) => keyMatches(b.from, b.match, k)), `${name} ${k}`);
  }
});

test('egressByKey, deliveriesBetween and healthCounts equal their scans', () => {
  for (const [name, g] of graphs()) {
    for (const [k, es] of g.egressByKey) assert.deepEqual(es, g.model.egress.filter((e) => e.bindKey === k));
    assert.equal([...g.egressByKey.values()].reduce((n, l) => n + l.length, 0), g.model.egress.length);
    const ds = eventReport(g).deliveries;
    for (const d of ds.slice(0, 400)) {
      const p = d.producer, c = d.consumer;
      assert.deepEqual(deliveriesBetween(g, p, c), ds.filter((x) => x.producer.service === p.service && x.producer.egress === p.egress && x.consumer.service === c.service && x.consumer.ingress === c.ingress), name);
    }
    assert.deepEqual(deliveriesBetween(g, { service: 'a', egress: 'b' }, { service: 'c', ingress: 'd' }), []);
    const full = health(g).services;
    assert.deepEqual(healthCounts(g), full.map((s) => ({ service: s.service, version: s.version, egress: s.egress, dangling: s.dangling, orphans: s.orphans, unbound: s.unbound })), `${name} healthCounts`);
  }
});

test('carryChannelKeys equals channelsFor(model, {service}).all for every service', () => {
  for (const model of [sampleModel(), mockModel(), mockModel(40)]) {
    const got = carryChannelKeys(model);
    for (const s of model.services) assert.deepEqual(got.get(s.name), [...channelsFor(model, new Set([s.name])).all], s.name);
    const rows = carryRows(model, { [model.services[0].name]: 3 });
    assert.equal(rows.length, model.services.length);
    assert.deepEqual(rows[0].counts.dtos, 3);
  }
});

test('reports are memoised per graph and recomputed for a new graph', () => {
  const g = buildIndex(sampleModel()), g2 = buildIndex(sampleModel());
  assert.equal(health(g), health(g));
  assert.equal(systemGraph(g), systemGraph(g));
  assert.equal(stores(g), stores(g));
  assert.equal(eventTypes(g), eventTypes(g));
  assert.equal(inventory(g), inventory(g));
  assert.notEqual(inventory(g), inventory(g, ['Some.Event']), 'the DTO set is part of the key');
  assert.notEqual(health(g), health(g2));
  assert.deepEqual(health(g), health(g2));
  assert.deepEqual(systemGraph(g), systemGraph(g2));
  assert.deepEqual(inventory(g), inventory(g2));
  // the inventory's other inputs are part of its key
  const withDto = inventory(g, ['Some.Event'], new Map());
  assert.equal(withDto, inventory(g, ['Some.Event'], new Map()));
});

test('an ingest hands its graph to the cache: same graph as a fresh build, same health history', async () => {
  const app = await startApp();
  try {
    const r = await app.call('POST', '/api/ingest', { manifests: sampleManifests() });
    assert.equal(r.status, 201);
    const cached = app.ctx.graph('prod'), fresh = buildIndex(loadModel(app.ctx.db, 'prod'));
    assert.equal(JSON.stringify(cached.model), JSON.stringify(fresh.model));
    assert.equal(JSON.stringify(cached.resolution), JSON.stringify(fresh.resolution));
    const rows = app.ctx.db.prepare('SELECT service, version, egress, dangling, orphans, unbound FROM health_history WHERE env = ? ORDER BY rowid').all('prod') as any[];
    assert.deepEqual(rows.map((r) => ({ ...r })), healthCounts(fresh));
    // a dry run changes nothing and leaves no graph behind
    const before = rows.length;
    const m = sampleManifests()[0]; m.version += 100;
    assert.equal((await app.call('POST', '/api/ingest?dryRun=1', m)).status, 200);
    assert.equal((app.ctx.db.prepare('SELECT count(*) AS n FROM health_history').get() as any).n, before);
    assert.equal(JSON.stringify(app.ctx.graph('prod').model), JSON.stringify(fresh.model));
  } finally { await app.close(); }
});

test('the rows of an environment come back in key order (marks do not depend on the planner)', async () => {
  const app = await startApp();
  try {
    await app.call('POST', '/api/ingest', { manifests: sampleManifests() });
    const rows = envItemRows(app.ctx.db, 'prod').filter((r) => r.list !== 'header' && !['dto', 'schema'].includes(r.list));
    const key = (r: any) => [r.service, r.list, r.key].join('\u0000');
    const entities = rows.filter((r) => ['functions', 'ingress', 'egress', 'resources', 'channels', 'bindings'].includes(r.list));
    assert.deepEqual(entities.map(key), [...entities.map(key)].sort());
    assert.ok(rowsToModel('prod', envItemRows(app.ctx.db, 'prod')).services.length);
  } finally { await app.close(); }
});
