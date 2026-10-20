// Contract report: what a manifest leaves out or cannot link (core/contract.ts), and how ingest returns it.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { contractReport, type ServiceManifest } from '../core/contract.ts';
import type { Model } from '../core/types.ts';
import { sampleManifests, startApp } from './helpers.ts';

const model = (over: Partial<Model>): Model => ({ env: 't', services: [], functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [], ...over });
const src = { file: 'a.ts', line: 1 };
const codes = (m: ServiceManifest, over: Partial<Model>) => contractReport(m, buildIndex(model(over))).findings;
const has = (fs: { code: string }[], code: string) => fs.filter((f) => f.code === code);

test('a clean manifest has no findings', () => {
  const m: ServiceManifest = {
    service: 'a', functions: [{ id: 'f', file: 'f.ts', steps: [{ seq: 1, type: 'egress', target: 'out' }] }],
    ingress: [{ id: 'in', bindKey: 'http:GET a/x', source: src }], egress: [{ id: 'out', bindKey: 'http:GET a/x', transport: 'http', source: src }],
  };
  const r = contractReport(m, buildIndex(model({
    ingress: [{ service: 'a', id: 'in', bindKey: 'http:GET a/x', transport: 'http', handler: 'f', source: src }],
    egress: [{ service: 'a', id: 'out', bindKey: 'http:GET a/x', transport: 'http', source: src }],
  })));
  assert.deepEqual(r, { errors: 0, warnings: 0, infos: 0, findings: [] });
});

test('an unresolved entry needs a detail', () => {
  const m: ServiceManifest = { service: 'a', egress: [{ id: 'e', transport: 'http', source: src, unresolved: [{ what: 'target', reason: ' ', detail: 'x' }, { what: 'event', reason: 'r', detail: '' }] }] };
  const fs = has(codes(m, {}), 'unresolved-no-detail');
  assert.equal(fs.length, 2);
  assert.ok(fs.every((f) => f.level === 'warn'));
});

test('an unknown detail path is warned about, a known one is not', () => {
  const m: ServiceManifest = { service: 'a', resources: [{ id: 'r', kind: 'redis', name: 'r', source: src, unresolved: [
    { what: 'detail', reason: 'x', detail: 'details.keyTemplate' }, { what: 'detail', reason: 'x', detail: 'details.ttl' }] } as any] };
  const fs = has(codes(m, {}), 'unresolved-detail-unknown-path');
  assert.equal(fs.length, 1);
  assert.equal(fs[0].level, 'warn');
  assert.match(fs[0].message, /details\.ttl/);
});

test('missing source is one finding per service with a count and examples', () => {
  const m: ServiceManifest = { service: 'a', ingress: [1, 2, 3, 4, 5].map((n) => ({ id: `i${n}`, bindKey: `k${n}` })), functions: [{ id: 'f', steps: [{ seq: 1, type: 'call', target: 'g' }] }] };
  const fs = has(codes(m, {}), 'missing-source');
  assert.equal(fs.length, 1);
  assert.equal(fs[0].level, 'info');
  assert.match(fs[0].message, /6 ingress, egress or step/);
  assert.match(fs[0].message, /\+3 more/);
});

const topic = { service: 'infra', bindKey: 'sns:t', kind: 'sns-topic' as const };
const pub = (events?: string[]) => ({ service: 'p', id: 'pub', bindKey: 'sns:t', transport: 'sns' as const, ...(events ? { events } : {}) });

test('subscription binding without events, and publish without events', () => {
  const sub: ServiceManifest = { service: 'infra', bindings: [{ id: 's', from: 'sns:t' }] };
  const fs = codes(sub, { channels: [topic], bindings: [{ service: 'infra', id: 's', from: 'sns:t', to: 'q' }] });
  assert.equal(has(fs, 'binding-no-events')[0]?.level, 'info');
  const p: ServiceManifest = { service: 'p', egress: [{ id: 'pub', bindKey: 'sns:t', transport: 'sns', source: src }] };
  const g = codes(p, { channels: [topic], egress: [pub()] });
  assert.equal(has(g, 'egress-no-events')[0]?.level, 'warn');
  const withEvents = codes({ ...p, egress: [{ ...p.egress![0], events: ['A'] }] }, { channels: [topic], egress: [pub(['A'])] });
  assert.equal(has(withEvents, 'egress-no-events').length, 0);
  const unresolvedEvent = codes({ ...p, egress: [{ ...p.egress![0], unresolved: [{ what: 'event', reason: 'dyn' }] }] }, { channels: [topic], egress: [pub()] });
  assert.equal(has(unresolvedEvent, 'egress-no-events').length, 0);
});

test('a subscription with events: [] delivers nothing', () => {
  const m: ServiceManifest = { service: 'infra', bindings: [{ id: 's', from: 'sns:t', events: [] }] };
  const fs = has(codes(m, { channels: [topic], bindings: [{ service: 'infra', id: 's', from: 'sns:t', to: 'q', events: [] }] }), 'binding-empty-events');
  assert.deepEqual(fs.map((f) => [f.id, f.level]), [['s', 'warn']]);
});

test('dangling egress is reported for this service only', () => {
  const p: ServiceManifest = { service: 'p', egress: [{ id: 'x', bindKey: 'http:GET nowhere', transport: 'http', source: src }] };
  const other = { service: 'q', id: 'y', bindKey: 'http:GET nowhere2', transport: 'http' as const };
  const fs = codes(p, { egress: [{ service: 'p', id: 'x', bindKey: 'http:GET nowhere', transport: 'http' }, other] });
  assert.deepEqual(has(fs, 'dangling-egress').map((f) => [f.service, f.id, f.level]), [['p', 'x', 'warn']]);
});

test('a filter that matches none of the published event types', () => {
  const b = { service: 'infra', id: 's', from: 'sns:t', to: 'q', events: ['Nope'] };
  const m: ServiceManifest = { service: 'infra', bindings: [{ id: 's', from: 'sns:t', events: ['Nope'] }] };
  const fs = codes(m, { channels: [topic], egress: [pub(['A', 'B'])], bindings: [b] });
  assert.equal(has(fs, 'filter-matches-nothing')[0]?.level, 'warn');
  const fine = codes({ ...m, bindings: [{ ...m.bindings![0], events: ['A*'] }] }, { channels: [topic], egress: [pub(['A', 'B'])], bindings: [{ ...b, events: ['A*'] }] });
  assert.equal(has(fine, 'filter-matches-nothing').length, 0);
});

test('mixed commits and drift come from the harvest-quality results', () => {
  const m: ServiceManifest = { service: 'p', egress: [{ id: 'x', bindKey: 'k', transport: 'http', source: { file: 'a', commit: 'other' } }] };
  const fs = codes(m, {
    services: [{ name: 'p', kind: 'service', version: 1, harvestedAt: '', commit: 'main1' }],
    egress: [{ service: 'p', id: 'x', bindKey: 'k', transport: 'http', source: { file: 'a', commit: 'other' }, provenance: { verified: 'drift' } }],
  });
  assert.equal(has(fs, 'mixed-commit')[0]?.level, 'info');
  assert.deepEqual(has(fs, 'drift').map((f) => [f.kind, f.id]), [['egress', 'x']]);
});

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); });
after(() => app.close());

test('ingest returns the contract report, dry run or not, and the samples have no errors', async () => {
  const manifests = sampleManifests();
  const dry = await app.call('POST', '/api/ingest?dryRun=1', { manifests });
  assert.equal(dry.status, 200);
  for (const r of dry.body.results) assert.deepEqual(Object.keys(r.contract), ['errors', 'warnings', 'infos', 'findings']);
  const real = await app.call('POST', '/api/ingest', { manifests });
  assert.equal(real.status, 201);
  for (const r of real.body.results) assert.equal(r.contract.errors, 0, `${r.service}: ${JSON.stringify(r.contract.findings.filter((f: any) => f.level === 'error'))}`);
  assert.ok(real.body.results.some((r: any) => r.contract.findings.some((f: any) => f.code === 'missing-source')));
});

test('a manifest with a warning is still accepted', async () => {
  const m = { schemaVersion: '1.0', kind: 'full', version: 1, harvestedAt: '2026-01-01T00:00:00Z', env: 'w', service: { name: 'w-svc' },
    egress: [{ id: 'x', bindKey: 'http:GET nowhere', transport: 'http' }] };
  const r = await app.call('POST', '/api/ingest', m);
  assert.equal(r.status, 201);
  assert.ok(r.body.results[0].contract.findings.some((f: any) => f.code === 'dangling-egress'));
});

test('MCP ingest_manifest takes dryRun and returns the report without writing', async () => {
  const { TOOLS } = await import('../server/mcp/tools.ts');
  const tool = TOOLS.find((t) => t.name === 'ingest_manifest')!;
  const m = { schemaVersion: '1.0', kind: 'full', version: 1, harvestedAt: '2026-01-01T00:00:00Z', env: 'mcp', service: { name: 'm-svc' }, egress: [{ id: 'x', bindKey: 'http:GET nowhere', transport: 'http' }] };
  const r: any = tool.run(app.ctx, { manifest: m, dryRun: true });
  assert.equal(r.dryRun, true);
  assert.equal(r.contract.warnings, 1);
  assert.equal((await app.call('GET', '/api/envs/mcp/services')).body.length, 0);
});

// firmwareUpdated.publish and geo.locate are the 0.18.0 RabbitMQ demo (a publish no binding matches, an RPC nobody serves)
const DANGLING = ['disputes.publish', 'firmwareUpdated.publish', 'geo.locate', 'users.getPrefs'];
test('a batch is applied together: only real dangling egress, dry run or not; one bad manifest rejects all', async () => {
  const app = await startApp();
  try {
  const manifests = sampleManifests();
  const dangling = (r: any) => r.body.results.flatMap((x: any) => x.contract.findings.filter((f: any) => f.code === 'dangling-egress').map((f: any) => f.id)).sort();
  const dry = await app.call('POST', '/api/ingest?dryRun=1', { manifests });
  assert.deepEqual(dangling(dry), DANGLING);
  assert.equal((app.ctx.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as any).n, 0, 'dry run wrote nothing');
  const bad = await app.call('POST', '/api/ingest', { manifests: [...manifests, { ...manifests[0], service: { name: 'z-svc' }, ingress: [{ id: 'x' }] }] });
  assert.equal(bad.status, 422);
  assert.equal((app.ctx.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as any).n, 0, 'nothing applied');
  const real = await app.call('POST', '/api/ingest', { manifests });
  assert.deepEqual(dangling(real), DANGLING);
  } finally { await app.close(); }
});
