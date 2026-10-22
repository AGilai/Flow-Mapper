// 0.29.2 (bug #66, first part): comment import fields (createdAt, externalId + externalSource, authorExternalId, parentExternalId), the
// idempotent re-import, resolve / reopen by anyone, counts of open threads, events, MCP, Full copy and the samples.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDesign, SAMPLES } from './helpers.ts';
import { loadComments } from '../server/store/comments.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());

const A = 'flow:api-gateway/in.createOrder', B = 'flow:users-svc/in.getUser';
const list = async (env = 'prod', anchor = A) => (await app.call('GET', `/api/envs/${env}/comments?anchor=${encodeURIComponent(anchor)}`)).body;
const post = (b: object, env = 'prod') => app.call('POST', `/api/envs/${env}/comments`, { anchor: A, author: 'Ana', ...b });
const patch = (id: number, b: object, env = 'prod') => app.call('PATCH', `/api/envs/${env}/comments/${id}`, b);
const open = async (anchor = A, env = 'prod') => (await app.call('GET', `/api/envs/${env}/comments/counts`)).body[anchor] ?? 0;

test('createdAt is kept as the instant given; future (beyond 5 minutes) or not a time is 400', async () => {
  const r = await post({ body: 'old', createdAt: '2025-03-04T10:00:00+02:00' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.createdAt, '2025-03-04T08:00:00.000Z');
  assert.equal((await post({ body: 'soon', createdAt: new Date(Date.now() + 2 * 60000).toISOString() })).status, 201);
  assert.equal((await post({ body: 'later', createdAt: new Date(Date.now() + 10 * 60000).toISOString() })).status, 400);
  assert.equal((await post({ body: 'junk', createdAt: 'yesterday' })).status, 400);
  assert.equal((await post({ body: 'junk', createdAt: 5 })).status, 400);
  const l = await list();
  assert.equal(l.comments[0].body, 'old', 'the thread sorts by the given time');
});

test('externalId and externalSource go together, are bounded, and come back on reads', async () => {
  for (const b of [{ externalId: 'c1' }, { externalSource: 'confluence' }, { externalId: 'x'.repeat(201), externalSource: 's' }, { externalId: 'c', externalSource: 'y'.repeat(201) }, { authorExternalId: 'z'.repeat(201) }, { externalId: '', externalSource: 's' }])
    assert.equal((await post({ body: 'x', ...b })).status, 400, JSON.stringify(b).slice(0, 60));
  const r = await post({ body: 'with ids', externalId: 'c-100', externalSource: 'confluence', authorExternalId: 'u-7' });
  assert.equal(r.status, 201);
  const c = (await list()).comments.find((x: any) => x.id === r.body.id);
  assert.deepEqual([c.externalId, c.externalSource, c.authorExternalId, c.resolved], ['c-100', 'confluence', 'u-7', false]);
});

test('re-import: the same (source, id) updates the comment (200, updated: true), never duplicates; another anchor is 409; ids are per source', async () => {
  const a = await post({ body: '<p>v1</p>', externalId: 'r-1', externalSource: 'confluence', author: 'Old Name' });
  assert.equal(a.status, 201);
  const before = (await list()).count;
  const b = await post({ body: '<p>v2</p>', externalId: 'r-1', externalSource: 'confluence', author: 'New Name', createdAt: '2025-01-02T03:04:05Z', authorExternalId: 'u-9' });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.updated, true); assert.equal(b.body.id, a.body.id);
  assert.equal((await list()).count, before, 'no duplicate');
  const c = (await list()).comments.find((x: any) => x.id === a.body.id);
  assert.deepEqual([c.body, c.author, c.createdAt, c.authorExternalId], ['<p>v2</p>', 'New Name', '2025-01-02T03:04:05.000Z', 'u-9']);
  assert.ok(c.editedAt, 'a changed body shows as edited');
  const same = await post({ body: '<p>v2</p>', externalId: 'r-1', externalSource: 'confluence', author: 'New Name' });
  assert.equal(same.status, 200); assert.equal((await list()).count, before);
  const other = await post({ body: 'x', externalId: 'r-1', externalSource: 'confluence', anchor: B });
  assert.equal(other.status, 409); assert.equal(other.body.error.code, 'EXTERNAL_ID_TAKEN');
  assert.equal((await post({ body: 'x', externalId: 'r-1', externalSource: 'jira' })).status, 201, 'another source');
});

test('parentExternalId replies to the comment of that source and id; unknown, mixed with parentId, or without a source is 400', async () => {
  const top = (await post({ body: 'top', externalId: 'p-1', externalSource: 'confluence' })).body;
  const rep = await post({ body: 'reply', externalId: 'p-2', externalSource: 'confluence', parentExternalId: 'p-1' });
  assert.equal(rep.status, 201, JSON.stringify(rep.body)); assert.equal(rep.body.parentId, top.id);
  const deep = await post({ body: 'deeper', externalId: 'p-3', externalSource: 'confluence', parentExternalId: 'p-2' });
  assert.equal(deep.body.parentId, top.id, 'one level only');
  assert.equal((await post({ body: 'x', externalId: 'p-4', externalSource: 'confluence', parentExternalId: 'nope' })).status, 400);
  assert.equal((await post({ body: 'x', externalId: 'p-4', externalSource: 'jira', parentExternalId: 'p-1' })).status, 400, 'looked up in its own source');
  assert.equal((await post({ body: 'x', parentExternalId: 'p-1' })).status, 400);
  assert.equal((await post({ body: 'x', externalId: 'p-5', externalSource: 'confluence', parentExternalId: 'p-1', parentId: top.id })).status, 400);
  assert.equal((await post({ body: 'x', externalId: 'p-6', externalSource: 'confluence', parentExternalId: 'p-1', anchor: B })).status, 400, 'a parent under another flow');
  const t = (await list()).comments.find((x: any) => x.id === top.id);
  assert.deepEqual(t.replies.map((r: any) => r.externalId), ['p-2', 'p-3']);
});

test('resolve and reopen: anyone, an actor is required, a reply cannot be resolved alone, body edits stay author-only', async () => {
  const top = (await post({ body: 'thread', author: 'Ana' })).body;
  const rep = (await post({ body: 'reply', author: 'Ben', parentId: top.id })).body;
  assert.equal((await patch(top.id, { resolved: true })).status, 400, 'actor required');
  assert.equal((await patch(rep.id, { actor: 'Cy', resolved: true })).status, 400);
  assert.equal((await patch(top.id, { actor: 'Cy', resolved: 'yes' })).status, 400);
  assert.equal((await patch(top.id, { actor: 'Cy', resolved: true, body: 'x' })).status, 400);
  const r = await patch(top.id, { actor: 'Cy', resolved: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.resolved, r.body.resolvedBy], [true, 'Cy']); assert.ok(r.body.resolvedAt);
  const t = (await list()).comments.find((x: any) => x.id === top.id);
  assert.deepEqual([t.resolved, t.resolvedBy, t.replies[0].resolved], [true, 'Cy', true], 'the replies follow the thread');
  assert.equal((await patch(top.id, { author: 'Cy', body: 'hijack' })).status, 403, 'editing is still author-only');
  assert.equal((await patch(top.id, { actor: 'Ana', resolved: false })).status, 200);
  const t2 = (await list()).comments.find((x: any) => x.id === top.id);
  assert.deepEqual([t2.resolved, t2.resolvedBy, t2.resolvedAt, t2.replies[0].resolved], [false, null, null, false]);
  assert.equal((await patch(99999, { actor: 'Cy', resolved: true })).status, 404);
});

test('counts are open top threads: resolved ones and replies are not counted; the thread reports resolvedThreads', async () => {
  const base = await open(B);
  const t1 = (await post({ body: 'one', anchor: B })).body, t2 = (await post({ body: 'two', anchor: B })).body;
  await post({ body: 'reply', anchor: B, parentId: t1.id });
  assert.equal(await open(B), base + 2);
  await patch(t1.id, { actor: 'Cy', resolved: true });
  assert.equal(await open(B), base + 1);
  const l = await list('prod', B);
  assert.equal(l.resolvedThreads, 1); assert.equal(l.count, base + 3, 'count is every live comment');
  await patch(t2.id, { actor: 'Cy', resolved: true });
  assert.equal(await open(B), base);
});

test('import with resolved: sets the state with resolvedBy / resolvedAt; re-import updates it; a reply cannot carry it', async () => {
  const x = { externalId: 'rs-1', externalSource: 'confluence' };
  const a = await post({ body: 'closed in Confluence', ...x, resolved: true, resolvedBy: 'Dana', resolvedAt: '2025-05-05T05:05:05Z' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.deepEqual([a.body.resolved, a.body.resolvedBy, a.body.resolvedAt], [true, 'Dana', '2025-05-05T05:05:05.000Z']);
  const b = await post({ body: 'closed in Confluence', ...x, resolved: false });
  assert.equal(b.status, 200); assert.equal(b.body.resolved, false); assert.equal(b.body.resolvedBy, null);
  const c = await post({ body: 'closed in Confluence', ...x });
  assert.equal(c.body.resolved, false, 'no `resolved` field leaves the state alone');
  await post({ body: 'closed in Confluence', ...x, resolved: true });
  const d = (await list()).comments.find((n: any) => n.id === a.body.id);
  assert.deepEqual([d.resolved, d.resolvedBy], [true, 'Ana'], 'resolvedBy falls back to the comment author');
  const rep = await post({ body: 'r', parentId: a.body.id, resolved: true });
  assert.equal(rep.status, 400);
  assert.equal((await post({ body: 'x', resolved: true, resolvedAt: new Date(Date.now() + 3600000).toISOString() })).status, 400);
});

test('events: comment.resolved and comment.reopened, once per change', async () => {
  const last = (await app.call('GET', '/api/events/recent')).body.lastId;
  const c = (await post({ body: 'evented', anchor: 'flow:payments-svc/in.charge' })).body;
  await patch(c.id, { actor: 'Cy', resolved: true }); await patch(c.id, { actor: 'Cy', resolved: true }); await patch(c.id, { actor: 'Dee', resolved: false });
  const ev = (await app.call('GET', `/api/events/recent?types=comment.*&since=${last}`)).body.events.filter((e: any) => e.data.id === c.id);
  assert.deepEqual(ev.map((e: any) => e.type), ['comment.created', 'comment.resolved', 'comment.reopened']);
  assert.equal(ev[1].data.author, 'Cy'); assert.equal(ev[2].data.author, 'Dee');
});

test('MCP: add_comment takes the importer fields and is idempotent; resolve_comment; list_comments shows the state', async () => {
  const m = { env: 'prod', service: 'api-gateway', ingress: 'in.createOrder', author: 'importer' };
  const a = await app.mcp('add_comment', { ...m, body: 'from mcp', externalId: 'm-1', externalSource: 'confluence', createdAt: '2025-02-02T02:02:02Z', resolved: true, resolvedBy: 'Dana' });
  assert.equal(a.isError, false, a.text); assert.equal(a.json.createdAt, '2025-02-02T02:02:02.000Z'); assert.equal(a.json.resolved, true); assert.equal(a.json.updated, undefined);
  const b = await app.mcp('add_comment', { ...m, body: 'from mcp, edited', externalId: 'm-1', externalSource: 'confluence' });
  assert.equal(b.json.updated, true); assert.equal(b.json.id, a.json.id);
  assert.equal((await app.mcp('add_comment', { ...m, body: 'x', externalId: 'only-id' })).isError, true);
  const r = await app.mcp('resolve_comment', { env: 'prod', id: a.json.id, author: 'Eve', resolved: false });
  assert.equal(r.isError, false, r.text); assert.deepEqual([r.json.resolved, r.json.resolvedBy], [false, null]);
  const l = await app.mcp('list_comments', { env: 'prod', service: 'api-gateway', ingress: 'in.createOrder' });
  const n = l.json.comments.find((c: any) => c.id === a.json.id);
  assert.deepEqual([n.externalId, n.externalSource, n.resolved, n.text], ['m-1', 'confluence', false, 'from mcp, edited']);
  assert.equal((await app.mcp('resolve_comment', { env: 'prod', id: 99999, author: 'Eve', resolved: true })).isError, true);
});

test('Full copy carries the import fields and the resolved state', async () => {
  const t = (await post({ body: 'copy me', anchor: B, externalId: 'cp-1', externalSource: 'confluence', authorExternalId: 'u-1', resolved: true, resolvedBy: 'Dana' })).body;
  assert.equal((await app.call('POST', '/api/envs', { name: 'cp-imp', source: 'prod', mode: 'full' })).status, 201);
  const c = (await list('cp-imp', B)).comments.find((x: any) => x.body === 'copy me');
  assert.deepEqual([c.externalId, c.externalSource, c.authorExternalId, c.resolved, c.resolvedBy], ['cp-1', 'confluence', 'u-1', true, 'Dana']);
  assert.notEqual(c.id, t.id);
});

test('samples: one resolved thread and one imported comment load, once', async () => {
  const f = JSON.parse(readFileSync(join(SAMPLES, 'comments/prod.json'), 'utf8'));
  loadComments(app.ctx.db, app.ctx.graph(f.env), f.env, f.comments);
  assert.equal(loadComments(app.ctx.db, app.ctx.graph(f.env), f.env, f.comments), 0);
  const all = (await list()).comments;
  assert.ok(all.some((c: any) => c.resolved && c.replies.length), 'a resolved thread with a reply');
  assert.ok(all.some((c: any) => c.externalSource === 'confluence' && !c.resolved), 'an imported comment');
});
