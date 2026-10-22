// HTTP API end to end: ingest, versions/deltas, CRUD, queries, bugs, MCP.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readSample, sampleManifests, startApp } from './helpers.ts';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  const r = await app.call('POST', '/api/ingest', { manifests: sampleManifests() });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});
after(() => app.close());

test('services list includes health', async () => {
  const r = await app.call('GET', '/api/envs/prod/services');
  assert.equal(r.status, 200);
  const orders = r.body.find((s: any) => s.name === 'orders-svc');
  assert.equal(orders.version, 12);
  assert.equal(orders.health.dangling, 1);
});

test('schema errors come back as 422 with paths', async () => {
  const bad = { ...readSample('orders-svc.json'), version: 99, ingress: [{ id: 'x' }] };
  const r = await app.call('POST', '/api/ingest', bad);
  assert.equal(r.status, 422);
  assert.ok(r.body.error.details.some((d: any) => d.path.startsWith('$.ingress[0]')));
});

test('a failing manifest in a batch is identified by index and service name', async () => {
  const ok = { ...readSample('orders-svc.json'), version: 200 };
  const bad = { ...readSample('orders-svc.json'), service: { name: 'second-svc', kind: 'service' }, version: 99, ingress: [{ id: 'x' }] };
  const r = await app.call('POST', '/api/ingest', { manifests: [ok, bad] });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.details.batchIndex, 1);
  assert.equal(r.body.error.details.service, 'second-svc');
  assert.ok(r.body.error.details.errors.some((d: any) => d.path.startsWith('$.ingress[0]')));
  const stale = await app.call('POST', '/api/ingest', { manifests: [{ ...ok, version: 1 }, ok] });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.details.batchIndex, 0);
  assert.equal(stale.body.error.details.service, ok.service.name);
  assert.equal(typeof stale.body.error.details.currentVersion, 'number');
});

test('integrity errors are rejected', async () => {
  const bad = readSample('orders-svc.json');
  bad.version = 50;
  bad.ingress[0].handler = 'NoSuchFn';
  const r = await app.call('POST', '/api/ingest', bad);
  assert.equal(r.status, 422);
  assert.match(JSON.stringify(r.body.error.details), /NoSuchFn/);
});

test('delta: applies on matching base, rejects stale base, rejects old versions', async () => {
  const delta = readSample('deltas/orders-svc.v13.json');
  const ok = await app.call('POST', '/api/ingest', delta);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.results[0].changes.removed, { egress: ['users.getPrefs'] });
  const again = await app.call('POST', '/api/ingest', { ...delta, version: 14 });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'VERSION_MISMATCH');
  const old = await app.call('POST', '/api/ingest', { ...readSample('orders-svc.json'), version: 13 });
  assert.equal(old.body.error.code, 'VERSION_NOT_NEWER');
  const h = await app.call('GET', '/api/envs/prod/health');
  assert.equal(h.body.items.dangling.filter((d: any) => d.service === 'orders-svc').length, 0);
});

test('Edits of a design env go through a draft: one delta bumps the version and writes the changelog; the entity routes are gone', async () => {
  // Manual edits are refused everywhere (prod is sealed: harvesters only; a design is edited through a draft), so the test copies prod first.
  assert.equal((await app.call('POST', '/api/envs', { name: 'crud-test', source: 'prod', mode: 'full' })).status, 201);
  const fn0 = { id: 'x', name: 'x', steps: [] };
  for (const env of ['prod', 'crud-test']) assert.ok([404, 405].includes((await app.call('POST', `/api/envs/${env}/services/users-svc/functions`, fn0)).status), `the entity routes are gone (0.25.0): ${env}`);
  const before = (await app.call('GET', '/api/envs/crud-test/services/users-svc')).body.service.version;
  const fn = { id: 'get_prefs', name: 'get_prefs', steps: [{ seq: 1, type: 'resource', target: 'usersDb', operation: 'SELECT prefs' }] };
  const ing = { id: 'in.prefs', bindKey: 'http:GET users-svc/users/{id}/prefs', transport: 'http', handler: 'get_prefs' };
  const D = '/api/envs/crud-test/drafts';
  assert.equal((await app.call('POST', D, { name: 'prefs', slug: 'prefs' })).status, 201);
  assert.equal((await app.call('POST', `${D}/prefs/ops`, { ops: [{ op: 'upsert', anchor: 'fn:users-svc/get_prefs', data: fn }, { op: 'upsert', anchor: 'ing:users-svc/in.prefs', data: ing }] })).status, 201);
  const put = await app.call('POST', `${D}/prefs/apply`, {});
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.results[0].toVersion, before + 1, 'one delta for the service, however many ops');
  // a function an ingress still uses cannot go (the apply is refused as a whole, the draft stays open)
  assert.equal((await app.call('POST', D, { name: 'drop', slug: 'drop' })).status, 201);
  await app.call('POST', `${D}/drop/ops`, { ops: [{ op: 'delete', anchor: 'fn:users-svc/get_prefs' }] });
  const del = await app.call('POST', `${D}/drop/apply`, {});
  assert.equal(del.status, 422, 'cannot delete a function an ingress still uses');
  const ch = await app.call('GET', '/api/envs/crud-test/services/infra/channels/sqs:orders-dlq');
  assert.equal(ch.body.kind, 'sqs-queue', 'keys with colons/slashes resolve');
  const log = await app.call('GET', '/api/envs/crud-test/changelog?service=users-svc&limit=5');
  assert.equal(log.body[0].kind, 'delta');
  assert.ok(log.body[0].draft_id > 0, 'the row says which draft wrote it');
  assert.deepEqual(log.body[0].changes.added, { functions: ['get_prefs'], ingress: ['in.prefs'] });
});

test('views: system, service, trace, paths, search, entry points', async () => {
  const sys = await app.call('GET', '/api/envs/prod/views/system');
  assert.ok(sys.body.nodes.length > 10 && sys.body.edges.length > 10);
  const sv = await app.call('GET', '/api/envs/prod/views/service/orders-svc');
  assert.ok(sv.body.ingress.find((i: any) => i.id === 'in.create').callers.some((c: any) => c.service === 'api-gateway'));
  const tr = await app.call('GET', '/api/envs/prod/trace?detail=full&service=api-gateway&ingress=in.createOrder&scope=full');
  assert.equal(tr.status, 200);
  assert.ok(tr.body.messages.length > 10);
  const p = await app.call('GET', '/api/envs/prod/paths?from=api-gateway&to=notifications-svc');
  assert.ok(p.body.length >= 1);
  const s = await app.call('GET', '/api/envs/prod/search?q=order-events');
  assert.ok(s.body.some((h: any) => h.type === 'channel'));
  const ep = await app.call('GET', '/api/envs/prod/entry-points');
  assert.ok(ep.body.some((e: any) => e.service === 'api-gateway'));
  assert.equal((await app.call('GET', '/api/envs/prod/trace?detail=full&service=nope&fn=x')).status, 404);
});

test('bugs: report, prioritize, workflow, logs, comments', async () => {
  const created = await app.call('POST', '/api/bugs', {
    title: 'Trace misses payments', severity: 'S1', env: 'prod', channel: 'web',
    links: [{ type: 'service', id: 'orders-svc' }],
  });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(created.body.appVersion, app.ctx.appVersion);
  assert.ok(created.body.impact >= 1);
  assert.equal(created.body.priority, 'P0');

  const up = await app.call('POST', `/api/bugs/${id}/attachments?filename=run.log`, 'ERROR calling payments-svc from OrderService.place\n');
  assert.equal(up.status, 201);
  assert.ok(up.body.suggestions.some((s: any) => s.type === 'service' && s.id === 'payments-svc'));
  const raw = await fetch(`${app.base}/api/bugs/${id}/attachments/${up.body.id}`);
  assert.match(await raw.text(), /payments-svc/);

  const skip = await app.call('PATCH', `/api/bugs/${id}`, { status: 'verified' });
  assert.equal(skip.status, 409);
  assert.equal((await app.call('PATCH', `/api/bugs/${id}`, { status: 'in_progress', assignee: 'asaf' })).status, 200);
  const noVersion = await app.call('PATCH', `/api/bugs/${id}`, { status: 'fixed' });
  assert.equal(noVersion.status, 422);
  const fixed = await app.call('PATCH', `/api/bugs/${id}`, { status: 'fixed', fixedInVersion: '0.2.0', resolution: { type: 'code', ref: 'PR #9' } });
  assert.equal(fixed.body.status, 'fixed');
  assert.equal(fixed.body.needsVerification, true, 'running version >= fixedInVersion');

  const over = await app.call('PATCH', `/api/bugs/${id}`, { priority: 'P3' });
  assert.equal(over.body.priority, 'P3');
  assert.equal(over.body.priorityOverride, true);
  const c = await app.call('POST', `/api/bugs/${id}/comments`, { author: 'dana', body: 'confirmed' });
  assert.equal(c.body.comments.length, 1);

  await app.call('POST', '/api/bugs', { title: 'minor', severity: 'S4', env: 'prod' });
  const list = await app.call('GET', '/api/bugs?open=true');
  assert.ok(list.body.every((b: any) => ['open', 'triaged', 'in_progress'].includes(b.status)));
  assert.equal((await app.call('POST', '/api/bugs', { severity: 'S1' })).status, 422);
});

test('MCP over HTTP: initialize, list tools, call tools', async () => {
  const init = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal(init.body.result.serverInfo.name, 'flow-mapper');
  assert.equal((await app.call('POST', '/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const tools = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = tools.body.result.tools.map((t: any) => t.name);
  for (const n of ['search', 'trace_flow', 'link_health', 'report_bug', 'update_bug', 'edit_design']) assert.ok(names.includes(n), n);
  const call = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'trace_flow', arguments: { detail: 'full', env: 'prod', service: 'orders-svc', ingress: 'in.create', scope: 'intra' } } });
  assert.equal(call.body.result.isError, false);
  assert.ok(JSON.parse(call.body.result.content[0].text).messages.length > 3);
  const err = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_service', arguments: { env: 'prod', service: 'ghost' } } });
  assert.equal(err.body.result.isError, true);
  const bug = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'report_bug', arguments: { title: 'from agent', env: 'prod', log: 'shipping-svc timeout' } } });
  const b = JSON.parse(bug.body.result.content[0].text);
  assert.equal(b.channel, 'mcp');
  assert.equal(b.attachments.length, 1);
});

test('serves the UI and browser-ready core modules', async () => {
  const html = await fetch(app.base + '/');
  assert.match(await html.text(), /<div class="app"/);
  const core = await (await fetch(app.base + '/core/graph-index.js')).text();
  assert.match(core, /from '\.\/resolve\.js'/);
  assert.doesNotMatch(core, /import type|: GraphIndex/);
  const deep = await fetch(app.base + '/services/orders-svc');
  assert.equal(deep.status, 200, 'unknown paths fall back to the app shell');
  assert.equal((await fetch(app.base + '/core/../server/app.ts')).status, 404);
});

test('dry-run ingest validates and reports changes without writing', async () => {
  const m = readSample('users-svc.json');
  const before = (await app.call('GET', '/api/envs/prod/services/users-svc')).body.service.version;
  const ok = await app.call('POST', '/api/ingest?dryRun=1', { ...m, version: before + 1, resources: m.resources.filter((r: any) => r.id !== 'sessions') });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.dryRun, true);
  assert.deepEqual(ok.body.results[0].changes.removed.resources, ['sessions']);
  assert.equal((await app.call('GET', '/api/envs/prod/services/users-svc')).body.service.version, before, 'nothing written');
  const bad = await app.call('POST', '/api/ingest?dryRun=1', { ...m, version: before + 1, ingress: [{ id: 'x' }] });
  assert.equal(bad.status, 422);
  const old = await app.call('POST', '/api/ingest?dryRun=1', { ...m, version: 1 });
  assert.equal(old.body.error.code, 'VERSION_NOT_NEWER');
});

test('writes by another process show up without a restart', async () => {
  const { openDb } = await import('../server/db/connection.ts');
  const { ingest } = await import('../server/store/snapshots.ts');
  assert.equal((await app.call('GET', '/api/envs/prod/views/system')).status, 200); // warm the cache
  const other = openDb(app.dbPath);
  const m = { ...readSample('users-svc.json'), service: { ...readSample('users-svc.json').service, name: 'side-svc' }, version: 1 };
  ingest(other, m, 'seed');
  other.close();
  const names = (await app.call('GET', '/api/envs/prod/services')).body.map((s: any) => s.name);
  assert.ok(names.includes('side-svc'));
});

test('bugs can be polled by reporter and by change time, comments included', async () => {
  const a = await app.call('POST', '/api/bugs', { title: 'poll me', reporter: 'loader-x', env: 'prod' });
  await app.call('POST', '/api/bugs', { title: 'not mine', reporter: 'someone', env: 'prod' });
  const mine = (await app.call('GET', '/api/bugs?reporter=loader-x')).body;
  assert.deepEqual(mine.map((b: any) => b.title), ['poll me']);
  const since = new Date().toISOString();
  assert.equal((await app.call('GET', `/api/bugs?reporter=loader-x&updatedSince=${since}`)).body.length, 0);
  await new Promise((r) => setTimeout(r, 5));
  await app.call('POST', `/api/bugs/${a.body.id}/comments`, { author: 'flow-mapper', body: 'fixed in 0.3.1' });
  assert.equal((await app.call('GET', `/api/bugs?reporter=loader-x&updatedSince=${since}`)).body.length, 1);
});
