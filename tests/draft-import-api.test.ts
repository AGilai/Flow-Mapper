// Import one level into a draft through REST and MCP: preview = ops, the baseline of imported items lives on the ops (no New mark, no ghost
// after undo), apply copies it into baseline_items, discard leaves none, drift is seen against the source, errors, sealed refusal.
// Data: the samples; design `hld` = Components copy of users-svc and auth-svc, so in.getPosture there is a reference (no functions).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readSample, startDesign } from './helpers.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
const D = '/api/envs/hld/drafts', P = 'ing:users-svc/in.getPosture';
const rows = (sql: string, ...a: any[]) => app.ctx.db.prepare(sql).all(...a) as any[];
before(async () => {
  app = await startDesign();
  const sc = readSample('schemas/prod.json');
  assert.equal((await app.call('POST', `/api/envs/${sc.env}/schemas`, { schemas: sc.schemas })).status, 201);
});
after(() => app.close());

const open = async (name: string, env = 'hld') => (await app.call('POST', `/api/envs/${env}/drafts`, { name })).body.slug as string;
const preview = async (slug: string, anchor = P, source = 'prod', env = 'hld') => app.call('GET', `/api/envs/${env}/drafts/${slug}/import/preview?source=${source}&anchor=${encodeURIComponent(anchor)}`);
const imp = async (slug: string, anchor = P, extra: object = {}, env = 'hld') => app.call('POST', `/api/envs/${env}/drafts/${slug}/import`, { source: 'prod', anchor, ...extra });
const marks = async (slug: string | null, q = '') => (await app.call('GET', `/api/envs/hld/marks?${slug ? `draft=${slug}&` : ''}${q}`)).body;
const pv = async () => (await app.call('GET', '/api/envs/prod/services/users-svc')).body.service.version as number;

test('preview reads only, and its total is the number of ops the import appends; the import answers {from, to, counts, preview}', async () => {
  const d = await open('imp-1');
  const p = (await preview(d)).body;
  assert.deepEqual([p.level, p.source, p.counts.functions], ['endpoint', 'prod', 2]);
  assert.ok(p.items.some((i: any) => i.anchor === 'fn:users-svc/get_posture' && i.why === 'handler') && p.items.some((i: any) => i.anchor === 'schema:code/postgres:users-db/users' && i.why === 'schema'));
  assert.equal((await app.call('GET', `${D}/${d}`)).body.ops.length, 0, 'the preview wrote nothing');
  const r = await imp(d);
  assert.equal(r.status, 201); assert.equal(r.body.to - r.body.from + 1, p.total); assert.deepEqual(r.body.preview, p);
  assert.deepEqual(r.body.counts, { added: p.total, removed: 0, changed: 0 }, 'imported items are added to the environment');
  const stored = (await app.call('GET', `${D}/${d}`)).body.ops;
  assert.ok(stored.every((o: any) => o.origin?.env === 'prod' && o.origin.version === (o.service ? 22 : null)), 'each op carries its origin: source env and its service version (none for a schema)');
  assert.ok(stored.every((o: any) => o.author === 'anonymous' && !o.byAi));
});

test('after the import: no mark under the imported anchors, the reference is gone from refs, undo leaves no ghost, a later edit shows Changed', async () => {
  const d = await open('imp-2');
  const before = await marks(d);
  assert.ok(before.refs.endpoints[P], 'a Components copy: the endpoint is a reference');
  await imp(d);
  const m = await marks(d);
  for (const a of ['fn:users-svc/get_posture', 'fn:users-svc/load_devices', 'svc:users-svc', 'schema:code/postgres:users-db/users', P]) assert.equal(m.marks[a], undefined, `no mark on ${a}`);
  assert.deepEqual(m.ghosts, {});
  assert.equal(m.refs.endpoints[P], undefined);
  assert.deepEqual([m.refs.origins[P].from, m.refs.origins[P].inDraft, m.refs.origins[P].imported], ['prod', true, true]);
  assert.equal((await marks(null)).refs.endpoints[P].source, 'prod', 'the environment itself is unchanged');
  await app.call('POST', `${D}/${d}/ops`, { ops: [{ op: 'upsert', anchor: 'fn:users-svc/load_devices', data: { id: 'load_devices', name: 'load_devices', steps: [{ seq: 1, type: 'resource', target: 'usersDb', operation: 'SELECT devices WHERE os = ?' }] } }] });
  assert.equal((await marks(d)).marks['fn:users-svc/load_devices'].mark, 'changed', 'edited after the import: Changed against the imported baseline');
  assert.equal((await marks(d)).marks['fn:users-svc/get_posture'], undefined);
  await app.call('DELETE', `${D}/${d}/ops/last`);
  const ops = (await app.call('GET', `${D}/${d}`)).body.ops.length;
  for (let i = 0; i < ops; i++) assert.equal((await app.call('DELETE', `${D}/${d}/ops/last`)).status, 200);
  const undone = await marks(d);
  assert.deepEqual([undone.marks, undone.ghosts, !!undone.refs.endpoints[P]], [before.marks, before.ghosts, true], 'undoing the import ops leaves no ghost and the reference is back');
  assert.equal((await app.call('POST', `${D}/${d}/ops`, { ops: [{ op: 'delete', anchor: 'fn:users-svc/get_posture' }, { op: 'upsert', anchor: 'svc:x', data: { kind: 'service' }, origin: { env: 'prod', version: 1 } }] })).status, 422, 'origin is set by import only');
});

test('imported then removed in the same draft: never a Removed mark; deleting the component drops its imports', async () => {
  const d = await open('imp-3');
  await imp(d);
  await app.call('POST', `${D}/${d}/ops`, { ops: [{ op: 'delete', anchor: 'fn:users-svc/load_devices' }] });
  assert.equal((await marks(d)).marks['fn:users-svc/load_devices'], undefined);
  assert.equal(Object.keys((await marks(d)).ghosts).length, 0);
  await app.call('POST', `${D}/${d}/ops`, { ops: [{ op: 'delete', anchor: 'svc:users-svc' }] });
  const m = await marks(d);
  assert.equal(m.marks['svc:users-svc'].mark, 'removed'); assert.equal(m.marks['fn:users-svc/get_posture'], undefined);
});

test('apply copies the imported baseline into baseline_items (source env, source version): marks after apply are clean; drift shows against the source', async () => {
  const d = await open('imp-4');
  await imp(d);
  assert.equal(rows("SELECT 1 FROM baseline_items WHERE env = 'hld' AND key = 'get_posture'").length, 0, 'until apply the baseline lives on the ops');
  const r = await app.call('POST', `${D}/${d}/apply`, { by: 'me' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = rows("SELECT source_env, source_version, taken_at FROM baseline_items WHERE env = 'hld' AND list = 'functions' AND key = 'get_posture'")[0];
  assert.deepEqual([b.source_env, b.source_version], ['prod', await pv()]);
  const log = (await app.call('GET', '/api/envs/hld/changelog?limit=5')).body[0];
  assert.equal(JSON.parse(typeof log.changes === 'string' ? log.changes : JSON.stringify(log.changes)).imported, 3);
  const m = await marks(null);
  assert.equal(m.marks['fn:users-svc/get_posture'], undefined); assert.equal(m.marks['svc:users-svc'], undefined);
  assert.deepEqual([m.refs.origins[P].from, m.refs.origins[P].imported, m.refs.origins[P].inDraft], ['prod', true, undefined]);
  assert.equal(m.refs.endpoints[P], undefined);
  assert.equal((await marks(null, 'against=source')).marks['fn:users-svc/get_posture'], undefined, 'prod has not moved');
  const delta = { schemaVersion: '1.0', kind: 'delta', env: 'prod', service: { name: 'users-svc' }, baseVersion: await pv(), version: (await pv()) + 1, harvestedAt: '2026-10-20T00:00:00Z',
    upsert: { functions: [{ id: 'get_posture', name: 'get_posture', steps: [{ seq: 1, type: 'call', target: 'load_devices' }, { seq: 2, type: 'resource', target: 'cache', operation: 'GET posture:{id}' }] }] } };
  assert.equal((await app.call('POST', '/api/ingest', delta)).status, 201);
  assert.equal((await marks(null, 'against=source')).marks['fn:users-svc/get_posture'].mark, 'changed', 'prod moved: drift on the imported function');
  assert.equal((await marks(null)).marks['fn:users-svc/get_posture'], undefined, 'against the baseline nothing moved');
  const e = await app.call('POST', `${D}/${await open('imp-4b')}/import`, { source: 'prod', anchor: 'fn:users-svc/get_posture' });
  assert.equal(e.body.error.code, 'BAD_ANCHOR');
});

test('discard keeps no baseline rows; the import of a design source brings the functions of its Full copy, origin = that design', async () => {
  const d = await open('imp-5');
  await imp(d, 'ing:users-svc/in.getContact');
  const n = rows("SELECT count(*) AS n FROM baseline_items WHERE env = 'hld'")[0].n;
  await app.call('DELETE', `${D}/${d}`);
  assert.equal(rows("SELECT count(*) AS n FROM baseline_items WHERE env = 'hld'")[0].n, n, 'discard writes no baseline');
  assert.equal((await app.call('POST', '/api/envs', { name: 'hld-v2', source: 'hld', mode: 'full' })).status, 201);
  assert.equal((await app.call('POST', '/api/envs', { name: 'blank-x', source: 'prod', mode: 'blank', groups: [{ key: 'platform', label: 'Platform' }] })).status, 201);
  const x = await open('from-design', 'blank-x');
  const r = await app.call('POST', `/api/envs/blank-x/drafts/${x}/import`, { source: 'hld-v2', anchor: P, groupPath: 'platform' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const stored = (await app.call('GET', `/api/envs/blank-x/drafts/${x}`)).body.ops;
  assert.ok(stored.every((o: any) => o.origin.env === 'hld-v2'));
  assert.ok(stored.some((o: any) => o.anchor === 'fn:users-svc/get_posture'), 'a Full copy has the functions');
  assert.equal(stored.find((o: any) => o.anchor === 'svc:users-svc').data.groupPath, 'platform');
  const m = (await app.call('GET', `/api/envs/blank-x/marks?draft=${x}`)).body;
  assert.equal(m.marks['svc:users-svc'], undefined, 'imported: no mark');
  assert.equal(m.refs.endpoints['ing:auth-svc/in.verify'].source, 'hld-v2', 'the stub reference of the callee points at the design it came from');
});

test('MCP import_preview / import_into_draft give the same ops, recorded as an AI edit', async () => {
  const a = await open('imp-mcp-a'), b = await open('imp-mcp-b'), C = 'ing:users-svc/in.getContact';
  await imp(a, C);
  const pr = await app.mcp('import_preview', { env: 'hld', draft: b, source: 'prod', anchor: C });
  assert.equal(pr.isError, false, pr.text);
  const r = await app.mcp('import_into_draft', { env: 'hld', draft: b, source: 'prod', anchor: C });
  assert.equal(r.isError, false, r.text);
  assert.deepEqual(r.json.preview, pr.json);
  const [x, y] = await Promise.all([a, b].map(async (s) => (await app.call('GET', `${D}/${s}`)).body.ops));
  assert.deepEqual(y.map((o: any) => [o.anchor, o.origin]), x.map((o: any) => [o.anchor, o.origin]));
  assert.ok(y.every((o: any) => o.byAi === true && o.author === 'assistant') && x.every((o: any) => !o.byAi));
  assert.match((await app.mcp('import_into_draft', { env: 'hld', draft: b, source: 'prod', anchor: C })).text, /NOTHING_TO_IMPORT/);
});

test('errors: sealed target, unknown / same source, NO_ITEM, BAD_ANCHOR, NOTHING_TO_IMPORT, NO_GROUP, closed draft', async () => {
  assert.equal((await imp('whatever', P, {}, 'prod')).body.error.code, 'ENV_SEALED');
  assert.equal((await preview('whatever', P, 'prod', 'prod')).body.error.code, 'ENV_SEALED');
  assert.equal((await app.mcp('import_into_draft', { env: 'prod', draft: 'x', source: 'hld', anchor: P })).isError, true);
  const d = await open('imp-err');
  const code = async (anchor: string, extra: object = {}, source = 'prod') => { const r = await app.call('POST', `${D}/${d}/import`, { source, anchor, ...extra }); return [r.status, r.body.error?.code]; };
  assert.deepEqual(await code(P, {}, 'nope'), [404, 'NOT_FOUND']);
  assert.deepEqual(await code(P, {}, 'hld'), [400, 'BAD_REQUEST']);
  assert.deepEqual(await code('ing:users-svc/in.nope'), [404, 'NO_ITEM']);
  assert.deepEqual(await code('egr:users-svc/out.auth.verify'), [400, 'BAD_ANCHOR']);
  assert.deepEqual(await code('svc:users-svc', { groupPath: 'nope' }), [422, 'NO_GROUP']);
  assert.deepEqual(await code('ing:users-svc/in.getUser'), [201, undefined]);
  assert.deepEqual(await code('ing:users-svc/in.getUser'), [409, 'NOTHING_TO_IMPORT']);
  await app.call('DELETE', `${D}/${d}`);
  assert.deepEqual(await code('svc:users-svc'), [409, 'DRAFT_CLOSED']);
  assert.equal((await app.call('POST', `${D}/missing/import`, { source: 'prod', anchor: P })).status, 404);
});
