// Unreleased (frame 28d): the design doc of an environment = the Notes document with the anchor `env` (flow_notes, no migration): REST with versions, stale save,
// History and Restore, the document sanitizer on the way in and out, seed data (`doc: "env"`), and who may write it (cognito: a design needs editor rights, a
// sealed environment takes annotations from every reader, a hidden environment is 404), the same rules as a flow's Notes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign } from './helpers.ts';
import { startCognito } from './cognito-helpers.ts';
import { loadNotes } from '../server/store/notes.ts';
import { ENV_DOC, isEnvDoc } from '../core/notes.ts';

const DOC = '<h1>Design</h1><p>See <span data-ref="svc:orders-svc">orders-svc</span> <script>x()</script></p><div data-callout="risk" data-step="2"><p>careful</p></div><pre data-mermaid="1">sequenceDiagram\n  A-&gt;&gt;B: hi</pre>';
const CLEAN = '<h1>Design</h1><p>See <span data-ref="svc:orders-svc">orders-svc</span> </p><div data-callout="risk" data-step="2"><p>careful</p></div><pre data-mermaid="1">sequenceDiagram\n  A-&gt;&gt;B: hi</pre>';

test('the anchor `env` names the design doc; a flow anchor does not', () => {
  assert.equal(ENV_DOC, 'env'); assert.equal(isEnvDoc('env'), true); assert.equal(isEnvDoc('flow:a/b'), false); assert.equal(isEnvDoc(undefined), false);
});

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());
const get = (q = 'anchor=env', env = 'prod') => app.call('GET', `/api/envs/${env}/notes?${q}`);
const put = (b: object, env = 'prod') => app.call('PUT', `/api/envs/${env}/notes`, { anchor: 'env', author: 'Ana', ...b });

test('no design doc yet is version 0; a save is version 1, sanitized; the same text again changes nothing', async () => {
  const none = await get();
  assert.equal(none.status, 200); assert.deepEqual([none.body.version, none.body.body], [0, '']);
  const one = await put({ body: DOC, baseVersion: 0 });
  assert.equal(one.status, 200, JSON.stringify(one.body)); assert.equal(one.body.version, 1); assert.equal(one.body.body, CLEAN);
  assert.equal((await put({ body: DOC, baseVersion: 1 })).body.unchanged, true);
  assert.equal((await get()).body.body, CLEAN);
});

test('it is independent of the flows: a flow keeps its own notes, a missing flow is still a 404, a bad anchor a 400', async () => {
  assert.equal((await get('anchor=flow:api-gateway/in.createOrder')).body.version, 0);
  assert.equal((await put({ anchor: 'flow:nope/x', body: 'x' })).status, 404);
  assert.equal((await put({ anchor: 'environment', body: 'x' })).status, 400);
  assert.equal((await get('anchor=ENV')).status, 400);
  assert.equal((await get('anchor=env', 'nope')).status, 404);
});

test('stale save, history and restore work on it as on any notes', async () => {
  const two = await put({ body: '<h1>Design</h1><p>Second</p>', baseVersion: 1, author: 'Ben' });
  assert.equal(two.body.version, 2);
  const stale = await put({ body: '<p>x</p>', baseVersion: 1 });
  assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'STALE_NOTES'); assert.equal(stale.body.error.details.current.version, 2);
  const h = await app.call('GET', '/api/envs/prod/notes/history?anchor=env');
  assert.deepEqual(h.body.versions.map((v: any) => [v.version, v.author]), [[2, 'Ben'], [1, 'Ana']]);
  const r = await app.call('POST', '/api/envs/prod/notes/restore', { anchor: 'env', version: 1, baseVersion: 2, author: 'Ana' });
  assert.equal(r.status, 200); assert.equal(r.body.version, 3); assert.equal(r.body.restoredFrom, 1); assert.equal(r.body.body, CLEAN);
  const idx = await app.call('GET', '/api/envs/prod/notes/index');
  assert.equal(idx.body.env, 3, 'the index lists it like a flow');
});

test('a document is not cut at the old comment-sized limit, and an absurd one is refused', async () => {
  const big = `<p>${'word '.repeat(30000)}</p>`;
  assert.equal((await put({ body: big })).status, 200);
  assert.equal((await put({ body: `<p>${'x'.repeat(1100000)}</p>` })).status, 422);
});

test('seed data: an item with doc "env" loads as the design doc, twice adds nothing, an unknown flow is skipped', () => {
  const g = app.ctx.graph('prod'), warn: string[] = [];
  const list = [{ doc: 'env' as const, author: 'Seed', body: '<h1>Seeded</h1><p>x</p>', versions: [{ author: 'Seed', body: '<h1>Seeded</h1>' }] }, { service: 'nope', ingress: 'x', author: 'Seed', body: '<p>y</p>' }];
  assert.equal(loadNotes(app.ctx.db, g, 'prod', list, (m) => warn.push(m)), 2);
  assert.equal(loadNotes(app.ctx.db, g, 'prod', list, () => {}), 0);
  assert.equal(warn.length, 1);
});

test('cognito: who reads and who writes the design doc (a design needs editor rights; a sealed environment takes annotations from every reader)', async () => {
  const t = await startCognito();
  try {
    await t.seed();
    const owner = await t.signIn('owner@example.com', 'Olive'), editor = await t.signIn('editor@example.com', 'Eddie'), viewer = await t.signIn('viewer@example.com', 'Vera'), other = await t.signIn('other@example.com', 'Otto');
    const mk = async (name: string) => assert.equal((await owner.call('POST', '/api/envs', { name, source: 'prod', mode: 'components', behaviour: true, entryPoints: 'keep', groups: [], services: [{ name: 'users-svc' }] })).status, 201);
    await mk('d-private'); await mk('d-shared'); await mk('d-pub');
    await owner.call('PUT', '/api/envs/d-shared/access', { members: [{ userId: editor.id, role: 'editor' }, { userId: viewer.id, role: 'viewer' }] });
    await owner.call('PUT', '/api/envs/d-pub/access', { published: true });
    const w = (c: typeof owner, env: string) => c.call('PUT', `/api/envs/${env}/notes`, { anchor: 'env', body: `<p>by ${env}</p>`, author: 'x' });
    const r = (c: typeof owner, env: string) => c.call('GET', `/api/envs/${env}/notes?anchor=env`);
    // the owner writes everywhere they own; the editor writes in the shared design; a viewer reads but cannot write
    for (const e of ['d-private', 'd-shared', 'd-pub']) assert.equal((await w(owner, e)).status, 200, e);
    assert.equal((await w(editor, 'd-shared')).status, 200);
    assert.equal((await r(viewer, 'd-shared')).status, 200); assert.match((await r(viewer, 'd-shared')).body.body, /by d-shared|by d-shared/);
    const denied = await w(viewer, 'd-shared');
    assert.equal(denied.status, 403); assert.equal(denied.body.error.code, 'FORBIDDEN');
    // a published design: everybody reads, only the owner and editors write
    assert.equal((await r(other, 'd-pub')).status, 200); assert.equal((await w(other, 'd-pub')).status, 403);
    // a private design is not found for a stranger, for reads and writes alike
    assert.equal((await r(other, 'd-private')).status, 404); assert.equal((await w(other, 'd-private')).status, 404);
    assert.equal((await r(viewer, 'd-private')).status, 404);
    // history and restore follow the same rule
    assert.equal((await viewer.call('GET', '/api/envs/d-shared/notes/history?anchor=env')).status, 200);
    assert.equal((await viewer.call('POST', '/api/envs/d-shared/notes/restore', { anchor: 'env', version: 1, author: 'x' })).status, 403);
    // a sealed (harvested) environment takes annotations from every reader
    assert.equal((await w(viewer, 'prod')).status, 200); assert.equal((await r(other, 'prod')).body.body, '<p>by prod</p>');
  } finally { await t.close(); }
});
