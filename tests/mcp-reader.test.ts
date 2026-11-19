// MCP reader tools (parity with the web app): flows_through, neighbours, openEnds / traced, the drivers report of list_clients, version.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sampleManifests, startApp } from './helpers.ts';
import { traceOpenEnds, tracedOf, withOpenEnds } from '../core/entry-coverage.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
});
after(() => app.close());

const mcp = async (name: string, args: object) => {
  const x = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const { isError, content } = x.body.result;
  return { isError: !!isError, text: content[0].text as string, json: isError ? null : (() => { try { return JSON.parse(content[0].text); } catch { return null; } })() };
};
const get = async (path: string) => app.call('GET', `/api/envs/prod${path}`);

test('flows_through equals GET /flows-through (array, one name, comma string)', async () => {
  const rest = (await get('/flows-through?service=orders-svc,users-svc')).body;
  assert.ok(rest.length > 0);
  for (const services of [['orders-svc', 'users-svc'], 'orders-svc,users-svc'])
    assert.deepEqual((await mcp('flows_through', { env: 'prod', services })).json, rest);
  assert.deepEqual((await mcp('flows_through', { env: 'prod', service: 'orders-svc' })).json.map(strip), (await get('/flows-through?service=orders-svc')).body.map(strip));
  assert.equal((await mcp('flows_through', { env: 'prod' })).isError, true);
});
const strip = (r: any) => { const { openEnds, ...rest } = r; return rest; };

test('neighbours equals GET /neighbours', async () => {
  for (const s of ['orders-svc', 'api-gateway,orders-svc,users-svc'])
    assert.deepEqual((await mcp('neighbours', { env: 'prod', services: s.split(',') })).json, (await get(`/neighbours?services=${s}`)).body);
});

test('list_entry_points: rows gain openEnds, summary wraps them with traced, the default stays an array', async () => {
  const rest = (await get('/entry-points')).body, plain = (await mcp('list_entry_points', { env: 'prod' })).json;
  assert.ok(Array.isArray(plain));
  assert.deepEqual(plain.map(strip), rest);
  const withCov = plain.filter((r: any) => r.coverage);
  assert.ok(withCov.length > 0, 'samples report coverage');
  for (const r of withCov) assert.deepEqual(r.openEnds, { own: r.coverage.blocked ?? 0, called: null });
  for (const r of plain.filter((x: any) => !x.coverage)) assert.equal(r.openEnds, undefined);
  const s = (await mcp('list_entry_points', { env: 'prod', summary: true })).json;
  assert.deepEqual(s.rows, plain);
  const incomplete = rest.filter((r: any) => r.coverage?.status === 'incomplete' || (r.coverage?.blocked ?? 0) > 0).length;
  assert.deepEqual(s.traced, { full: rest.length - incomplete, total: rest.length, reported: withCov.length });
  assert.ok(incomplete > 0 && s.traced.full < s.traced.total);
});

test('trace_flow carries openEnds like the header (own, called, sites)', async () => {
  const rows = (await get('/entry-points')).body.filter((r: any) => (r.coverage?.blocked ?? 0) > 0);
  assert.ok(rows.length > 0);
  const r = rows[0], t = (await mcp('trace_flow', { env: 'prod', service: r.service, ingress: r.id })).json;
  assert.ok(t.openEnds && typeof t.openEnds.own === 'number' && typeof t.openEnds.called === 'number' && Array.isArray(t.openEnds.sites));
  assert.equal(t.openEnds.own, r.coverage.blocked);
  for (const s of t.openEnds.sites) assert.ok(s.service && s.at && s.what);
  assert.deepEqual(t.openEnds, traceOpenEnds(t));
  const clean = (await get('/entry-points')).body.find((x: any) => !x.coverage);
  assert.deepEqual((await mcp('trace_flow', { env: 'prod', service: clean.service, ingress: clean.id })).json.openEnds, { own: 0, called: 0, sites: [] });
});

test('entry-coverage: pure helpers', () => {
  const rows = [{ coverage: { status: 'complete' as const } }, { coverage: { status: 'incomplete' as const, blocked: 2 } }, {}];
  assert.deepEqual(tracedOf(rows), { full: 2, total: 3, reported: 2 });
  assert.deepEqual(withOpenEnds(rows).map((r: any) => r.openEnds), [{ own: 0, called: null }, { own: 2, called: null }, undefined]);
});

test('list_clients report: rows is the default; drivers and markdown match the REST export', async () => {
  const rows = (await mcp('list_clients', { env: 'prod' })).json;
  assert.deepEqual((await mcp('list_clients', { env: 'prod', report: 'rows' })).json, rows);
  const md = await mcp('list_clients', { env: 'prod', report: 'markdown' });
  const rest = (await app.call('GET', '/api/envs/prod/clients/drivers.md')).body as string;
  assert.equal(md.json.text, rest);
  assert.match(md.json.text, /^# Drivers report · prod/);
  const d = (await mcp('list_clients', { env: 'prod', report: 'drivers' })).json;
  assert.equal(d.env, 'prod');
  assert.ok(d.kinds.length > 0);
  for (const k of d.kinds) { assert.ok(k.verdict && k.label && Array.isArray(k.packages) && Array.isArray(k.unresolved)); }
  const redis = (await mcp('list_clients', { env: 'prod', report: 'drivers', store: 'redis' })).json;
  assert.deepEqual(redis.kinds.map((k: any) => k.kind), ['redis']);
  assert.ok(md.json.text.includes(d.kinds[0].verdict));
  const q = (await app.call('GET', '/api/envs/prod/clients/drivers.md?store=redis&mixed=1')).body as string;
  assert.equal((await mcp('list_clients', { env: 'prod', report: 'markdown', store: "redis", mixed: true })).json.text, q);
});

test('whoami returns the server version', async () => {
  const v = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  assert.equal((await mcp('whoami', {})).json.version, v);
  assert.equal((await app.call('GET', '/api/version')).body.version, v);
});
