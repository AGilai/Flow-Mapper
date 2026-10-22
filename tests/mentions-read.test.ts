// Mentions read (0.31.0): /api/mentions across environments, unread and seen, counts per flow, merge keeps seen marks, MCP list_mentions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, sampleManifests } from './helpers.ts';

const flow = async (app: any) => { await app.call('POST', '/api/ingest', { manifests: sampleManifests() }); const e = (await app.call('GET', '/api/envs/prod/entry-points')).body; const f = (e.entryPoints ?? e)[0]; return { anchor: `flow:${f.service}/${f.ingress ?? f.id}`, service: f.service, ingress: f.ingress ?? f.id }; };

test('mentions: list, unread, seen, counts per flow, other users and deleted comments', async () => {
  const app = await startApp();
  try {
    const { anchor, service, ingress } = await flow(app);
    const dana = (await app.call('POST', '/api/users', { name: 'Dana' })).body, ron = (await app.call('POST', '/api/users', { name: 'Ron' })).body;
    const post = (who: any, body: string) => app.call('POST', '/api/envs/prod/comments', { anchor, body }, { 'x-flow-user': who.id });
    const a = await post(ron, `<p>@[${dana.id}] first</p>`), b = await post(ron, `<p>@[${dana.id}] second, @[${ron.id}] me too</p>`), c = await post(dana, '<p>no mention</p>');
    const l = (await app.call('GET', `/api/mentions?user=${dana.id}`)).body;
    assert.equal(l.mentions.length, 2); assert.equal(l.unread, 2);
    assert.deepEqual(l.mentions.map((m: any) => m.commentId), [b.body.id, a.body.id]); // newest first
    assert.equal(l.mentions[0].env, 'prod'); assert.equal(l.mentions[0].service, service); assert.equal(l.mentions[0].ingress, ingress); assert.equal(l.mentions[0].author, 'Ron'); assert.match(l.mentions[0].text, /second/);
    // by header
    assert.equal((await app.call('GET', '/api/mentions', undefined, { 'x-flow-user': dana.id })).body.mentions.length, 2);
    assert.equal((await app.call('GET', '/api/mentions')).status, 400);
    assert.equal((await app.call('GET', '/api/mentions?user=u_nobody')).status, 404);
    // Ron mentioned himself: already seen
    assert.equal((await app.call('GET', `/api/mentions?user=${ron.id}&unread=1`)).body.mentions.length, 0);
    assert.deepEqual((await app.call('GET', `/api/envs/prod/mentions/counts?user=${dana.id}`)).body, { [anchor]: 2 });
    // seen: only mentions of that user count (c does not mention Dana)
    const s = await app.call('POST', '/api/mentions/seen', { user: dana.id, commentIds: [a.body.id, c.body.id] });
    assert.deepEqual(s.body, { marked: 1 });
    assert.equal((await app.call('GET', `/api/mentions?user=${dana.id}&unread=1`)).body.mentions.length, 1);
    assert.deepEqual((await app.call('GET', `/api/envs/prod/mentions/counts?user=${dana.id}`)).body, { [anchor]: 1 });
    assert.equal((await app.call('POST', '/api/mentions/seen', { user: dana.id, commentIds: ['x'] })).status, 400);
    // an edit that adds a mention to an old comment is unread
    await app.call('PATCH', `/api/envs/prod/comments/${c.body.id}`, { body: `<p>now @[${ron.id}]</p>` }, { 'x-flow-user': dana.id });
    assert.equal((await app.call('GET', `/api/mentions?user=${ron.id}&unread=1`)).body.mentions.length, 1);
    // a deleted comment is gone from the list
    await app.call('DELETE', `/api/envs/prod/comments/${b.body.id}`, undefined, { 'x-flow-user': ron.id });
    assert.deepEqual((await app.call('GET', `/api/mentions?user=${dana.id}`)).body.mentions.map((m: any) => m.commentId), [a.body.id]);
  } finally { await app.close(); }
});

test('merge keeps seen marks and unread; MCP list_mentions by id or name', async () => {
  const app = await startApp();
  try {
    const { anchor } = await flow(app);
    const a = (await app.call('POST', '/api/users', { name: 'Asaf G.' })).body, b = (await app.call('POST', '/api/users', { name: 'Asaf Gilai' })).body, ron = (await app.call('POST', '/api/users', { name: 'Ron' })).body;
    const c1 = await app.call('POST', '/api/envs/prod/comments', { anchor, body: `<p>@[${a.id}] one</p>` }, { 'x-flow-user': ron.id });
    await app.call('POST', '/api/envs/prod/comments', { anchor, body: `<p>@[${b.id}] two</p>` }, { 'x-flow-user': ron.id });
    await app.call('POST', '/api/mentions/seen', { user: a.id, commentIds: [c1.body.id] });
    await app.call('POST', `/api/users/${a.id}/merge`, { into: b.id });
    const l = (await app.call('GET', `/api/mentions?user=${b.id}`)).body;
    assert.equal(l.mentions.length, 2); assert.equal(l.unread, 1);
    assert.equal((await app.call('GET', `/api/mentions?user=${a.id}`)).body.mentions.length, 2); // the merged id still resolves
    const call = async (tool: string, args: any) => { const x = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }); return x.body.result.isError ? { error: x.body.result.content[0].text } : JSON.parse(x.body.result.content[0].text); };
    const m = await call('list_mentions', { user: 'asaf gilai', unread: true });
    assert.equal(m.user.id, b.id); assert.equal(m.mentions.length, 1); assert.match(m.mentions[0].text, /two/);
    assert.equal((await call('list_mentions', { user: b.id })).mentions.length, 2);
    assert.ok((await call('list_mentions', { user: 'nobody' })).error);
  } finally { await app.close(); }
});
