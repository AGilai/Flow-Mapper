// #85 item 6: unresolved[] entries accept optional gap (boolean) and plain (string), returned verbatim; details.coverage rides in details.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../server/schema.ts';
import { startApp } from './helpers.ts';

const entry = { what: 'target', reason: 'receiver_unknown', detail: 'x.send', gap: false, plain: 'Built-in receiver, not a missing hop.' };
const coverage = { status: 'incomplete', blocked: 1, sites: [{ fn: 'h', seq: 1, file: 'a.ts', line: 3, call: 'x.send()', reason: 'receiver_unknown', plain: 'p' }], more: 0 };
const manifest = (over: object = {}) => ({
  schemaVersion: '1.0', kind: 'full', env: 'g', service: { name: 'gp-svc', kind: 'service' }, version: 1, harvestedAt: '2026-10-25T08:00:00Z',
  ingress: [{ id: 'in.go', bindKey: 'http:GET /go', transport: 'http', handler: 'h', entryPoint: true, details: { coverage }, unresolved: [{ ...entry, gap: true }] }],
  functions: [{ id: 'h', name: 'h', steps: [{ seq: 1, type: 'call', unresolved: [entry] }, { seq: 2, type: 'call', unresolved: [{ what: 'target', reason: 'dyn', gap: true, plain: 'Dynamic call.' }] }] }],
  ...over,
});
let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); });
after(() => app.close());

test('schema: an old unresolved entry is valid, gap and plain are valid, wrong types are rejected', () => {
  const withU = (u: object) => manifest({ functions: [{ id: 'h', name: 'h', steps: [{ seq: 1, type: 'call', unresolved: [{ what: 'target', reason: 'r', ...u }] }] }] });
  assert.deepEqual(validateManifest(withU({})), []);
  assert.deepEqual(validateManifest(manifest()), []);
  assert.notEqual(validateManifest(withU({ gap: 'yes' })).length, 0);
  assert.notEqual(validateManifest(withU({ plain: 5 })).length, 0);
  assert.notEqual(validateManifest(withU({ other: 1 })).length, 0);
});

test('API: gap and plain round-trip through ingest, trace, health and MCP; details.coverage is accepted and returned', async () => {
  const r = await app.call('POST', '/api/ingest', { manifests: [manifest()] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const t = (await app.call('GET', '/api/envs/g/trace?service=gp-svc&ingress=in.go&detail=full&choose=*:both')).body;
  const gaps = t.messages.filter((m: any) => m.gap);
  assert.deepEqual(gaps.map((m: any) => [m.gap.gap, m.gap.plain]), [[false, entry.plain], [true, 'Dynamic call.']]);
  const h = (await app.call('GET', '/api/envs/g/health')).body;
  const items = h.items.unresolved.filter((u: any) => u.plain);
  assert.deepEqual(items.map((u: any) => [u.kind, u.gap, u.plain]).sort(), [['ingress', true, entry.plain], ['step', false, entry.plain], ['step', true, 'Dynamic call.']].sort());
  const call = async (name: string, args: object) => JSON.parse((await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).body.result.content[0].text);
  const mt = await call('trace_flow', { env: 'g', service: 'gp-svc', ingress: 'in.go', detail: 'full', choose: { '*': 'both' } });
  assert.equal(mt.messages.filter((m: any) => m.gap?.plain).length, 2);
  const mh = await call('link_health', { env: 'g' });
  assert.ok(mh.items.unresolved.some((u: any) => u.plain === 'Dynamic call.' && u.gap === true));
  const model = (await app.call('GET', '/api/envs/g/model')).body;
  const ing = model.ingress.find((i: any) => i.id === 'in.go');
  assert.deepEqual(ing.details.coverage, coverage);
  assert.deepEqual(ing.unresolved[0].gap, true);
});
