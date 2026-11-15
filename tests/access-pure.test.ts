// core/env-access.ts: the roles of an environment and the rules of drafts, as a table. Plus: auth off changes nothing (everyone is an admin, tokens do not exist).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleOf, visibilityOf, draftRole, canEditDraft, canApplyDraft, canDiscardDraft, canShareDraft, type EnvAcl } from '../core/env-access.ts';
import { startApp, sampleManifests } from './helpers.ts';

const design = (visibility: EnvAcl['visibility'], ownerId: string | null = 'o', members: EnvAcl['members'] = {}): EnvAcl => ({ kind: 'design', ownerId, visibility, members });
const u = (id: string | null, admin = false) => ({ id, admin });

test('roleOf: owner, editor, viewer, other, admin across private, shared, published, ownerless and sealed', () => {
  const m = { e: 'editor', v: 'viewer' } as const;
  const rows: [string, EnvAcl, Record<string, string>][] = [
    ['private', design('private'), { o: 'owner', e: 'none', v: 'none', x: 'none', a: 'owner' }],
    ['shared', design('shared', 'o', m), { o: 'owner', e: 'editor', v: 'viewer', x: 'none', a: 'owner' }],
    ['published', design('published', 'o', m), { o: 'owner', e: 'editor', v: 'viewer', x: 'viewer', a: 'owner' }],
    ['ownerless', design('published', null), { o: 'viewer', e: 'viewer', v: 'viewer', x: 'viewer', a: 'owner' }],
    ['sealed', { kind: 'sealed', ownerId: null, visibility: 'published', members: {} }, { o: 'viewer', e: 'viewer', v: 'viewer', x: 'viewer', a: 'owner' }],
  ];
  for (const [name, acl, want] of rows) for (const [id, role] of Object.entries(want)) assert.equal(roleOf(acl, u(id, id === 'a')), role, `${name} ${id}`);
  assert.equal(roleOf(design('published'), u(null)), 'none', 'nobody signed in');
  assert.equal(visibilityOf(false, 0), 'private'); assert.equal(visibilityOf(false, 2), 'shared'); assert.equal(visibilityOf(true, 2), 'published');
});

test('drafts: private to the author until shared; edit and apply need editor rights; discard is author, owner or admin', () => {
  const priv = { ownerId: 'e', visibility: 'private' as const }, shared = { ownerId: 'e', visibility: 'shared' as const };
  assert.equal(draftRole('editor', priv, u('e')), 'author');
  assert.equal(draftRole('owner', priv, u('o')), 'none', 'not even the env owner reads a private draft');
  assert.equal(draftRole('none', priv, u('a', true)), 'author', 'admin');
  assert.equal(draftRole('viewer', shared, u('v')), 'viewer');
  assert.equal(draftRole('editor', shared, u('f')), 'editor');
  assert.equal(draftRole('none', shared, u('x')), 'none');
  assert.equal(canEditDraft('viewer', shared, u('v')), false);
  assert.equal(canEditDraft('editor', shared, u('f')), true);
  assert.equal(canEditDraft('viewer', priv, u('e')), false, 'an author who lost editor rights cannot edit');
  assert.equal(canApplyDraft('editor', priv, u('e')), true);
  assert.equal(canDiscardDraft('owner', shared, u('o')), true);
  assert.equal(canDiscardDraft('editor', shared, u('f')), false);
  assert.equal(canShareDraft(priv, u('e')), true); assert.equal(canShareDraft(shared, u('o')), false);
});

test('auth off: everyone is an admin, /api/me says so, tokens do not exist, new designs stay published and ownerless, X-Flow-User still works', async () => {
  const app = await startApp();
  try {
    await app.call('POST', '/api/ingest', { manifests: sampleManifests() });
    const me = await app.call('GET', '/api/me');
    assert.deepEqual([me.body.auth, me.body.admin, me.body.signedIn], ['off', true, true]);
    assert.equal((await app.call('POST', '/api/tokens', { name: 'x' })).status, 404);
    assert.notEqual((await app.call('GET', '/auth/login')).status, 302, 'no login redirect in off mode');
    assert.equal((await app.call('POST', '/api/envs', { name: 'plain', mode: 'blank' })).status, 201);
    const row = app.ctx.db.prepare("SELECT owner_user_id, visibility FROM envs WHERE name = 'plain'").get() as any;
    assert.deepEqual([row.owner_user_id, row.visibility], [null, 'published']);
    assert.equal((await app.call('PUT', '/api/envs/plain/access', { members: [] })).status, 200);
    assert.equal((await app.call('POST', '/api/ingest', { manifests: [] })).status !== 403, true);
    const names = (await app.call('GET', '/api/envs')).body;
    assert.ok(names.includes('plain') && names.includes('prod'));
    const m = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whoami', arguments: {} } });
    assert.equal(JSON.parse(m.body.result.content[0].text).auth, 'off');
  } finally { await app.close(); }
});
