// #98: REST path parameters. `pathParams` on an ingress (schema, full and delta ingest, API, MCP), the fallback
// from the path placeholders (core/path-params.ts), no empty Request/Response boxes, and the "Path parameters" card.
// Demo: samples/group-paths.json.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pathParamsOf, placeholderNames } from '../core/path-params.ts';
import { readSample, startApp, sampleManifests } from './helpers.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201); });
after(() => app.close());

const ing = (over: any = {}) => ({ service: 's', id: 'i', bindKey: 'http:GET s/a/{id}', transport: 'http', handler: 'h', ...over }) as any;
const info = async (id: string) => (await app.call('GET', `/api/envs/prod/endpoints/group-paths/${id}`)).body;

test('fallback: names from {p1}, {id} and :id placeholders, path order, no type or source; nothing for other transports', () => {
  assert.deepEqual(placeholderNames('/api/groups/{p1}/{p2}'), ['p1', 'p2']);
  assert.deepEqual(placeholderNames('/a/:groupId/b/{id}'), ['groupId', 'id']);
  assert.deepEqual(placeholderNames('/a/{}/{}'), []);
  assert.deepEqual(pathParamsOf(ing({ details: { path: '/api/groups/{p1}/{p2}' } })), [{ name: 'p1' }, { name: 'p2' }]);
  assert.deepEqual(pathParamsOf(ing({ bindKey: 'http:DELETE host/api/groups/{p1}' })), [{ name: 'p1' }]);
  assert.deepEqual(pathParamsOf(ing({ bindKey: 'http:GET host.example.com:8080/x' })), []);
  const given = [{ name: 'gid', type: 'uuid', source: { file: 'a.ts', line: 3 } }];
  assert.deepEqual(pathParamsOf(ing({ pathParams: given, details: { path: '/x/{p1}' } })), given, 'harvested names win');
  assert.deepEqual(pathParamsOf(ing({ transport: 'sqs', bindKey: 'sqs:q/{id}', pathParams: given })), []);
});

test('schema: pathParams is optional; a bad shape is refused', async () => {
  const m = readSample('group-paths.json'); m.version += 1;
  assert.equal((await app.call('POST', '/api/ingest?dryRun=1', m)).status, 200);
  const without = structuredClone(m); delete without.ingress[0].pathParams;
  assert.equal((await app.call('POST', '/api/ingest?dryRun=1', without)).status, 200);
  for (const bad of [{ name: '' }, { type: 'string' }, { name: 'a', extra: 1 }, { name: 5 }, { name: 'a', source: { line: 0 } }, 'a']) {
    const b = structuredClone(m); b.ingress[0].pathParams = [bad];
    assert.equal((await app.call('POST', '/api/ingest?dryRun=1', b)).status, 422, JSON.stringify(bad));
  }
  const notList = structuredClone(m); notList.ingress[0].pathParams = { name: 'a' };
  assert.equal((await app.call('POST', '/api/ingest?dryRun=1', notList)).status, 422);
});

test('API: the endpoint returns the harvested list with a code link, no Request/Response slots', async () => {
  const r = await info('in.removeMember');
  assert.deepEqual(r.pathParams.map((p: any) => [p.name, p.type]), [['groupId', 'string'], ['memberId', 'uuid']]);
  assert.equal(r.pathParams[0].link.url, 'https://github.com/acme/group-paths/blob/98a1b2c/src/groups.controller.ts#L53');
  assert.deepEqual(r.slots, []); assert.equal(r.note, null);
  assert.equal(r.ingress.pathParams.length, 2);
});

test('API: without pathParams the names come from the path; the boxes are hidden too', async () => {
  const r = await info('in.removeGroup');
  assert.deepEqual(r.pathParams, [{ name: 'p1', link: null }]);
  assert.deepEqual(r.slots, []);
});

test('a route with a stored DTO or without path parameters keeps its boxes', async () => {
  const list = (await app.call('GET', '/api/envs/prod/endpoints/catalog-svc/in.get.products')).body;
  assert.deepEqual(list.pathParams, []); assert.ok(list.slots.length > 0);
  await app.call('PUT', '/api/envs/prod/dtos/group-paths/request/in.removeGroup', { content: { q: 1 } });
  const withDto = await info('in.removeGroup');
  assert.ok(withDto.slots.length > 0, 'a stored shape brings the boxes back');
});

test('MCP get_service returns pathParams on the ingress', async () => {
  const x = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_service', arguments: { env: 'prod', service: 'group-paths' } } });
  const i = JSON.parse(x.body.result.content[0].text).ingress.find((x: any) => x.id === 'in.removeMember');
  assert.equal(i.pathParams[1].name, 'memberId');
});

// ---- render ----

class El {
  tag: string; kids: any[] = []; attrs: Record<string, any> = {}; style: any = {}; cls = new Set<string>();
  classList = { add: (...c: string[]) => c.forEach((x) => this.cls.add(x)) };
  constructor(tag: string) { this.tag = tag; }
  append(...c: any[]) { this.kids.push(...c); }
  setAttribute(k: string, v: any) { this.attrs[k] = v; }
  addEventListener() {}
  get text(): string { return this.kids.map((k) => (typeof k === 'string' ? k : k.tag === 'svg' ? '' : k.text)).join(' '); }
  find(f: (e: El) => boolean): El[] { return [...(f(this) ? [this] : []), ...this.kids.filter((k) => k instanceof El).flatMap((k) => k.find(f))]; }
}
test('the Path parameters card lists name, type and a file:line link; none for an empty list', async () => {
  (globalThis as any).Node = El; (globalThis as any).SVGElement = class {};
  (globalThis as any).document = { createElement: (t: string) => new El(t), createElementNS: (_n: string, t: string) => new El(t), createTextNode: (t: string) => String(t) };
  // @ts-ignore plain JS module shared with the browser
  const { pathParamsCard } = await import('../web/js/components/path-params.js');
  assert.equal(pathParamsCard([]), null); assert.equal(pathParamsCard(undefined), null);
  const card: El = pathParamsCard((await info('in.removeMember')).pathParams);
  assert.match(card.text, /Path parameters/);
  const rows = card.find((e) => e.tag === 'li');
  assert.equal(rows.length, 2);
  assert.match(rows[0].text, /groupId\s+string\s+src\/groups\.controller\.ts:53/);
  const link = rows[1].find((e) => e.tag === 'a')[0];
  assert.match(link.attrs.href, /#L54$/);
  const derived: El = pathParamsCard((await info('in.removeGroup')).pathParams);
  assert.equal(derived.find((e) => e.tag === 'a').length, 0, 'no source, no link');
  assert.match(derived.text, /p1/);
});

// Own env name: the graph cache is keyed by environment name and shared inside one process (not across DB files in production).
test('ingest round trip: full stores pathParams, a delta replaces and clears them', async () => {
  const a = await startApp();
  try {
    const m = readSample('group-paths.json'); m.env = 'roundtrip';
    assert.equal((await a.call('POST', '/api/ingest', m)).status, 201);
    const get = async () => (await a.call('GET', '/api/envs/roundtrip/endpoints/group-paths/in.removeMember')).body.ingress.pathParams;
    assert.equal((await get()).length, 2);
    const delta = (version: number, ingress: any) => ({ schemaVersion: '1.0', kind: 'delta', env: 'roundtrip', service: { name: 'group-paths' }, baseVersion: version - 1, version, harvestedAt: '2026-11-03T00:00:00Z', upsert: { ingress: [ingress] } });
    const base = m.ingress[0];
    const r = await a.call('POST', '/api/ingest', delta(2, { ...base, pathParams: [{ name: 'gid', type: 'string' }, { name: 'mid' }] }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual((await get()).map((p: any) => p.name), ['gid', 'mid']);
    const { pathParams: _x, ...plain } = base;
    assert.equal((await a.call('POST', '/api/ingest', delta(3, plain))).status, 201);
    const g = (await a.call('GET', '/api/envs/roundtrip/endpoints/group-paths/in.removeMember')).body;
    assert.equal(g.ingress.pathParams, undefined);
    assert.deepEqual(g.pathParams.map((p: any) => p.name), ['groupId', 'memberId'], 'then derived from details.path');
  } finally { await a.close(); }
});
