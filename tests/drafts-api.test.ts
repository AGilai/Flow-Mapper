// Drafts through REST and MCP (QA A1-A6, K1, K2): create / list / rename / discard, validation, apply as one delta per
// service in one transaction, newer edit wins, dry run, concurrency, AI edits.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign } from './helpers.ts';
import { size } from '../server/graph-cache.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());

const D = '/api/envs/hld/drafts';
const egress = (id: string, to = 'users-svc/x') => ({ id, transport: 'http', mode: 'sync', bindKey: `http:GET ${to}` });
const ingress = (id: string, handler = 'H') => ({ id, transport: 'http', bindKey: `http:GET auth-svc/${id}`, handler });
const up = (anchor: string, data: unknown, service?: string) => ({ op: 'upsert', anchor, data, ...(service ? { service } : {}) });
const open = async (name: string) => (await app.call('POST', D, { name, createdBy: 'ana' })).body;
const ops = (slug: string, list: unknown[], extra: object = {}) => app.call('POST', `${D}/${slug}/ops`, { ops: list, ...extra });
const version = async (s: string) => (await app.call('GET', `/api/envs/hld/services/${s}`)).body.service.version;
const changelog = async () => (await app.call('GET', '/api/envs/hld/changelog?limit=500')).body as any[];
const rows = (sql: string, ...a: any[]) => app.ctx.db.prepare(sql).all(...a) as any[];

test('A1 create / list / rename / read as the draft / discard: the environment and its changelog stay untouched', async () => {
  const before = (await changelog()).length, v = await version('auth-svc');
  const d = await open('Try tokens');
  assert.equal(d.slug, 'try-tokens'); assert.equal(d.status, 'open');
  assert.equal((await app.call('POST', D, { name: 'Try tokens' })).body.slug, 'try-tokens-2', 'slug clash is numbered');
  assert.equal((await app.call('POST', D, { name: 'x', slug: 'try-tokens' })).status, 409);
  assert.equal((await app.call('PATCH', `${D}/try-tokens`, { name: 'Renamed' })).body.name, 'Renamed');
  const r = await ops('try-tokens', [up('ing:auth-svc/in.t', ingress('in.t')), up('fn:auth-svc/H', { id: 'H', name: 'H', steps: [] })], { author: 'ana' });
  assert.equal(r.status, 201); assert.deepEqual([r.body.from, r.body.to], [1, 2]);
  const epBase = (await app.call('GET', '/api/envs/hld/entry-points')).body.length;
  const view = (await app.call('GET', '/api/envs/hld/services/auth-svc/ingress?draft=try-tokens')).body;
  assert.ok(view.some((i: any) => i.id === 'in.t'), 'the draft view has the new endpoint');
  assert.ok(!(await app.call('GET', '/api/envs/hld/services/auth-svc/ingress')).body.some((i: any) => i.id === 'in.t'), 'the environment does not');
  assert.equal((await app.call('GET', '/api/envs/hld/entry-points')).body.length, epBase);
  const cached = size();
  assert.equal((await app.call('DELETE', `${D}/try-tokens`)).body.discarded, 'try-tokens');
  assert.ok(size() < cached, 'the draft graph left the cache');
  assert.equal((await app.call('GET', '/api/envs/hld/inventory?draft=try-tokens')).status, 409);
  assert.equal((await app.call('POST', `${D}/try-tokens/ops`, { ops: [up('svc:x', { kind: 'service' })] })).body.error.code, 'DRAFT_CLOSED');
  const kept = (await app.call('GET', `${D}/try-tokens`)).body;
  assert.equal(kept.status, 'discarded'); assert.equal(kept.ops.length, 2, 'ops are kept for the record');
  assert.equal((await changelog()).length, before); assert.equal(await version('auth-svc'), v);
  assert.deepEqual((await app.call('GET', `${D}?status=all`)).body.map((x: any) => x.slug).includes('try-tokens'), true);
  assert.equal((await app.call('GET', `${D}`)).body.some((x: any) => x.slug === 'try-tokens'), false, 'open only by default');
});

test('create: sealed env refuses (ENV_SEALED), unknown env 404, name required', async () => {
  assert.equal((await app.call('POST', '/api/envs/prod/drafts', { name: 'x' })).body.error.code, 'ENV_SEALED');
  assert.equal((await app.call('POST', '/api/envs/nope/drafts', { name: 'x' })).status, 404);
  assert.equal((await app.call('POST', D, {})).status, 422);
  assert.equal((await app.call('GET', '/api/envs/hld/drafts/missing')).status, 404);
});

test('validation: NO_SERVICE, key differs from anchor, bad header, bad anchor; all or nothing with details[i]', async () => {
  const d = await open('Validate');
  const bad = async (list: unknown[]) => (await ops(d.slug, list)).body.error;
  assert.equal((await bad([up('ing:ghost/in.x', ingress('in.x'))])).code, 'NO_SERVICE');
  assert.equal((await bad([up('ing:auth-svc/in.a', ingress('in.b'))])).code, 'INVALID');
  assert.equal((await bad([up('svc:Bad_Name', { kind: 'service' })])).code, 'INVALID');
  assert.equal((await bad([up('svc:pop', { kind: 'nonsense' })])).code, 'BAD_KIND'); // 0.25.0: a kind outside the enum has its own code
  assert.equal((await bad([up('wat:x', {})])).code, 'INVALID');
  assert.equal((await bad([up('ch:sns:t', { bindKey: 'sns:t', kind: 'sns-topic' })])).code, 'INVALID', 'a new channel needs its owner');
  const e = await bad([up('ing:auth-svc/in.ok', ingress('in.ok')), up('ing:auth-svc/in.x', { id: 'in.x' }), { op: 'delete', anchor: 'fn:auth-svc/H', data: {} }]);
  assert.deepEqual(e.details.map((x: any) => x.index), [1, 2]);
  assert.equal((await app.call('GET', `${D}/${d.slug}/changes`)).body.items.length, 0, 'nothing was appended');
  await app.call('DELETE', `${D}/${d.slug}`);
});

test('A2 apply: a full manifest per new service, a delta (+1) per touched one, summary row, draft_id on the rows', async () => {
  const d = await open('Agent connects');
  const v0 = { auth: await version('auth-svc'), users: await version('users-svc') }, log0 = (await changelog()).length;
  const r = await ops(d.slug, [
    up('svc:pop-edge', { kind: 'service', groupPath: 'agent', team: 'net' }),
    up('fn:pop-edge/H', { id: 'H', name: 'H', steps: [{ seq: 1, type: 'egress', target: 'out.tok' }] }),
    up('ing:pop-edge/in.open', { id: 'in.open', transport: 'socket', bindKey: 'socket:tls/pop-edge/open', handler: 'H' }),
    up('egr:pop-edge/out.tok', { id: 'out.tok', transport: 'http', mode: 'sync', bindKey: 'http:POST auth-svc/token' }),
    up('fn:auth-svc/Tok', { id: 'Tok', name: 'Tok', steps: [] }),
    up('ing:auth-svc/in.token', { id: 'in.token', transport: 'http', bindKey: 'http:POST auth-svc/token', handler: 'Tok' }),
    up('egr:users-svc/out.lookup', egress('out.lookup', 'auth-svc/verify')),   // users-svc: copied without functions, handlers dangle
  ]);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const ch = (await app.call('GET', `${D}/${d.slug}/changes`)).body;
  assert.deepEqual(ch.counts, { added: 4, removed: 0, changed: 0 }, 'pop-edge, two auth-svc items, one users-svc item; pop-edge children are not counted');
  assert.equal(ch.items.filter((i: any) => i.under).length, 3, 'children of the new component are listed under it');
  const res = await app.call('POST', `${D}/${d.slug}/apply`, { by: 'ana' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.applied, true);
  assert.deepEqual(res.body.results.map((x: any) => [x.service, x.fromVersion, x.toVersion]).sort(), [['auth-svc', v0.auth, v0.auth + 1], ['pop-edge', null, 1], ['users-svc', v0.users, v0.users + 1]].sort());
  const log = (await changelog()).slice(0, (await changelog()).length - log0);
  assert.equal(log.length, 4, 'one row per touched service plus one summary row');
  assert.deepEqual(log.filter((r) => r.draft_id).length, 4);
  const summary = log.find((r) => r.kind === 'draft');
  assert.equal(summary.service, ''); assert.equal(summary.changes.draft, d.slug); assert.equal(summary.changes.counts.added, 4);
  assert.deepEqual(rows('SELECT status, closed_by FROM drafts WHERE slug = ?', d.slug).map((x) => ({ ...x })), [{ status: 'applied', closed_by: 'ana' }]);
  assert.equal((await ops(d.slug, [up('svc:x', { kind: 'service' })])).body.error.code, 'DRAFT_CLOSED');
  const ep = (await app.call('GET', '/api/envs/hld/entry-points')).body;
  assert.ok(ep.some((e: any) => e.service === 'pop-edge' && e.id === 'in.open'));
  assert.equal((await app.call('GET', '/api/envs/hld/services/pop-edge')).body.service.groupPath, 'agent');
});

test('A3 one transaction: an integrity error in the second service leaves the first unchanged, the draft stays open', async () => {
  const d = await open('Broken');
  const v = { auth: await version('auth-svc'), users: await version('users-svc') };
  await ops(d.slug, [up('fn:auth-svc/F1', { id: 'F1', name: 'F1', steps: [] }), up('ing:auth-svc/in.f1', ingress('in.f1', 'F1')), up('ing:users-svc/in.bad', { ...ingress('in.bad', 'nope'), bindKey: 'http:GET users-svc/bad' })]);
  const r = await app.call('POST', `${D}/${d.slug}/apply`, {});
  assert.equal(r.status, 422, JSON.stringify(r.body));
  assert.equal(await version('auth-svc'), v.auth); assert.equal(await version('users-svc'), v.users);
  assert.equal(rows('SELECT status FROM drafts WHERE slug = ?', d.slug)[0].status, 'open');
  await app.call('DELETE', `${D}/${d.slug}`);
});

test('A5 an empty draft, or ops equal to the environment, cannot be applied: 409 DRAFT_EMPTY, no version bump', async () => {
  const d = await open('Nothing');
  assert.equal((await app.call('POST', `${D}/${d.slug}/apply`, {})).body.error.code, 'DRAFT_EMPTY');
  const same = (await app.call('GET', '/api/envs/hld/services/auth-svc/ingress')).body[0];
  await ops(d.slug, [up(`ing:auth-svc/${same.id}`, same)]);
  const v = await version('auth-svc');
  assert.equal((await app.call('POST', `${D}/${d.slug}/apply`, {})).body.error.code, 'DRAFT_EMPTY');
  assert.equal(await version('auth-svc'), v);
  await app.call('DELETE', `${D}/${d.slug}`);
});

test('newer edit wins: an item changed since the draft touched it is overwritten and listed in `replaced`', async () => {
  const a = await open('First'), b = await open('Second');
  const item = (t: string) => egress('out.race', `users-svc/${t}`);
  await ops(a.slug, [up('egr:auth-svc/out.race', item('a'))]);
  await ops(b.slug, [up('egr:auth-svc/out.race', item('b')), up('egr:auth-svc/out.other', egress('out.other'))]);
  assert.equal((await app.call('GET', `${D}/${b.slug}/changes`)).body.items.find((i: any) => i.anchor === 'egr:auth-svc/out.race').stale, false);
  assert.equal((await app.call('POST', `${D}/${a.slug}/apply`, {})).status, 200);
  const ch = (await app.call('GET', `${D}/${b.slug}/changes`)).body;
  assert.equal(ch.items.find((i: any) => i.anchor === 'egr:auth-svc/out.race').stale, true, 'the bar can warn before apply');
  assert.equal(ch.items.find((i: any) => i.anchor === 'egr:auth-svc/out.other').stale, false);
  const r = await app.call('POST', `${D}/${b.slug}/apply`, {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.replaced.map((x: any) => x.anchor), ['egr:auth-svc/out.race']);
  assert.equal(r.body.replaced[0].now.bindKey, 'http:GET users-svc/a');
  assert.equal((await app.call('GET', '/api/envs/hld/services/auth-svc/egress/out.race')).body.bindKey, 'http:GET users-svc/b');
});

test('dry run: runs everything, returns results with the contract, writes nothing; the draft stays open', async () => {
  const d = await open('Dry');
  await ops(d.slug, [up('egr:auth-svc/out.dry', egress('out.dry', 'nobody/none'))]);
  const v = await version('auth-svc'), log = (await changelog()).length;
  const r = await app.call('POST', `${D}/${d.slug}/apply?dryRun=1`, {});
  assert.equal(r.status, 200); assert.equal(r.body.dryRun, true);
  assert.equal(r.body.results[0].toVersion, v + 1);
  assert.ok(r.body.results[0].contract.findings.some((f: any) => f.code === 'dangling-egress'), 'contract is reported');
  assert.equal(await version('auth-svc'), v); assert.equal((await changelog()).length, log);
  assert.equal(rows('SELECT status FROM drafts WHERE slug = ?', d.slug)[0].status, 'open');
  await app.call('DELETE', `${D}/${d.slug}`);
});

test('undo and revert: undo removes the last op, revert one item drops its ops (svc: also the component\'s items)', async () => {
  const d = await open('Undo');
  await ops(d.slug, [up('egr:auth-svc/o1', egress('o1'))]);
  await ops(d.slug, [up('svc:tmp', { kind: 'service' }), up('egr:tmp/o2', egress('o2'))]);
  assert.deepEqual((await app.call('DELETE', `${D}/${d.slug}/ops/last`)).body, { removed: 3 });
  assert.equal((await app.call('DELETE', `${D}/${d.slug}/ops?anchor=egr:auth-svc/o1`)).body.removed, 1);
  assert.equal((await app.call('DELETE', `${D}/${d.slug}/ops?anchor=svc:tmp`)).body.removed, 1);
  assert.equal((await app.call('DELETE', `${D}/${d.slug}/ops?anchor=svc:tmp`)).status, 404);
  assert.equal((await app.call('DELETE', `${D}/${d.slug}/ops`)).status, 400);
  assert.equal((await app.call('DELETE', `${D}/${d.slug}/ops/last`)).status, 404, 'nothing left to undo');
  await app.call('DELETE', `${D}/${d.slug}`);
});

test('K1 twenty concurrent appends: seq 1..20, no op lost', async () => {
  const d = await open('Concurrent');
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => ops(d.slug, [up(`egr:auth-svc/c${i}`, egress(`c${i}`))], { author: `u${i}` })));
  assert.ok(rs.every((r) => r.status === 201));
  const got = (await app.call('GET', `${D}/${d.slug}`)).body.ops.map((o: any) => o.seq);
  assert.deepEqual(got, Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal((await app.call('GET', `${D}/${d.slug}/changes`)).body.counts.added, 20);
  await app.call('DELETE', `${D}/${d.slug}`);
});

test('K2 two applies at once: one 200, one 409 DRAFT_CLOSED; the version bumps once', async () => {
  const d = await open('Twice');
  await ops(d.slug, [up('egr:auth-svc/t1', egress('t1'))]);
  const v = await version('auth-svc');
  const rs = await Promise.all([app.call('POST', `${D}/${d.slug}/apply`, {}), app.call('POST', `${D}/${d.slug}/apply`, {})]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(rs.find((r) => r.status === 409)!.body.error.code, 'DRAFT_CLOSED');
  assert.equal(await version('auth-svc'), v + 1);
});

test('A6 MCP: open_draft, edit_in_draft (by_ai, author assistant), draft_changes, apply_draft give the same rows as REST', async () => {
  const o = await app.mcp('open_draft', { env: 'hld', name: 'By assistant' });
  assert.equal(o.json.slug, 'by-assistant');
  assert.equal((await app.mcp('open_draft', { env: 'hld', slug: 'by-assistant' })).json.id, o.json.id, 'same slug opens the same draft');
  const e = await app.mcp('edit_in_draft', { env: 'hld', draft: 'by-assistant', ops: [up('egr:auth-svc/m1', egress('m1'))] });
  assert.deepEqual([e.json.from, e.json.to], [1, 1]);
  const rest = (await app.call('GET', `${D}/by-assistant`)).body.ops[0];
  assert.deepEqual([rest.author, rest.byAi], ['assistant', true]);
  assert.equal(rows('SELECT by_ai FROM draft_ops WHERE draft_id = ?', o.json.id)[0].by_ai, 1);
  assert.equal((await app.mcp('draft_changes', { env: 'hld', draft: 'by-assistant' })).json.counts.added, 1);
  assert.equal((await app.mcp('list_drafts', { env: 'hld' })).json.some((x: any) => x.slug === 'by-assistant'), true);
  const dry = await app.mcp('apply_draft', { env: 'hld', draft: 'by-assistant', dryRun: true });
  assert.equal(dry.json.dryRun, true);
  const v = await version('auth-svc');
  const ap = await app.mcp('apply_draft', { env: 'hld', draft: 'by-assistant' });
  assert.equal(ap.json.applied, true); assert.equal(await version('auth-svc'), v + 1);
  assert.equal((await app.mcp('discard_draft', { env: 'hld', draft: 'by-assistant' })).isError, true, 'closed');
  assert.match((await app.mcp('open_draft', { env: 'prod', name: 'x' })).text, /ENV_SEALED/);
});
