// Transport `undecided` (a call or endpoint of a design whose transport is not chosen yet), and `details` on a header and a function.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, validateServiceHeader } from '../server/schema.ts';
import { openDb } from '../server/db/connection.ts';
import { ingestBatch } from '../server/store/snapshots-ingest.ts';
import { loadModel } from '../server/store/snapshots-read.ts';
import { buildIndex } from '../core/graph-index.ts';
import { health } from '../core/health.ts';
import { trace } from '../core/trace.ts';

const m = (name: string, extra: object) => ({
  schemaVersion: '1.0', kind: 'full', env: 'd', version: 1, harvestedAt: '2026-10-21T12:00:00Z', service: { name, kind: 'service' },
  functions: [{ id: 'H', name: 'H', steps: [{ seq: 1, type: 'egress', target: 'out.p' }] }], ...extra,
});
const caller = m('pop-edge', { egress: [{ id: 'out.p', transport: 'undecided', bindKey: 'tbd:policy/Get' }], ingress: [{ id: 'in.x', transport: 'http', bindKey: 'http:GET pop-edge/x', handler: 'H', entryPoint: true }] });
const callee = m('policy', { functions: [{ id: 'G', name: 'G', steps: [] }], ingress: [{ id: 'in.get', transport: 'undecided', bindKey: 'tbd:policy/Get', handler: 'G' }] });

test('the schema accepts undecided and still rejects an unknown transport', () => {
  assert.deepEqual(validateManifest(caller), []);
  assert.deepEqual(validateManifest(callee), []);
  assert.notDeepEqual(validateManifest({ ...caller, egress: [{ id: 'out.p', transport: 'carrier-pigeon', bindKey: 'x' }] }), []);
});

test('details on a service header and on a function are free-form objects (and still nothing else is)', () => {
  assert.deepEqual(validateServiceHeader({ name: 'a', kind: 'service', details: { doc: { file: 'x.md' } } }), []);
  assert.notDeepEqual(validateServiceHeader({ name: 'a', kind: 'service', surprise: 1 }), []);
  assert.deepEqual(validateManifest(m('a', { functions: [{ id: 'H', name: 'H', steps: [], details: { doc: { section: '1' } } }] })), []);
  assert.notDeepEqual(validateManifest(m('a', { functions: [{ id: 'H', name: 'H', steps: [], surprise: 1 }] })), []);
});

test('an undecided call links to the undecided endpoint with the same key: sync, health linked, contract has no dangling-egress, the flow traces', () => {
  const db = openDb(':memory:');
  const r = ingestBatch(db, [caller, callee], 'api');
  for (const x of r) assert.equal(x.contract!.findings.some((f: any) => f.code === 'dangling-egress'), false, x.service);
  const g = buildIndex(loadModel(db, 'd'));
  const link = g.resolution.links.find((l) => l.from.type === 'egress' && l.from.service === 'pop-edge');
  assert.ok(link, 'resolved by key like any other transport');
  assert.deepEqual([link!.mode, link!.transport, (link!.to as any).service], ['sync', 'undecided', 'policy']);
  assert.equal(health(g).items.dangling.length, 0);
  assert.equal(health(g).services.find((s) => s.service === 'pop-edge')!.dangling, 0);
  const t = trace(g, { service: 'pop-edge', ingress: 'in.x' }, { scope: 'full' })!;
  assert.ok(t.messages.some((x) => x.to === 'svc:policy' && x.mode === 'sync'));
});

test('without its other end an undecided call is dangling like any call', () => {
  const db = openDb(':memory:');
  const [x] = ingestBatch(db, [caller], 'api');
  assert.ok(x.contract!.findings.some((f: any) => f.code === 'dangling-egress'));
});
