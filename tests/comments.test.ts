// 0.27.0: comments under a flow. REST (list, add, edit, delete, counts), author-only changes, one-level replies, soft delete, step and flow
// validation, draft reads, sanitizing on every write, events, copy modes, MCP list_comments / add_comment, seed data, migration 011.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDesign, SAMPLES } from './helpers.ts';
import { stepKeys } from '../core/description.ts';
import { loadComments } from '../server/store/comments.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
let step: string;
before(async () => {
  app = await startDesign();
  const t = (await app.call('GET', '/api/envs/prod/trace?service=api-gateway&ingress=in.createOrder&scope=full&maxMessages=2000')).body;
  step = stepKeys(t.messages)[2];
  const c = await app.call('POST', '/api/envs', { name: 'dsn', source: 'prod', mode: 'full' }); // a design with every flow of prod
  assert.equal(c.status, 201, JSON.stringify(c.body));
});
after(() => app.close());

const A = 'flow:api-gateway/in.createOrder';
const list = async (env = 'prod', anchor = A, q = '') => (await app.call('GET', `/api/envs/${env}/comments?anchor=${encodeURIComponent(anchor)}${q}`)).body;
const post = (b: object, env = 'prod', q = '') => app.call('POST', `/api/envs/${env}/comments${q}`, { anchor: A, author: 'Ana', ...b });

test('post, list oldest first, count; sealed and design environments both take comments', async () => {
  const one = await post({ body: '<p>First <b>bold</b></p>' });
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(one.body.author, 'Ana');
  const two = await post({ body: '<p>Second</p>', author: 'Ben' });
  const l = await list();
  assert.equal(l.count, 2);
  assert.deepEqual(l.comments.map((c: any) => [c.author, c.body, c.deleted, c.replies.length]), [['Ana', '<p>First <b>bold</b></p>', false, 0], ['Ben', '<p>Second</p>', false, 0]]);
  assert.ok(l.comments[0].createdAt <= l.comments[1].createdAt);
  assert.equal(two.status, 200);
  const d = await post({ body: 'on a design', anchor: 'flow:users-svc/in.getUser' }, 'dsn');
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal((await list('dsn', 'flow:users-svc/in.getUser')).count, 1);
  assert.equal((await list('prod', 'flow:users-svc/in.getUser')).count, 0, 'per environment');
});

test('every write sanitizes: what is stored is safe', async () => {
  const r = await post({ body: '<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">l</a><img src=x onerror=alert(1)>' });
  assert.equal(r.body.body, '<p>hi</p>l');
  const l = (await list()).comments.at(-1);
  assert.equal(l.body, '<p>hi</p>l');
  const e = await app.call('PATCH', `/api/envs/prod/comments/${r.body.id}`, { author: 'Ana', body: '<svg onload=alert(1)><b>ok</b>' });
  assert.equal(e.body.body, '<b>ok</b>');
  assert.equal((await app.call('DELETE', `/api/envs/prod/comments/${r.body.id}?author=Ana`)).status, 200);
});

test('validation: author, body, anchor, flow, step, size', async () => {
  const bad = async (b: object, code: number, env = 'prod') => assert.equal((await post(b, env)).status, code, JSON.stringify(b));
  await bad({ body: 'x', author: '' }, 400);
  await bad({ body: 'x', author: 'a'.repeat(81) }, 400);
  await bad({ body: '' }, 422);
  await bad({ body: '<p> </p><script>x</script>' }, 422);
  await bad({ body: 42 }, 400);
  await bad({ body: 'x', anchor: 'svc:api-gateway' }, 400);
  await bad({ body: 'x', anchor: 'flow:api-gateway/in.nope' }, 404);
  await bad({ body: 'x', anchor: 'flow:nobody/in.x' }, 404);
  await bad({ body: 'x' }, 404, 'nope');
  await bad({ body: 'x', step: '#step:a>b|c|d' }, 400);
  await bad({ body: 'x', step: 'step 3' }, 400);
  await bad({ body: 'x'.repeat(20001) }, 422);
  assert.equal((await post({ body: 'x'.repeat(19990) })).status, 200);
  const ok = await post({ body: 'with a step', step });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.step, step);
  assert.equal((await app.call('GET', '/api/envs/prod/comments')).status, 400);
  assert.equal((await app.call('GET', '/api/envs/nope/comments?anchor=' + A)).status, 404);
});

test('replies are one level: a reply to a reply goes under the top comment; replies are oldest first', async () => {
  const top = (await post({ body: 'top', anchor: 'flow:orders-svc/in.get' })).body;
  const anchor = top.anchor;
  const r1 = (await post({ body: 'r1', anchor, parentId: top.id, author: 'Ben' })).body;
  const r2 = (await post({ body: 'r2 to r1', anchor, parentId: r1.id, author: 'Cy' })).body;
  assert.equal(r1.parentId, top.id); assert.equal(r2.parentId, top.id);
  const l = await list('prod', anchor);
  assert.equal(l.count, 3); assert.equal(l.comments.length, 1);
  assert.deepEqual(l.comments[0].replies.map((r: any) => [r.author, r.body]), [['Ben', 'r1'], ['Cy', 'r2 to r1']]);
  assert.deepEqual(l.comments[0].replies[0].replies, []);
  assert.equal((await post({ body: 'x', anchor, parentId: 99999 })).status, 404);
  const other = (await post({ body: 'o' })).body;
  assert.equal((await post({ body: 'x', anchor, parentId: other.id })).status, 404, 'a parent under another anchor');
});

test('only the author edits or deletes; edit keeps the date and sets edited; soft delete', async () => {
  const c = (await post({ body: 'mine', anchor: 'flow:users-svc/in.getContact' })).body;
  const anchor = c.anchor;
  const path = `/api/envs/prod/comments/${c.id}`;
  assert.equal((await app.call('PATCH', path, { author: 'Ben', body: 'hijack' })).status, 403);
  assert.equal((await app.call('PATCH', path, { body: 'no author' })).status, 400);
  assert.equal((await app.call('DELETE', `${path}?author=Ben`)).status, 403);
  assert.equal((await app.call('DELETE', path)).status, 400);
  assert.equal((await app.call('PATCH', path, { author: 'Ana', body: '' })).status, 422);
  const e = await app.call('PATCH', path, { author: 'Ana', body: '<p>changed</p>' });
  assert.equal(e.status, 200);
  assert.equal(e.body.createdAt, c.createdAt);
  assert.ok(e.body.editedAt);
  const rep = (await post({ body: 'reply', anchor, parentId: c.id, author: 'Ben' })).body;
  // delete a top comment that has a reply: it stays as "deleted", without author and body
  assert.equal((await app.call('DELETE', `${path}?author=Ana`)).status, 200);
  let l = await list('prod', anchor);
  assert.equal(l.count, 1);
  assert.deepEqual([l.comments[0].deleted, l.comments[0].author, l.comments[0].body, l.comments[0].replies.length], [true, null, '', 1]);
  assert.equal((await app.call('PATCH', path, { author: 'Ana', body: 'again' })).status, 404, 'a deleted comment is gone');
  assert.equal((await post({ body: 'late', anchor, parentId: c.id })).status, 422, 'no reply to a deleted comment');
  // delete the last reply too: the whole thread disappears
  assert.equal((await app.call('DELETE', `/api/envs/prod/comments/${rep.id}?author=Ben`)).status, 200);
  l = await list('prod', anchor);
  assert.deepEqual([l.count, l.comments.length], [0, 0]);
  // a deleted comment without replies disappears at once
  const d = (await post({ body: 'gone', anchor })).body;
  await app.call('DELETE', `/api/envs/prod/comments/${d.id}?author=Ana`);
  assert.equal((await list('prod', anchor)).comments.length, 0);
  const row = app.ctx.db.prepare('SELECT body, deleted_at FROM comments WHERE id = ?').get(d.id) as any;
  assert.equal(row.body, '', 'the text of a deleted comment is not kept');
  assert.ok(row.deleted_at);
});

test('counts per anchor: live comments, replies included', async () => {
  const c = (await app.call('GET', '/api/envs/prod/comments/counts')).body;
  assert.equal(c[A], (await list()).count);
  assert.equal(c['flow:users-svc/in.getContact'], undefined);
  assert.equal((await app.call('GET', '/api/envs/nope/comments/counts')).status, 404);
});

test('a draft makes a flow that only exists there discussable; unknown or closed drafts are refused', async () => {
  const dr = (await app.call('POST', '/api/envs/dsn/drafts', { name: 'cmt' })).body;
  const anchor = 'flow:users-svc/in.getUser';
  assert.equal((await post({ body: 'with draft', anchor }, 'dsn', `?draft=${dr.slug}`)).status, 200);
  assert.equal((await post({ body: 'x', anchor }, 'dsn', '?draft=nope')).status, 404);
  assert.equal((await app.call('GET', `/api/envs/dsn/comments?anchor=${encodeURIComponent(anchor)}&draft=${dr.slug}`)).status, 200);
  assert.equal((await app.call('GET', `/api/envs/dsn/comments?anchor=${encodeURIComponent(anchor)}&draft=nope`)).status, 404);
});

test('events: comment.created / edited / deleted with the first 300 characters of the text', async () => {
  const last = (await app.call('GET', '/api/events/recent')).body.lastId;
  const c = (await post({ body: `<p>${'long '.repeat(100)}</p>`, anchor: 'flow:payments-svc/in.charge' })).body;
  await app.call('PATCH', `/api/envs/prod/comments/${c.id}`, { author: 'Ana', body: 'short' });
  await app.call('DELETE', `/api/envs/prod/comments/${c.id}?author=Ana`);
  const ev = (await app.call('GET', `/api/events/recent?types=comment.*&since=${last}`)).body.events;
  const mine = ev.filter((e: any) => e.type.startsWith('comment.') && e.data.id === c.id);
  assert.deepEqual(mine.map((e: any) => e.type), ['comment.created', 'comment.edited', 'comment.deleted']);
  assert.equal(mine[0].env, 'prod'); assert.equal(mine[0].data.anchor, 'flow:payments-svc/in.charge'); assert.equal(mine[0].data.author, 'Ana');
  assert.equal(mine[0].data.text.length <= 300, true); assert.ok(mine[0].data.text.startsWith('long long'));
  assert.equal(mine[1].data.text, 'short');
});

test('copy modes: Full carries comments (authors, times, replies); Blank and Components do not', async () => {
  const top = (await post({ body: 'copied', anchor: 'flow:users-svc/in.getUser' })).body;
  await post({ body: 'reply copied', anchor: top.anchor, parentId: top.id, author: 'Ben' });
  const before = await list('prod', top.anchor);
  assert.equal((await app.call('POST', '/api/envs', { name: 'cp-full', source: 'prod', mode: 'full' })).status, 201);
  assert.equal((await app.call('POST', '/api/envs', { name: 'cp-blank', source: 'prod', mode: 'blank' })).status, 201);
  assert.equal((await app.call('POST', '/api/envs', { name: 'cp-comp', source: 'prod', mode: 'components', groups: [{ key: 'g', label: 'G' }], services: [{ name: 'users-svc', groupPath: 'g' }] })).status, 201);
  const full = await list('cp-full', top.anchor);
  const shape = (t: any) => t.comments.map((c: any) => [c.author, c.body, c.createdAt, c.replies.map((r: any) => [r.author, r.body, r.createdAt])]);
  assert.deepEqual(shape(full), shape(before));
  assert.notEqual(full.comments[0].id, before.comments[0].id, 'its own rows');
  assert.equal((await app.call('GET', '/api/envs/cp-blank/comments/counts')).body['flow:users-svc/in.getUser'], undefined);
  assert.equal((await app.call('GET', '/api/envs/cp-comp/comments/counts')).body['flow:users-svc/in.getUser'], undefined);
  assert.equal((await app.call('DELETE', '/api/envs/cp-full')).status, 200);
  assert.equal(app.ctx.db.prepare("SELECT COUNT(*) AS n FROM comments WHERE env = 'cp-full'").get()!.n, 0, 'deleting an environment deletes its comments');
});

test('MCP: add_comment takes Markdown-lite or HTML (sanitized) and replies; list_comments returns text and html, and polls with since', async () => {
  const add = await app.mcp('add_comment', { env: 'prod', service: 'api-gateway', ingress: 'in.createOrder', author: 'assistant', body: 'Checked this.\n\n- **bold** point\n- ~~old~~ point', step });
  assert.equal(add.isError, false, add.text);
  assert.equal(add.json.html, '<p>Checked this.</p><ul><li><strong>bold</strong> point</li><li><s>old</s> point</li></ul>');
  const rep = await app.mcp('add_comment', { env: 'prod', service: 'api-gateway', ingress: 'in.createOrder', author: 'assistant', body: '<p>reply</p><script>alert(1)</script>', parentId: add.json.id });
  assert.equal(rep.json.html, '<p>reply</p>');
  const l = await app.mcp('list_comments', { env: 'prod', service: 'api-gateway', ingress: 'in.createOrder' });
  const mine = l.json.comments.find((c: any) => c.id === add.json.id);
  assert.equal(mine.text, 'Checked this.\n\n- bold point\n- old point');
  assert.equal(mine.step, step); assert.equal(mine.replies[0].text, 'reply'); assert.equal(mine.replies[0].parentId, add.json.id);
  assert.equal(l.json.count, (await list()).count);
  const since = new Date(Date.now() + 60000).toISOString();
  assert.equal((await app.mcp('list_comments', { env: 'prod', service: 'api-gateway', ingress: 'in.createOrder', since })).json.comments.length, 0);
  const past = new Date(Date.now() - 3600000).toISOString();
  assert.ok((await app.mcp('list_comments', { env: 'prod', service: 'api-gateway', ingress: 'in.createOrder', since: past })).json.comments.length >= 2);
  assert.equal((await app.mcp('add_comment', { service: 'api-gateway', ingress: 'in.nope', author: 'a', body: 'x' })).isError, true);
  assert.equal((await app.mcp('add_comment', { env: 'prod', service: 'api-gateway', ingress: 'in.createOrder', author: '', body: 'x' })).isError, true);
});

test('seed data: samples/comments/prod.json loads once, with a table, colour and strikethrough', async () => {
  const f = JSON.parse(readFileSync(join(SAMPLES, 'comments/prod.json'), 'utf8'));
  const n = loadComments(app.ctx.db, app.ctx.graph(f.env), f.env, f.comments);
  assert.ok(n >= 4, `loaded ${n}`);
  assert.equal(loadComments(app.ctx.db, app.ctx.graph(f.env), f.env, f.comments), 0, 'seeding twice adds nothing');
  const bodies = (await list()).comments.map((c: any) => c.body + c.replies.map((r: any) => r.body).join(''));
  assert.ok(bodies.some((b: string) => b.includes('<table>')) && bodies.some((b: string) => b.includes('<s>') && b.includes('cc-')));
});

test('a hostile row that bypassed the write path is sanitized on the way out too', async () => {
  app.ctx.db.prepare("INSERT INTO comments (env, anchor, author, body, created_at) VALUES ('prod', 'flow:orders-svc/in.touch', 'mallory', ?, '2026-10-21T00:00:00.000Z')")
    .run('<p>x</p><img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">l</a>');
  const l = await list('prod', 'flow:orders-svc/in.touch');
  assert.equal(l.comments[0].body, '<p>x</p>l');
  assert.equal((await app.mcp('list_comments', { env: 'prod', service: 'orders-svc', ingress: 'in.touch' })).json.comments[0].html, '<p>x</p>l');
});

test('author names are cleaned before the length check and in the edit / delete comparison', async () => {
  const c = await post({ body: 'named', author: '  Ana\u200B \n  Lee\u202E ', anchor: 'flow:payments-svc/in.legacyRefund' });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.author, 'Ana Lee');
  const path = `/api/envs/prod/comments/${c.body.id}`;
  assert.equal((await app.call('PATCH', path, { author: 'Ana\n\u200BLee', body: 'edited' })).status, 200, 'the same name, written differently');
  assert.equal((await app.call('PATCH', path, { author: 'Ana Leee', body: 'x' })).status, 403);
  assert.equal((await post({ body: 'x', author: '\u200B\u202E \n' })).status, 400, 'nothing left after cleaning');
  assert.equal((await post({ body: 'x', author: 'a\u200B'.repeat(80) + 'b' })).status, 400, 'too long after cleaning');
  assert.equal((await post({ body: 'x', author: 'a\u200B'.repeat(80) })).status, 200, 'exactly 80 after cleaning');
  assert.equal((await app.call('DELETE', `${path}?author=${encodeURIComponent(' Ana  Lee ')}`)).status, 200);
});
