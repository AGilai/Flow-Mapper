// function.unresolved what=caller (#32): where the backward walk stopped, listed under Unresolved in health.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.ts';

let app: Awaited<ReturnType<typeof startApp>>;
const base = (name: string) => ({ schemaVersion: '1.0', kind: 'full', env: 'e', service: { name, kind: 'service' }, version: 1, harvestedAt: '2026-10-20T08:00:00Z', commit: 'abc' });
const gap = { what: 'caller', reason: 'callback_passed', detail: 'passed to scheduler.every', candidates: ['a', 'b'] };
const blank = { id: 'blank', name: 'blank', unresolved: [{ what: 'caller', reason: 'unknown_receiver', detail: ' ' }] };

before(async () => {
  app = await startApp();
  const r = await app.call('POST', '/api/ingest', { manifests: [{ ...base('svc'), functions: [{ id: 'cb', name: 'cb', unresolved: [gap] }, { id: 'ok', name: 'ok' }, blank] }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});
after(() => app.close());

test('the schema rejects an unknown unresolved.what on a function', async () => {
  const r = await app.call('POST', '/api/ingest', { manifests: [{ ...base('bad'), functions: [{ id: 'f', name: 'f', unresolved: [{ what: 'nope', reason: 'x' }] }] }] });
  assert.ok(r.status >= 400 && r.status < 500);
});

test('health lists caller gaps under unresolved, with the per-service count', async () => {
  const h = (await app.call('GET', '/api/envs/e/health')).body;
  const u = h.items.unresolved.find((x: any) => x.id === 'cb');
  assert.deepEqual([u.kind, u.what, u.reason, u.candidates, u.fn], ['function', 'caller', 'callback_passed', ['a', 'b'], 'cb']);
  assert.equal(h.services.find((s: any) => s.service === 'svc').unresolved, 2);
});

test('the service view and MCP get_service return it on the function; a function without a gap has none', async () => {
  const fns = (await app.call('GET', '/api/envs/e/views/service/svc')).body.functions;
  assert.equal(fns.find((f: any) => f.id === 'cb').unresolved[0].reason, 'callback_passed');
  assert.deepEqual(fns.find((f: any) => f.id === 'ok').unresolved, []);
  const m = JSON.parse((await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_service', arguments: { env: 'e', service: 'svc' } } })).body.result.content[0].text);
  assert.equal(m.functions.find((f: any) => f.id === 'cb').unresolved[0].what, 'caller');
});

test('the contract warns about a caller gap with no detail', async () => {
  const r = await app.call('POST', '/api/ingest?dryRun=1', { manifests: [{ ...base('svc'), version: 2, functions: [blank] }] });
  assert.ok(JSON.stringify(r.body).includes('unresolved-no-detail'), JSON.stringify(r.body).slice(0, 400));
});
