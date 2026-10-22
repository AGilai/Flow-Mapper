// Users registry (0.31.0): matching, the API, X-Flow-User, author matching for REST clients, rename and merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchUser, colorSlot, initials, filterUsers, type User } from '../core/users-match.ts';
import { startApp, sampleManifests } from './helpers.ts';

const U = (id: string, name: string, extra: Partial<User> = {}): User => ({ id, name, color: colorSlot(id), createdAt: 't', lastSeenAt: null, aliases: [], externalIds: [], ...extra });

test('matching: external id first, then exact name or alias (case and space), ambiguous alias matches nobody', () => {
  const users = [U('u_a', 'Dana  Levi', { externalIds: [{ source: 'confluence', externalId: '77' }] }), U('u_b', 'Ron', { aliases: ['Ronny'] }), U('u_c', 'Tal', { aliases: ['T'] }), U('u_d', 'Tamar', { aliases: ['T'] })];
  assert.equal(matchUser(users, { name: 'someone else', source: 'confluence', externalId: '77' })?.user.id, 'u_a');
  assert.equal(matchUser(users, { name: 'someone else', source: 'confluence', externalId: '77' })?.by, 'external');
  assert.equal(matchUser(users, { name: ' dana levi ' })?.by, 'name');
  assert.equal(matchUser(users, { name: 'RONNY' })?.user.id, 'u_b');
  assert.equal(matchUser(users, { name: 'T' }), null);
  assert.equal(matchUser(users, { name: 'nobody', source: 'confluence', externalId: '1' }), null);
  assert.equal(matchUser(users, { name: '' }), null);
});

test('colour slot is stable per id, initials, filter', () => {
  assert.equal(colorSlot('u_0000000f'), 7); assert.equal(colorSlot('u_00000008'), 0);
  assert.ok(colorSlot('u_zzzz') >= 0 && colorSlot('u_zzzz') < 8);
  assert.equal(initials('Dana Levi'), 'DL'); assert.equal(initials('ron'), 'RO'); assert.equal(initials('  '), '?'); assert.equal(initials('Ann-Marie van Dyke'), 'AD');
  assert.deepEqual(filterUsers([U('a', 'Dana Levi'), U('b', 'Ron')], 'le da').map((u) => u.id), ['a']);
});

const flow = async (app: any) => { await app.call('POST', '/api/ingest', { manifests: sampleManifests() }); const e = (await app.call('GET', '/api/envs/prod/entry-points')).body; const f = (e.entryPoints ?? e)[0]; return { service: f.service, ingress: f.ingress ?? f.id }; };

test('users API: create, name taken, rename, list; unknown header is 400', async () => {
  const app = await startApp();
  try {
    const a = await app.call('POST', '/api/users', { name: 'Dana Levi', externalIds: [{ source: 'confluence', externalId: '77' }] });
    assert.equal(a.status, 201); assert.match(a.body.id, /^u_[0-9a-f]{8}$/); assert.deepEqual(a.body.externalIds, [{ source: 'confluence', externalId: '77' }]);
    assert.equal((await app.call('POST', '/api/users', { name: ' dana  LEVI ' })).status, 409);
    assert.equal((await app.call('POST', '/api/users', { name: 'Other', externalIds: [{ source: 'confluence', externalId: '77' }] })).status, 409);
    const m = await app.call('POST', '/api/users', { name: 'dana levi', match: true }); assert.equal(m.status, 200); assert.equal(m.body.id, a.body.id);
    const r = await app.call('PATCH', `/api/users/${a.body.id}`, { name: 'Dana L.', keepAlias: true });
    assert.equal(r.body.name, 'Dana L.'); assert.deepEqual(r.body.aliases, ['Dana Levi']);
    assert.equal((await app.call('GET', '/api/users')).body.users.length, 1);
    assert.equal((await app.call('POST', '/api/users', { name: '' })).status, 400);
    const f = await flow(app), bad = await app.call('POST', '/api/envs/prod/comments', { anchor: `flow:${f.service}/${f.ingress}`, body: 'x' }, { 'x-flow-user': 'u_nope' });
    assert.equal(bad.status, 400);
  } finally { await app.close(); }
});

test('writes: header user, REST author names matched to users, edit survives a rename, merge re-points', async () => {
  const app = await startApp();
  try {
    const f = await flow(app), anchor = `flow:${f.service}/${f.ingress}`;
    const dana = (await app.call('POST', '/api/users', { name: 'Dana' })).body, ron = (await app.call('POST', '/api/users', { name: 'Ron' })).body;
    const h = { 'x-flow-user': dana.id };
    const c1 = await app.call('POST', '/api/envs/prod/comments', { anchor, body: 'from header' }, h);
    assert.equal(c1.status, 201); assert.equal(c1.body.author, 'Dana'); assert.equal(c1.body.authorId, dana.id);
    const c2 = await app.call('POST', '/api/envs/prod/comments', { anchor, author: ' ron ', body: 'from a harvester' });
    assert.equal(c2.body.authorId, ron.id); assert.equal(c2.body.author, 'Ron');
    const c3 = await app.call('POST', '/api/envs/prod/comments', { anchor, author: 'New Person', body: 'creates' });
    assert.ok(c3.body.authorId); assert.equal((await app.call('GET', '/api/users')).body.users.length, 3);
    assert.equal((await app.call('POST', '/api/envs/prod/comments', { anchor, body: 'nobody' })).status, 400);
    // only the author edits
    assert.equal((await app.call('PATCH', `/api/envs/prod/comments/${c1.body.id}`, { body: 'x' }, { 'x-flow-user': ron.id })).status, 403);
    assert.equal((await app.call('PATCH', `/api/envs/prod/comments/${c2.body.id}`, { author: 'Dana', body: 'x' })).status, 403);
    await app.call('PATCH', `/api/users/${dana.id}`, { name: 'Dana Renamed' });
    assert.equal((await app.call('PATCH', `/api/envs/prod/comments/${c1.body.id}`, { body: 'edited after rename' }, h)).status, 200);
    const th = (await app.call('GET', `/api/envs/prod/comments?anchor=${encodeURIComponent(anchor)}`)).body;
    assert.equal(th.comments[0].author, 'Dana Renamed');
    // action items: owner as a user, actor from the header
    const it = await app.call('POST', '/api/envs/prod/action-items', { anchor, owner: 'Ron', description: 'do it' }, h);
    assert.equal(it.status, 200); assert.equal(it.body.ownerId, ron.id); assert.equal(it.body.createdBy, 'Dana Renamed');
    const it2 = await app.call('POST', '/api/envs/prod/action-items', { anchor, ownerId: dana.id, description: 'by id' }, { 'x-flow-user': ron.id });
    assert.equal(it2.body.owner, 'Dana Renamed');
    // merge Ron into Dana: comments, items, aliases
    const mg = await app.call('POST', `/api/users/${ron.id}/merge`, { into: dana.id }, h);
    assert.equal(mg.status, 200); assert.ok(mg.body.aliases.includes('Ron'));
    assert.equal((await app.call('GET', '/api/users')).body.users.some((u: any) => u.id === ron.id), false);
    const th2 = (await app.call('GET', `/api/envs/prod/comments?anchor=${encodeURIComponent(anchor)}`)).body;
    assert.ok(th2.comments.every((c: any) => c.author === 'Dana Renamed' || c.author === 'New Person'));
    const c4 = await app.call('POST', '/api/envs/prod/comments', { anchor, author: 'Ron', body: 'old name' });
    assert.equal(c4.body.authorId, dana.id);
    assert.equal((await app.call('POST', `/api/users/${dana.id}/merge`, { into: dana.id })).status, 400);
  } finally { await app.close(); }
});

test('importer: authorExternalId + externalSource link a comment author to a user whatever name it sends', async () => {
  const app = await startApp();
  try {
    const f = await flow(app), anchor = `flow:${f.service}/${f.ingress}`;
    const u = (await app.call('POST', '/api/users', { name: 'Dana', externalIds: [{ source: 'confluence', externalId: '77' }] })).body;
    const c = await app.call('POST', '/api/envs/prod/comments', { anchor, author: 'dlevi@corp', body: 'imported', externalSource: 'confluence', externalId: 'c1', authorExternalId: '77' });
    assert.equal(c.body.authorId, u.id); assert.equal(c.body.author, 'Dana');
    const n = await app.call('POST', '/api/envs/prod/comments', { anchor, author: 'Eve', body: 'new', externalSource: 'confluence', externalId: 'c2', authorExternalId: '88' });
    const eve = (await app.call('GET', '/api/users')).body.users.find((x: any) => x.name === 'Eve');
    assert.equal(n.body.authorId, eve.id); assert.deepEqual(eve.externalIds, [{ source: 'confluence', externalId: '88' }]);
  } finally { await app.close(); }
});

test('MCP: list_users; writes without an author are by Assistant', async () => {
  const app = await startApp();
  try {
    const f = await flow(app);
    const call = async (tool: string, args: any) => { const x = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }); return JSON.parse(x.body.result.content[0].text); };
    await call('add_comment', { env: 'prod', service: f.service, ingress: f.ingress, body: 'hello' });
    const l = await call('list_users', {});
    assert.deepEqual(l.users.map((u: any) => u.name), ['Assistant']);
    assert.equal((await call('list_users', { query: 'zzz' })).users.length, 0);
    const t = await call('list_comments', { env: 'prod', service: f.service, ingress: f.ingress });
    assert.equal(t.comments[0].author, 'Assistant'); assert.equal(t.comments[0].authorId, l.users[0].id);
  } finally { await app.close(); }
});
