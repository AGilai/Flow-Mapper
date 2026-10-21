// The sealed / design guard is a call in each write function, so a new write path could forget it. This walks EVERY write
// route (REST) and EVERY MCP tool: each must be classified here, and the guarded ones are called against a sealed and a
// design environment and must answer 409 ENV_SEALED / ENV_DESIGN / ENV_DRAFT where the rules say so.
//   HARVESTER  ingest, DTOs, schemas, Redis keys: sealed yes, design 409 ENV_DESIGN (a dry run is allowed into a design)
//   MANUAL     entity / service CRUD: sealed 409 ENV_SEALED, design 409 ENV_DRAFT (edit through a draft)
//   DRAFT      draft writes and apply: sealed 409 ENV_SEALED, design allowed A route or tool that is not
// classified fails the test: add it to the right list (and, if it writes map data, give it the guard).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readSample, sampleManifests, startApp } from './helpers.ts';
import { TOOLS } from '../server/mcp/tools.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
  const r = await app.call('POST', '/api/envs', { name: 'guard-d', source: 'prod', mode: 'components', services: [{ name: 'users-svc' }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});
after(() => app.close());

/** A fresh open draft in the design env, so a draft route that closes it can be called again. */
let n = 0;
const freshDraft = async () => { const slug = `g${++n}`; assert.equal((await app.call('POST', '/api/envs/guard-d/drafts', { name: slug, slug })).status, 201); return slug; };

type Req = { method: string; path: string; body?: unknown };
const base = (e: string) => `/api/envs/${e}`;
const entity = { id: 'g.x', bindKey: 'http:GET users-svc/g', transport: 'http' };

/** Writes that only harvesters may make: refused in a design env; allowed (no guard error) in a sealed one. */
const HARVESTER: Record<string, (e: string, manifest: any) => Req> = {
  'POST /api/ingest': (e, m) => ({ method: 'POST', path: '/api/ingest', body: { ...m, env: e, version: 999 } }),
  'POST /api/envs/:env/dtos': (e) => ({ method: 'POST', path: `${base(e)}/dtos`, body: { dtos: [] } }),
  'PUT /api/envs/:env/dtos/:service/:role/*ingress': (e) => ({ method: 'PUT', path: `${base(e)}/dtos/users-svc/response/in.getUser`, body: { a: 1 } }),
  'DELETE /api/envs/:env/dtos/:service/:role/*ingress': (e) => ({ method: 'DELETE', path: `${base(e)}/dtos/users-svc/response/in.getUser` }),
  'PUT /api/envs/:env/event-dtos/*type': (e) => ({ method: 'PUT', path: `${base(e)}/event-dtos/GuardEvent`, body: { a: 1 } }),
  'DELETE /api/envs/:env/event-dtos/*type': (e) => ({ method: 'DELETE', path: `${base(e)}/event-dtos/GuardEvent` }),
  'POST /api/envs/:env/schemas': (e) => ({ method: 'POST', path: `${base(e)}/schemas`, body: { schemas: [] } }),
  'PUT /api/envs/:env/schemas/:source/*key': (e) => ({ method: 'PUT', path: `${base(e)}/schemas/code/nokey`, body: {} }),
  'DELETE /api/envs/:env/schemas/:source/*key': (e) => ({ method: 'DELETE', path: `${base(e)}/schemas/code/nokey` }),
  'PUT /api/envs/:env/resources/:id/keys': (e) => ({ method: 'PUT', path: `${base(e)}/resources/redis%3Acache-main/keys`, body: { keys: [] } }),
};

/** Manual edits: refused in a sealed env (409 ENV_SEALED) and in a design env (409 ENV_DRAFT: a design is edited through a draft). */
const MANUAL: Record<string, (e: string) => Req> = {
  'POST /api/envs/:env/services': (e) => ({ method: 'POST', path: `${base(e)}/services`, body: { name: 'guard-new' } }),
  'PATCH /api/envs/:env/services/:service': (e) => ({ method: 'PATCH', path: `${base(e)}/services/users-svc`, body: { team: 'g' } }),
  'DELETE /api/envs/:env/services/:service': (e) => ({ method: 'DELETE', path: `${base(e)}/services/guard-none` }),
  'POST /api/envs/:env/services/:service/:list': (e) => ({ method: 'POST', path: `${base(e)}/services/users-svc/egress`, body: entity }),
  'PUT /api/envs/:env/services/:service/:list/*key': (e) => ({ method: 'PUT', path: `${base(e)}/services/users-svc/egress/g.x`, body: entity }),
  'DELETE /api/envs/:env/services/:service/:list/*key': (e) => ({ method: 'DELETE', path: `${base(e)}/services/users-svc/egress/g.x` }),
};

/** Draft writes: refused in a sealed env (409 ENV_SEALED); in a design env they pass the guard (a draft route may still answer 404/409/422 for its own reasons). */
const DRAFT: Record<string, (e: string, slug: string) => Req> = {
  'POST /api/envs/:env/drafts': (e) => ({ method: 'POST', path: `${base(e)}/drafts`, body: { name: 'guard' } }),
  'PATCH /api/envs/:env/drafts/:slug': (e, s) => ({ method: 'PATCH', path: `${base(e)}/drafts/${s}`, body: { name: 'renamed' } }),
  'DELETE /api/envs/:env/drafts/:slug': (e, s) => ({ method: 'DELETE', path: `${base(e)}/drafts/${s}` }),
  'POST /api/envs/:env/drafts/:slug/ops': (e, s) => ({ method: 'POST', path: `${base(e)}/drafts/${s}/ops`, body: { ops: [{ op: 'delete', anchor: 'egr:users-svc/none' }] } }),
  'DELETE /api/envs/:env/drafts/:slug/ops/last': (e, s) => ({ method: 'DELETE', path: `${base(e)}/drafts/${s}/ops/last` }),
  'DELETE /api/envs/:env/drafts/:slug/ops': (e, s) => ({ method: 'DELETE', path: `${base(e)}/drafts/${s}/ops?anchor=egr:users-svc/none` }),
  'POST /api/envs/:env/drafts/:slug/apply': (e, s) => ({ method: 'POST', path: `${base(e)}/drafts/${s}/apply`, body: {} }),
};

/** Not map data, or not guarded by kind on purpose: annotations (bugs, descriptions), environment management, the MCP transport (its tools are checked below). */
const EXEMPT = new Set(['PUT /api/envs/:env/descriptions', 'POST /api/bugs', 'PATCH /api/bugs/:id', 'POST /api/bugs/:id/comments', 'POST /api/bugs/:id/attachments',
  'POST /api/envs', 'DELETE /api/envs/:env', 'POST /mcp']);

const code = (r: { body: any }) => r.body?.error?.code;

test('every write route is classified, so a new one cannot skip the guard unnoticed', () => {
  const writes = app.router.list().filter((r: string) => !r.startsWith('GET '));
  const known = new Set([...Object.keys(HARVESTER), ...Object.keys(MANUAL), ...Object.keys(DRAFT), ...EXEMPT]);
  const unknown = writes.filter((r: string) => !known.has(r));
  assert.deepEqual(unknown, [], 'classify these in tests/env-guard.test.ts (HARVESTER, MANUAL, DRAFT or EXEMPT) and guard them in the store');
  for (const k of known) assert.ok(writes.includes(k), `${k} is listed here but no longer a route`);
});

test('harvester write routes: 409 ENV_DESIGN in a design env, not refused in a sealed one', async () => {
  const m = readSample('users-svc.json');
  for (const [name, make] of Object.entries(HARVESTER)) {
    const d = make('guard-d', m);
    const rd = await app.call(d.method, d.path, d.body);
    assert.equal(rd.status, 409, `${name} on a design env: ${JSON.stringify(rd.body)}`);
    assert.equal(code(rd), 'ENV_DESIGN', name);
    const s = make('prod', m);
    const rs = await app.call(s.method, s.path, s.body);
    assert.notEqual(code(rs), 'ENV_DESIGN', `${name} on a sealed env`);
    assert.notEqual(code(rs), 'ENV_SEALED', `${name} on a sealed env`);
  }
});

test('manual write routes: 409 ENV_SEALED in a sealed env, 409 ENV_DRAFT in a design env', async () => {
  for (const [name, make] of Object.entries(MANUAL)) {
    const s = make('prod');
    const rs = await app.call(s.method, s.path, s.body);
    assert.equal(rs.status, 409, `${name} on a sealed env: ${JSON.stringify(rs.body)}`);
    assert.equal(code(rs), 'ENV_SEALED', name);
    const d = make('guard-d');
    const rd = await app.call(d.method, d.path, d.body);
    assert.equal(rd.status, 409, `${name} on a design env: ${JSON.stringify(rd.body)}`);
    assert.equal(code(rd), 'ENV_DRAFT', name);
    assert.match(rd.body.error.message, /through a draft/, name);
  }
});

test('draft write routes: 409 ENV_SEALED in a sealed env, through the guard in a design env', async () => {
  for (const [name, make] of Object.entries(DRAFT)) {
    const s = make('prod', 'whatever');
    const rs = await app.call(s.method, s.path, s.body);
    assert.equal(rs.status, 409, `${name} on a sealed env: ${JSON.stringify(rs.body)}`);
    assert.equal(code(rs), 'ENV_SEALED', name);
    const d = make('guard-d', await freshDraft());
    const rd = await app.call(d.method, d.path, d.body);
    assert.ok(!['ENV_SEALED', 'ENV_DESIGN', 'ENV_DRAFT'].includes(code(rd)), `${name} on a design env: ${JSON.stringify(rd.body)}`);
  }
});

test('dry runs are allowed into a design env (nothing is written) and still validated', async () => {
  const m = readSample('users-svc.json');
  const v = (await app.call('GET', '/api/envs/guard-d/services/users-svc')).body.service.version;
  const ing = await app.call('POST', '/api/ingest?dryRun=1', { ...m, env: 'guard-d', version: 999 });
  assert.equal(ing.status, 200, JSON.stringify(ing.body)); assert.equal(ing.body.dryRun, true);
  assert.equal((await app.call('GET', '/api/envs/guard-d/services/users-svc')).body.service.version, v);
  assert.equal((await app.call('POST', '/api/ingest?dryRun=1', { ...m, env: 'guard-d', version: 1 })).body.error.code, 'VERSION_NOT_NEWER');
  const dto = await app.call('POST', '/api/envs/guard-d/dtos?dryRun=1', { dtos: [{ service: 'users-svc', ingress: 'in.getUser', role: 'response', content: { a: 1 } }] });
  assert.equal(dto.status, 200, JSON.stringify(dto.body)); assert.equal(dto.body.dryRun, true);
  assert.equal((await app.call('GET', '/api/envs/guard-d/dtos')).body.some((d: any) => d.content?.a === 1), false);
  assert.equal((await app.call('POST', '/api/envs/guard-d/dtos?dryRun=1', { dtos: [{ service: 'users-svc', ingress: 'nope', role: 'response', content: {} }] })).status, 404, 'validated against the environment');
  const sc = await app.call('POST', '/api/envs/guard-d/schemas?dryRun=1', { schemas: [] });
  assert.equal(sc.status, 200); assert.equal(sc.body.dryRun, true);
  assert.equal((await app.call('POST', '/api/envs/guard-d/dtos', { dtos: [] })).body.error.code, 'ENV_DESIGN', 'a real load is still refused');
});

// MCP tools: read tools are listed so a new tool must be classified too.
const MCP_READ = new Set(['search', 'list_services', 'get_service', 'list_entry_points', 'trace_flow', 'find_paths', 'link_health', 'changelog', 'get_endpoint_info', 'event_types',
  'inventory', 'get_store', 'list_clients', 'get_resource_keys', 'get_channel', 'get_exchange', 'list_bugs', 'get_bug', 'list_envs', 'list_drafts', 'draft_changes']);
const MCP_HARVESTER: Record<string, (e: string, manifest: any) => any> = {
  ingest_manifest: (e, m) => ({ manifest: { ...m, env: e, version: 999 } }),
  load_dtos: (e) => ({ env: e, dtos: [] }),
  load_schemas: (e) => ({ env: e, schemas: [] }),
};
const MCP_MANUAL: Record<string, (e: string) => any> = {
  upsert_entity: (env) => ({ env, service: 'users-svc', list: 'egress', entity: entity }),
  delete_entity: (env) => ({ env, service: 'users-svc', list: 'egress', key: 'g.x' }),
};
const MCP_DRAFT: Record<string, (e: string, slug: string) => any> = {
  open_draft: (env) => ({ env, name: 'guard-mcp' }),
  edit_in_draft: (env, draft) => ({ env, draft, ops: [{ op: 'delete', anchor: 'egr:users-svc/none' }] }),
  apply_draft: (env, draft) => ({ env, draft }),
  discard_draft: (env, draft) => ({ env, draft }),
};
const MCP_EXEMPT = new Set(['set_description', 'report_bug', 'update_bug', 'create_env']);

const mcp = async (name: string, args: any) => {
  const r = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return { isError: r.body.result.isError as boolean, text: r.body.result.content[0].text as string };
};

test('every MCP tool is classified', () => {
  const known = new Set([...MCP_READ, ...Object.keys(MCP_HARVESTER), ...Object.keys(MCP_MANUAL), ...Object.keys(MCP_DRAFT), ...MCP_EXEMPT]);
  assert.deepEqual(TOOLS.map((t) => t.name).filter((n) => !known.has(n)), [], 'classify these in tests/env-guard.test.ts and guard the writes');
  for (const k of known) assert.ok(TOOLS.some((t) => t.name === k), `${k} is listed here but is not a tool`);
});

test('MCP write tools: harvester tools refuse a design env, manual tools refuse both, draft tools refuse a sealed env', async () => {
  const m = readSample('users-svc.json');
  for (const [name, make] of Object.entries(MCP_HARVESTER)) {
    const d = await mcp(name, make('guard-d', m));
    assert.equal(d.isError, true, name); assert.match(d.text, /ENV_DESIGN/, name);
    const s = await mcp(name, make('prod', m));
    assert.doesNotMatch(s.text, /ENV_DESIGN|ENV_SEALED/, `${name} on a sealed env`);
  }
  for (const [name, make] of Object.entries(MCP_MANUAL)) {
    const s = await mcp(name, make('prod'));
    assert.equal(s.isError, true, name); assert.match(s.text, /ENV_SEALED/, name);
    const d = await mcp(name, make('guard-d'));
    assert.equal(d.isError, true, name); assert.match(d.text, /ENV_DRAFT/, `${name} on a design env`);
  }
  for (const [name, make] of Object.entries(MCP_DRAFT)) {
    const s = await mcp(name, make('prod', 'whatever'));
    assert.equal(s.isError, true, name); assert.match(s.text, /ENV_SEALED/, name);
    const d = await mcp(name, make('guard-d', await freshDraft()));
    assert.doesNotMatch(d.text, /ENV_DESIGN|ENV_SEALED|ENV_DRAFT/, `${name} on a design env: ${d.text}`);
  }
  const m2 = readSample('users-svc.json');
  const dry = await mcp('ingest_manifest', { manifest: { ...m2, env: 'guard-d', version: 999 }, dryRun: true });
  assert.equal(dry.isError, false, dry.text); assert.match(dry.text, /"dryRun": true/);
  assert.equal((await mcp('load_dtos', { env: 'guard-d', dtos: [], dryRun: true })).isError, false);
  assert.equal((await mcp('load_schemas', { env: 'guard-d', schemas: [], dryRun: true })).isError, false);
});
