// @mentions (0.32.0): the token survives the sanitizer, @{Name} resolves, comment_mentions follows writes (edit, merge, copy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../core/rich-text.ts';
import { commentHtml } from '../core/rich-text-md.ts';
import { mentionIds, splitMentions, resolveNamed, mapMentions } from '../core/mentions.ts';
import { startApp, sampleManifests } from './helpers.ts';

test('the sanitizer keeps @[id] as text and is idempotent on it', () => {
  const h = sanitize('<p>Hi @[u_0a1b2c3d], <b>please</b> look <script>x</script></p>');
  assert.equal(h, '<p>Hi @[u_0a1b2c3d], <b>please</b> look </p>');
  assert.equal(sanitize(h), h);
  assert.equal(commentHtml('Ping @[u_0a1b2c3d] now'), '<p>Ping @[u_0a1b2c3d] now</p>');
});

test('token helpers', () => {
  assert.deepEqual(mentionIds('a @[u_1] b @[u_2] c @[u_1] @[bad id] @[]'), ['u_1', 'u_2']);
  assert.deepEqual(splitMentions('Hi @[u_1], and @[u_2]'), ['Hi ', { id: 'u_1' }, ', and ', { id: 'u_2' }]);
  assert.equal(resolveNamed('@{Dana Levi} and @{Nobody}', (n) => (n === 'Dana Levi' ? 'u_9' : null)), '@[u_9] and @Nobody');
  assert.equal(mapMentions('@[a] @[b]', (x) => (x === 'a' ? 'z' : x)), '@[z] @[b]');
});

const flow = async (app: any) => { await app.call('POST', '/api/ingest', { manifests: sampleManifests() }); const e = (await app.call('GET', '/api/envs/prod/entry-points')).body; const f = (e.entryPoints ?? e)[0]; return `flow:${f.service}/${f.ingress ?? f.id}`; };
const rows = (app: any, id: number) => (app.ctx.db.prepare('SELECT user_id FROM comment_mentions WHERE comment_id = ? ORDER BY user_id').all(id) as any[]).map((r) => r.user_id);

test('REST: tokens stored, @{Name} resolved (and created), edits and merges keep the index', async () => {
  const app = await startApp();
  try {
    const anchor = await flow(app);
    const dana = (await app.call('POST', '/api/users', { name: 'Dana' })).body, ron = (await app.call('POST', '/api/users', { name: 'Ron' })).body;
    const h = { 'x-flow-user': ron.id };
    const c = await app.call('POST', '/api/envs/prod/comments', { anchor, body: `<p>@[${dana.id}] look, and @{Priya Shah} too, @{ron}</p>` }, h);
    assert.equal(c.status, 201);
    const priya = (await app.call('GET', '/api/users')).body.users.find((u: any) => u.name === 'Priya Shah');
    assert.ok(priya, 'a mentioned name that matches nobody becomes a user');
    assert.equal(c.body.body, `<p>@[${dana.id}] look, and @[${priya.id}] too, @[${ron.id}]</p>`);
    assert.deepEqual(rows(app, c.body.id), [dana.id, priya.id, ron.id].sort());
    // a mention of yourself is not news: already seen
    assert.equal((app.ctx.db.prepare('SELECT COUNT(*) AS n FROM mention_seen WHERE comment_id = ?').get(c.body.id) as any).n, 1);
    // edit: drop Priya, add nothing
    await app.call('PATCH', `/api/envs/prod/comments/${c.body.id}`, { body: `<p>@[${dana.id}] only</p>` }, h);
    assert.deepEqual(rows(app, c.body.id), [dana.id]);
    // an unknown id stays text, no row
    const u = await app.call('POST', '/api/envs/prod/comments', { anchor, body: '<p>@[u_deadbeef] who</p>' }, h);
    assert.equal(u.body.body, '<p>@[u_deadbeef] who</p>'); assert.deepEqual(rows(app, u.body.id), []);
    // rename does not touch the stored token; merge re-points it
    await app.call('PATCH', `/api/users/${dana.id}`, { name: 'Dana L' });
    assert.match((await app.call('GET', `/api/envs/prod/comments?anchor=${encodeURIComponent(anchor)}`)).body.comments[0].body, new RegExp(`@\\[${dana.id}\\]`));
    await app.call('POST', `/api/users/${dana.id}/merge`, { into: priya.id }, h);
    assert.deepEqual(rows(app, c.body.id), [priya.id]);
    assert.match((await app.call('GET', `/api/envs/prod/comments?anchor=${encodeURIComponent(anchor)}`)).body.comments[0].body, new RegExp(`@\\[${priya.id}\\] only`));
  } finally { await app.close(); }
});

test('MCP add_comment accepts @{Display Name}; a Full copy keeps tokens and their mentions (seen: not news)', async () => {
  const app = await startApp();
  try {
    const anchor = await flow(app), [, rest] = [0, anchor.slice(5)], service = rest.slice(0, rest.indexOf('/')), ingress = rest.slice(rest.indexOf('/') + 1);
    const call = async (tool: string, args: any) => { const x = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }); return JSON.parse(x.body.result.content[0].text); };
    await call('add_comment', { env: 'prod', service, ingress, body: 'Hello **@{Einat S}**, see this' });
    const einat = (await app.call('GET', '/api/users')).body.users.find((u: any) => u.name === 'Einat S');
    assert.ok(einat);
    const t = await call('list_comments', { env: 'prod', service, ingress });
    assert.match(t.comments[0].html, new RegExp(`@\\[${einat.id}\\]`));
    const cp = await app.call('POST', '/api/envs', { name: 'copy1', source: 'prod', mode: 'full' });
    assert.ok(cp.status === 201, JSON.stringify(cp.body));
    const copied = app.ctx.db.prepare("SELECT id FROM comments WHERE env = 'copy1'").all() as any[];
    assert.equal(copied.length, 1);
    assert.deepEqual(rows(app, copied[0].id), [einat.id]);
    assert.equal((app.ctx.db.prepare('SELECT COUNT(*) AS n FROM mention_seen WHERE comment_id = ?').get(copied[0].id) as any).n, 1);
  } finally { await app.close(); }
});
