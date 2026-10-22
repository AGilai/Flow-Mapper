// Reading an environment as a draft: every GET route under /api/envs/:env/ takes ?draft=<slug>, so does every MCP read tool.
// 200 and the overlay where it matters; unknown draft 404; closed 409; a draft read never touches the environment's cache entry.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign } from './helpers.ts';
import { TOOLS } from '../server/mcp/tools.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => {
  app = await startDesign();
  await app.call('POST', '/api/envs/hld/drafts', { name: 'Reads', slug: 'reads' });
  const up = (anchor: string, data: unknown) => ({ op: 'upsert', anchor, data });
  const r = await app.call('POST', '/api/envs/hld/drafts/reads/ops', { ops: [
    up('svc:pop', { kind: 'service', groupPath: 'agent', team: 'net' }),
    up('fn:pop/H', { id: 'H', name: 'H', steps: [{ seq: 1, type: 'egress', target: 'out.v' }] }),
    up('ing:pop/in.open', { id: 'in.open', transport: 'socket', bindKey: 'socket:tls/pop/open', handler: 'H', entryPoint: true }),
    up('egr:pop/out.v', { id: 'out.v', transport: 'http', mode: 'sync', bindKey: 'http:POST auth-svc/verify' }),
    up('dto:pop/request/-/in.open', { content: { device: 'x' }, meta: null }),
    { op: 'upsert', anchor: 'ch:sns:pop-events', service: 'pop', data: { bindKey: 'sns:pop-events', kind: 'sns-topic' } },
    up('evt:PopOpened', { content: { id: 'x' }, meta: null }),
    up('flow:pop/in.open', { name: 'Agent connects', description: 'Agent opens a tunnel.' }),
    up('link:agent-to-platform', { name: 'agent to platform', from: 'grp:agent', to: 'grp:platform', mode: 'sync' }),
  ] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await app.call('POST', '/api/envs/hld/drafts', { name: 'Closed', slug: 'closed' });
  await app.call('DELETE', '/api/envs/hld/drafts/closed');
});
after(() => app.close());

/** A concrete URL per GET route pattern (the first test fails when a route is missing here). */
const URLS: Record<string, string> = {
  'GET /api/envs/:env/views/system': 'views/system', 'GET /api/envs/:env/views/service/:service': 'views/service/pop', 'GET /api/envs/:env/entry-points': 'entry-points',
  'GET /api/envs/:env/flows/counts': 'flows/counts', 'GET /api/envs/:env/flows/mermaid': 'flows/mermaid?service=pop&ingress=in.open', 'GET /api/envs/:env/trace': 'trace?service=pop&ingress=in.open', 'GET /api/envs/:env/paths': 'paths?from=pop&to=auth-svc',
  'GET /api/envs/:env/search': 'search?q=pop', 'GET /api/envs/:env/health': 'health', 'GET /api/envs/:env/health/history': 'health/history', 'GET /api/envs/:env/changelog': 'changelog',
  'GET /api/envs/:env/model': 'model', 'GET /api/envs/:env/services': 'services', 'GET /api/envs/:env/services/:service': 'services/pop', 'GET /api/envs/:env/services/:service/:list': 'services/pop/ingress',
  'GET /api/envs/:env/services/:service/:list/*key': 'services/pop/ingress/in.open', 'GET /api/envs/:env/endpoints/:service/*ingress': 'endpoints/pop/in.open', 'GET /api/envs/:env/dtos': 'dtos',
  'GET /api/envs/:env/events': 'events', 'GET /api/envs/:env/events/*type': 'events/PopOpened', 'GET /api/envs/:env/inventory': 'inventory', 'GET /api/envs/:env/stores/*key': 'stores/postgres:users-db/users',
  'GET /api/envs/:env/clients': 'clients', 'GET /api/envs/:env/channels/*key': 'channels/sns:pop-events', 'GET /api/envs/:env/schemas': 'schemas', 'GET /api/envs/:env/descriptions': 'descriptions?service=pop&ingress=in.open',
  'GET /api/envs/:env/instances': 'instances', 'GET /api/envs/:env/exchanges': 'exchanges', 'GET /api/envs/:env/instances/:id': 'instances/redis:cache-main', 'GET /api/envs/:env/resources/:id/keys': 'resources/redis%3Acache-main/keys',
  'GET /api/envs/:env/meta': 'meta', 'GET /api/envs/:env/components': 'components', 'GET /api/envs/:env/neighbours': 'neighbours?services=pop', 'GET /api/envs/:env/drafts': 'drafts',
  'GET /api/envs/:env/drafts/:slug': 'drafts/reads', 'GET /api/envs/:env/drafts/:slug/changes': 'drafts/reads/changes', 'GET /api/envs/:env/marks': 'marks', 'GET /api/envs/:env/flow-names': 'flow-names', 'GET /api/envs/:env/comments': 'comments?anchor=flow:pop/in.open', 'GET /api/envs/:env/comments/counts': 'comments/counts', 'GET /api/envs/:env/notes': 'notes?anchor=flow:pop/in.open', 'GET /api/envs/:env/notes/history': 'notes/history?anchor=flow:pop/in.open', 'GET /api/envs/:env/notes/index': 'notes/index', 'GET /api/envs/:env/mentions/counts': 'mentions/counts', 'GET /api/envs/:env/action-items': 'action-items?anchor=flow:pop/in.open', 'GET /api/envs/:env/action-items/counts': 'action-items/counts', 'GET /api/envs/:env/call': 'call?service=users-svc&egress=out.auth.verify', 'GET /api/envs/:env/drafts/:slug/import/preview': 'drafts/reads/import/preview?source=prod&anchor=svc:orders-svc',
  'GET /api/envs/:env/subsystems': 'subsystems', 'GET /api/envs/:env/views/subsystems': 'views/subsystems', 'GET /api/envs/:env/abstract-links': 'abstract-links', 'GET /api/envs/:env/flow-relations': 'flow-relations', 'GET /api/envs/:env/flows-through': 'flows-through?service=pop', 'GET /api/envs/:env/open-questions': 'open-questions', 'GET /api/envs/:env/abstract-links/:id': 'abstract-links/agent-to-platform',
};
const url = (p: string, q: string) => `/api/envs/hld/${p}${p.includes('?') ? '&' : '?'}${q}`;
const GET_ROUTES = () => app.router.list().filter((r: string) => r.startsWith('GET /api/envs/:env/'));

test('every GET route under /api/envs/:env/ is listed here', () => {
  assert.deepEqual(GET_ROUTES().filter((r: string) => !URLS[r]), [], 'add a URL for each new route and make it read ?draft=');
  for (const k of Object.keys(URLS)) assert.ok(GET_ROUTES().includes(k) || k.endsWith('/marks'), `${k} is no longer a route`);
});

test('?draft= on every GET route: 200, unknown draft 404, closed draft 409', async () => {
  for (const r of GET_ROUTES()) {
    const p = URLS[r];
    // the environment's own routes that need an entity the draft adds are tried with it; the rest with what the environment has
    const ok = await app.call('GET', url(p, 'draft=reads'));
    assert.equal(ok.status, 200, `${r} with a draft: ${JSON.stringify(ok.body).slice(0, 200)}`);
    assert.equal((await app.call('GET', url(p, 'draft=nope'))).status, 404, `${r} unknown draft`);
    const closed = await app.call('GET', url(p, 'draft=closed'));
    assert.equal(closed.status, 409, `${r} closed draft`);
    assert.equal(closed.body.error.code, 'DRAFT_CLOSED');
  }
  assert.equal((await app.call('GET', '/api/envs/prod/inventory?draft=reads')).status, 404, 'a sealed env has no drafts');
});

test('the draft view shows the overlay: new component, trace of the new flow, endpoint DTO, event DTO, inventory, service rows', async () => {
  const get = async (p: string, d = true) => (await app.call('GET', `/api/envs/hld/${p}${d ? (p.includes('?') ? '&' : '?') + 'draft=reads' : ''}`)).body;
  assert.ok((await get('inventory')).some((x: any) => x.id === 'pop'));
  assert.ok(!(await get('inventory', false)).some((x: any) => x.id === 'pop'));
  const t = await get('trace?service=pop&ingress=in.open');
  assert.ok(t.messages.some((m: any) => m.from === 'svc:pop' && m.to.includes('auth-svc')), 'the flow of the new endpoint traces into auth-svc');
  assert.equal((await app.call('GET', '/api/envs/hld/trace?detail=full&service=pop&ingress=in.open')).status, 404);
  const info = await get('endpoints/pop/in.open');
  assert.deepEqual(info.dtos?.request?.content ?? info.slots?.find((s: any) => s.role === 'request')?.dto?.content, { device: 'x' });
  assert.deepEqual((await get('events/PopOpened')).dto.content, { id: 'x' });
  assert.ok((await get('dtos')).some((d: any) => d.service === 'pop' && d.ingress === 'in.open'));
  assert.equal((await get('services/pop')).service.groupPath, 'agent');
  assert.ok((await get('services')).some((s: any) => s.name === 'pop'));
  assert.ok((await get('entry-points')).some((e: any) => e.service === 'pop'));
  assert.ok((await get('components')).some((c: any) => c.name === 'pop' || c.service === 'pop'));
});

test('a draft read never invalidates or rebuilds the environment\'s cache entry', async () => {
  const g1 = app.ctx.graph('hld');
  await app.call('GET', '/api/envs/hld/inventory?draft=reads');
  await app.call('GET', '/api/envs/hld/trace?detail=full&service=pop&ingress=in.open&draft=reads');
  assert.equal(app.ctx.graph('hld'), g1, 'same graph object');
  const v1 = app.ctx.view('hld', 'reads').g;
  assert.equal(app.ctx.view('hld', 'reads').g, v1, 'the draft graph is cached too');
});

// ---- MCP: every read tool takes `draft`
const CALLS: Record<string, any> = {
  search: { query: 'pop' }, list_services: {}, get_service: { service: 'pop' }, list_entry_points: {}, trace_flow: { service: 'pop', ingress: 'in.open' }, find_paths: { from: 'pop', to: 'auth-svc' },
  link_health: {}, inventory: {}, get_endpoint_info: { service: 'pop', ingress: 'in.open' }, event_types: {}, get_store: { key: 'postgres:users-db/users' },
  list_clients: {}, get_resource_keys: { resourceId: 'redis:cache-main' }, get_channel: { key: 'sns:pop-events' }, get_exchange: { key: 'none' },
};

test('MCP read tools take `draft`: they see the draft, refuse an unknown or closed one', async () => {
  for (const [name, args] of Object.entries(CALLS)) {
    const tool = TOOLS.find((t) => t.name === name)!;
    assert.ok((tool.inputSchema as any).properties.draft, `${name} declares draft`);
    const r = await app.mcp(name, { env: 'hld', draft: 'reads', ...args });
    if (name === 'get_exchange') assert.match(r.text, /not found/, name); // nothing by that key, but the draft was accepted
    else assert.equal(r.isError, false, `${name}: ${r.text.slice(0, 200)}`);
    assert.match((await app.mcp(name, { env: 'hld', draft: 'nope', ...args })).text, /NOT_FOUND/, `${name} unknown draft`);
    assert.match((await app.mcp(name, { env: 'hld', draft: 'closed', ...args })).text, /DRAFT_CLOSED/, `${name} closed draft`);
  }
  assert.equal((await app.mcp('get_service', { env: 'hld', service: 'pop' })).isError, true, 'without the draft pop does not exist');
  assert.ok((await app.mcp('list_entry_points', { env: 'hld', draft: 'reads' })).json.some((e: any) => e.service === 'pop'));
  assert.ok((await app.mcp('inventory', { env: 'hld', draft: 'reads', type: 'service' })).json.some((x: any) => x.id === 'pop'));
});
