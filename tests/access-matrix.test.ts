// Access matrix (cognito mode): (owner, editor, viewer, other, admin) x (private, shared, published, legacy ownerless, sealed) over REST lists and by-id,
// search, entry points, comments, action items, mentions, bugs, the event stream and MCP. A hidden item is absent from lists and 404 by id.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startCognito } from './cognito-helpers.ts';

let t: Awaited<ReturnType<typeof startCognito>>;
let P: Record<'owner' | 'editor' | 'viewer' | 'other' | 'admin', Awaited<ReturnType<typeof t.signIn>>>;
let harvester: Awaited<ReturnType<typeof t.seed>>['harvester'];
const ENVS = ['d-private', 'd-shared', 'd-pub', 'd-legacy'];
const code = (r: { body: any }) => r.body?.error?.code;

before(async () => {
  t = await startCognito();
  ({ harvester } = await t.seed());
  P = { owner: await t.signIn('owner@example.com', 'Olive Owner'), editor: await t.signIn('editor@example.com', 'Eddie Editor'), viewer: await t.signIn('viewer@example.com', 'Vera Viewer'),
    other: await t.signIn('other@example.com', 'Otto Other'), admin: await t.signIn('admin@example.com', 'Admin') };
  for (const name of ENVS) {
    const r = await P.owner.call('POST', '/api/envs', { name, source: 'prod', mode: 'components', behaviour: true, entryPoints: 'keep', groups: [{ key: 'platform', label: 'Platform' }], services: [{ name: 'users-svc', groupPath: 'platform' }, { name: 'auth-svc', groupPath: 'platform' }] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  const members = [{ userId: P.editor.id, role: 'editor' }, { userId: P.viewer.id, role: 'viewer' }];
  assert.equal((await P.owner.call('PUT', '/api/envs/d-shared/access', { members })).status, 200);
  assert.equal((await P.owner.call('PUT', '/api/envs/d-pub/access', { published: true })).status, 200);
  for (const e of ENVS) { // something to hide in each: a comment and an action item that mention the editor, notes, a bug
    const anchor = 'flow:users-svc/in.getUser';
    const c = await P.owner.call('POST', `/api/envs/${e}/comments`, { anchor, author: 'x', body: `look @[${P.editor.id}] secret-${e}` });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    await P.owner.call('POST', `/api/envs/${e}/action-items`, { anchor, owner: 'Eddie Editor', description: `todo ${e}`, actor: 'x' });
    await P.owner.call('PUT', `/api/envs/${e}/notes`, { anchor, body: `notes ${e}` });
    await P.owner.call('POST', '/api/bugs', { title: `bug in ${e}`, env: e });
  }
  t.ctx.db.prepare("UPDATE envs SET owner_user_id = NULL, visibility = 'published' WHERE name = 'd-legacy'").run(); // a design from before 0.52.0
});
after(() => t.close());

/** Who has which role in which env. */
const ROLE: Record<string, Record<keyof typeof P, 'none' | 'viewer' | 'editor' | 'owner'>> = {
  'd-private': { owner: 'owner', editor: 'none', viewer: 'none', other: 'none', admin: 'owner' },
  'd-shared': { owner: 'owner', editor: 'editor', viewer: 'viewer', other: 'none', admin: 'owner' },
  'd-pub': { owner: 'owner', editor: 'viewer', viewer: 'viewer', other: 'viewer', admin: 'owner' },
  'd-legacy': { owner: 'viewer', editor: 'viewer', viewer: 'viewer', other: 'viewer', admin: 'owner' },
  prod: { owner: 'viewer', editor: 'viewer', viewer: 'viewer', other: 'viewer', admin: 'owner' },
};
const who = Object.keys(ROLE['d-private']) as (keyof typeof P)[];

test('lists: envs, env meta, search, entry points, comments, action items, notes, mentions, bugs show only readable envs', async () => {
  for (const w of who) {
    const p = P[w], seen = (e: string) => ROLE[e][w] !== 'none';
    const names = (await p.call('GET', '/api/envs')).body as string[];
    const meta = (await p.call('GET', '/api/envs/meta')).body.map((e: any) => e.name);
    for (const e of Object.keys(ROLE)) {
      assert.equal(names.includes(e), seen(e), `${w}: /api/envs ${e}`);
      assert.equal(meta.includes(e), seen(e), `${w}: /api/envs/meta ${e}`);
    }
    const mentions = (await p.call('GET', `/api/mentions?user=${P.editor.id}`)).body;
    for (const e of ENVS) {
      assert.equal(mentions.mentions.some((m: any) => m.env === e), seen(e), `${w}: mention in ${e}`);
      const bugs = (await p.call('GET', '/api/bugs')).body;
      assert.equal(bugs.some((b: any) => b.title === `bug in ${e}`), seen(e), `${w}: bug of ${e}`);
    }
  }
});

test('by id: every env-scoped read is 200 when readable and 404 (never 403) when hidden', async () => {
  const paths = ['meta', 'services', 'views/system', 'entry-points', 'search?q=users', 'comments?anchor=flow:users-svc/in.getUser', 'action-items?anchor=flow:users-svc/in.getUser', 'notes?anchor=flow:users-svc/in.getUser',
    'notes/index', 'open-questions', 'subsystems', 'drafts', 'changelog', 'access', 'flow-names', 'inventory', 'mentions/counts'];
  for (const w of who) for (const e of ENVS) for (const path of paths) {
    const r = await P[w].call('GET', `/api/envs/${e}/${path}`);
    if (ROLE[e][w] === 'none') { assert.equal(r.status, 404, `${w} ${e}/${path}: ${r.status}`); assert.equal(code(r), 'NOT_FOUND'); } else assert.equal(r.status, 200, `${w} ${e}/${path}: ${JSON.stringify(r.body).slice(0, 120)}`);
  }
  const bug = t.ctx.db.prepare("SELECT id FROM bugs WHERE title = 'bug in d-private'").get() as any;
  assert.equal((await P.other.call('GET', `/api/bugs/${bug.id}`)).status, 404);
  assert.equal((await P.owner.call('GET', `/api/bugs/${bug.id}`)).status, 200);
  assert.equal((await P.other.call('POST', '/api/envs', { name: 'steal', source: 'd-private', mode: 'full' })).status, 404, 'copying a hidden env');
});

test('writes: editors annotate, viewers get 403, hidden is 404, only the owner or an admin deletes or shares', async () => {
  for (const w of who) for (const e of ENVS) {
    const role = ROLE[e][w], r = await P[w].call('PUT', `/api/envs/${e}/levels`, { levels: ['Subsystem', 'Component'] });
    if (role === 'none') assert.equal(r.status, 404, `${w} levels ${e}`); else if (role === 'viewer') { assert.equal(r.status, 403, `${w} levels ${e}`); assert.equal(code(r), 'FORBIDDEN'); } else assert.equal(r.status, 200, `${w} levels ${e}: ${JSON.stringify(r.body)}`);
    const a = await P[w].call('PUT', `/api/envs/${e}/access`, { published: ROLE[e][w] === 'owner' ? e === 'd-pub' : false });
    assert.equal(a.status, role === 'none' ? 404 : role === 'owner' ? 200 : 403, `${w} access ${e}`);
  }
  // the legacy design has no owner: admin only; a non-admin cannot delete, an editor of d-shared cannot
  assert.equal((await P.editor.call('DELETE', '/api/envs/d-shared')).status, 403);
  assert.equal((await P.other.call('DELETE', '/api/envs/d-private')).status, 404);
  assert.equal((await P.admin.call('PUT', '/api/envs/d-legacy/access', { owner: P.owner.id })).status, 200, 'an admin gives a legacy design an owner');
  assert.equal((await P.owner.call('PUT', '/api/envs/d-legacy/access', { owner: P.other.id })).status, 400, 'only an admin changes the owner');
  t.ctx.db.prepare("UPDATE envs SET owner_user_id = NULL, visibility = 'published' WHERE name = 'd-legacy'").run();
});

test('sealed env: everyone reads, annotates; ingest needs the harvester scope (REST and MCP)', async () => {
  for (const w of who) {
    assert.equal((await P[w].call('GET', '/api/envs/prod/services')).status, 200);
    assert.equal((await P[w].call('PUT', '/api/envs/prod/levels', { levels: ['Subsystem', 'Component'] })).status, 200, `${w} annotates prod`);
    const r = await P[w].call('POST', '/api/ingest', { manifests: [] });
    assert.equal(r.status, 403, `${w} ingest`); assert.equal(code(r), 'SEALED');
    const d = await P[w].call('POST', '/api/envs/prod/dtos', { dtos: [] });
    assert.equal(code(d), 'SEALED', `${w} dtos`);
    const m = await P[w].mcp('ingest_manifest', { manifest: {} });
    assert.equal(m.isError, true); assert.match(m.text, /^SEALED/);
  }
  assert.notEqual((await harvester.call('POST', '/api/ingest', { manifests: [] })).status, 403, 'a harvester token passes the scope check');
  assert.equal((await harvester.call('GET', '/api/envs/prod/services')).status, 200);
});

test('SSE and recent events are filtered per caller', async () => {
  await P.owner.call('PUT', '/api/envs/d-private/color', { color: 3 });
  await P.owner.call('PUT', '/api/envs/d-pub/color', { color: 4 });
  const recent = async (w: keyof typeof P) => ((await P[w].call('GET', '/api/events/recent?limit=200')).body.events as any[]).filter((e) => e.type === 'env.updated').map((e) => e.env);
  assert.ok((await recent('owner')).includes('d-private'));
  assert.ok(!(await recent('other')).includes('d-private'), 'other never sees the private env event');
  assert.ok((await recent('other')).includes('d-pub'));
  // live stream
  const ctl = new AbortController();
  const res = await fetch(t.base + '/api/events', { signal: ctl.signal, headers: { cookie: [...P.other.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } });
  assert.equal(res.status, 200);
  let got = '';
  const reader = res.body!.getReader();
  const pump = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; got += Buffer.from(value).toString(); } } catch { /* aborted */ } })();
  await new Promise((r) => setTimeout(r, 150));
  await P.owner.call('PUT', '/api/envs/d-private/color', { color: 5 });
  await P.owner.call('PUT', '/api/envs/d-pub/color', { color: 6 });
  await new Promise((r) => setTimeout(r, 300));
  ctl.abort(); await pump;
  assert.match(got, /d-pub/); assert.doesNotMatch(got, /d-private/);
  assert.equal((await t.anon.call('GET', '/api/events')).status, 401);
});

test('MCP acts as the token user: list_envs, reads, writes, create_env, share_env, whoami', async () => {
  const tok = async (p: typeof P.owner, name: string) => t.bearer((await t.token(p, name)).token);
  const owner = await tok(P.owner, 'o'), other = await tok(P.other, 'x'), viewer = await tok(P.viewer, 'v'), editor = await tok(P.editor, 'e');
  const wa = await owner.mcp('whoami');
  assert.equal(wa.json.user.name, 'Olive Owner'); assert.equal(wa.json.admin, false); assert.equal(wa.json.scope, 'user');
  const listed = async (c: typeof owner) => (await c.mcp('list_envs')).json.map((e: any) => e.name);
  assert.ok((await listed(owner)).includes('d-private')); assert.ok(!(await listed(other)).includes('d-private'));
  assert.ok((await listed(other)).includes('d-pub'));
  const hidden = await other.mcp('search', { env: 'd-private', q: 'users' });
  assert.equal(hidden.isError, true); assert.match(hidden.text, /NOT_FOUND/);
  assert.equal((await other.mcp('list_entry_points', { env: 'd-private' })).isError, true);
  assert.equal((await other.mcp('list_entry_points', { env: 'd-pub' })).isError, false);
  assert.equal((await owner.mcp('list_entry_points', { env: 'd-private' })).isError, false);
  const mm = await other.mcp('list_mentions', { user: P.editor.id });
  assert.ok(!JSON.stringify(mm.json).includes('secret-d-private'), 'mentions in hidden envs are absent');
  assert.ok(JSON.stringify(mm.json).includes('secret-d-pub'));
  assert.ok(!(await other.mcp('list_bugs')).json.some((b: any) => b.title === 'bug in d-private'));
  // writes
  const ro = await viewer.mcp('set_description', { env: 'd-shared', service: 'users-svc', ingress: 'in.getUser', text: 'x' });
  assert.equal(ro.isError, true); assert.match(ro.text, /^FORBIDDEN/);
  assert.equal((await viewer.mcp('open_draft', { env: 'd-shared', name: 'nope' })).isError, true);
  const draft = await editor.mcp('open_draft', { env: 'd-shared', name: 'ed draft' });
  assert.equal(draft.isError, false, draft.text);
  assert.equal(draft.json.ownerId, P.editor.id); assert.equal(draft.json.shared, false);
  // create_env: a private design owned by the caller
  const mk = await other.mcp('create_env', { name: 'other-own', mode: 'blank' });
  assert.equal(mk.isError, false, mk.text);
  const acc = (await P.other.call('GET', '/api/envs/other-own/access')).body;
  assert.deepEqual([acc.owner.name, acc.visibility, acc.role], ['Otto Other', 'private', 'owner']);
  assert.equal((await owner.mcp('list_entry_points', { env: 'other-own' })).isError, true, 'private to its creator');
  assert.equal((await other.mcp('create_env', { name: 'copy-hidden', mode: 'full', source: 'd-private' })).isError, true, 'cannot copy what you cannot read');
  // share_env
  assert.equal((await viewer.mcp('share_env', { env: 'other-own', published: true })).isError, true);
  const sh = await other.mcp('share_env', { env: 'other-own', members: [{ user: 'Vera Viewer', role: 'viewer' }] });
  assert.equal(sh.isError, false, sh.text);
  assert.equal(sh.json.visibility, 'shared');
  assert.equal((await viewer.mcp('list_entry_points', { env: 'other-own' })).isError, false);
  assert.equal((await other.mcp('share_env', { env: 'other-own', published: true, members: [] })).json.visibility, 'published');
});

test('drafts: private to the author until shared; viewers read but cannot edit; apply needs editor rights; discard is for the author or owner', async () => {
  const e = 'd-shared';
  const mine = await P.editor.call('POST', `/api/envs/${e}/drafts`, { name: 'Eds', slug: 'eds' });
  assert.equal(mine.status, 201); assert.equal(mine.body.ownerId, P.editor.id); assert.equal(mine.body.shared, false);
  assert.equal((await P.viewer.call('POST', `/api/envs/${e}/drafts`, { name: 'V', slug: 'v' })).status, 403, 'a viewer cannot open a draft');
  for (const w of ['owner', 'viewer', 'other'] as const) {
    const l = await P[w].call('GET', `/api/envs/${e}/drafts`);
    if (w !== 'other') assert.ok(!l.body.some((d: any) => d.slug === 'eds'), `${w} does not list a private draft`);
    assert.equal((await P[w].call('GET', `/api/envs/${e}/drafts/eds`)).status, 404, `${w} get`);
    assert.equal((await P[w].call('GET', `/api/envs/${e}/services?draft=eds`)).status, 404, `${w} ?draft=`);
    assert.equal((await P[w].call('POST', `/api/envs/${e}/drafts/eds/ops`, { ops: [] })).status, 404, `${w} ops`);
  }
  assert.ok((await P.admin.call('GET', `/api/envs/${e}/drafts`)).body.some((d: any) => d.slug === 'eds'), 'an admin sees private drafts');
  assert.equal((await P.owner.call('PUT', `/api/envs/${e}/drafts/eds/share`, { shared: true })).status, 404, 'only the author shares (the owner cannot even see it)');
  assert.equal((await P.editor.call('PUT', `/api/envs/${e}/drafts/eds/share`, { shared: true })).status, 200);
  const op = { ops: [{ op: 'upsert', anchor: 'svc:users-svc', data: { kind: 'service' } }] };
  assert.equal((await P.viewer.call('GET', `/api/envs/${e}/drafts/eds`)).status, 200, 'shared: the env readers read it');
  assert.equal((await P.viewer.call('POST', `/api/envs/${e}/drafts/eds/ops`, op)).status, 403, 'a viewer cannot edit it');
  assert.equal((await P.viewer.call('POST', `/api/envs/${e}/drafts/eds/apply`, {})).status, 403);
  assert.equal((await P.other.call('GET', `/api/envs/${e}/drafts/eds`)).status, 404, 'still hidden from people without access to the env');
  assert.equal((await P.owner.call('POST', `/api/envs/${e}/drafts/eds/ops`, op)).status, 201, 'the env owner edits a shared draft');
  assert.equal((await P.editor.call('POST', `/api/envs/${e}/drafts/eds/apply`, {})).status, 200, 'an editor applies');
  const second = await P.editor.call('POST', `/api/envs/${e}/drafts`, { name: 'Two', slug: 'two' });
  assert.equal(second.status, 201);
  await P.editor.call('PUT', `/api/envs/${e}/drafts/two/share`, { shared: true });
  const other = await P.owner.call('POST', `/api/envs/${e}/drafts`, { name: 'Owners', slug: 'owners' });
  await P.owner.call('PUT', `/api/envs/${e}/drafts/owners/share`, { shared: true });
  assert.equal((await P.editor.call('DELETE', `/api/envs/${e}/drafts/owners`)).status, 403, 'an editor cannot discard the owner\'s draft');
  assert.equal((await P.owner.call('DELETE', `/api/envs/${e}/drafts/two`)).status, 200, 'the env owner can discard a shared draft');
  assert.equal(other.status, 201);
  // changelog: the acting user id
  const row = t.ctx.db.prepare("SELECT user_id FROM changelog WHERE env = ? AND kind = 'draft' ORDER BY id DESC LIMIT 1").get(e) as any;
  assert.equal(row.user_id, P.editor.id, 'the apply is audited with the acting user');
});

test('new design envs are private to their creator; the changelog of the copy names the creator; users cannot spoof the author with X-Flow-User', async () => {
  const r = await P.other.call('POST', '/api/envs', { name: 'mine-only', mode: 'blank' });
  assert.equal(r.status, 201);
  const a = (await P.other.call('GET', '/api/envs/mine-only/access')).body;
  assert.deepEqual([a.visibility, a.published, a.owner.id], ['private', false, P.other.id]);
  assert.equal((await P.owner.call('GET', '/api/envs/mine-only/meta')).status, 404);
  assert.equal((await P.admin.call('GET', '/api/envs/mine-only/meta')).status, 200);
  const c = await P.owner.call('POST', '/api/envs/d-pub/comments', { anchor: 'flow:users-svc/in.getUser', author: 'Someone', body: 'hi' }, { 'x-flow-user': P.editor.id });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal((t.ctx.db.prepare('SELECT author_id FROM comments WHERE id = ?').get(c.body.id) as any).author_id, P.owner.id, 'the signed-in user is the author, not the header');
});

test('report_bug without an env (or with an env label that is no env) is visible to its reporter, other users and admins; a private design env stays hidden', async () => {
  const tok = async (p: typeof P.owner, name: string) => t.bearer((await t.token(p, name)).token);
  const other = await tok(P.other, 'rb-x'), viewer = await tok(P.viewer, 'rb-v'), admin = await tok(P.admin, 'rb-a');
  const r = await other.mcp('report_bug', { title: 'no-env bug' });
  assert.equal(r.isError, false, r.text);
  const label = await other.mcp('report_bug', { title: 'label-env bug', env: 'some-harvester-label' });
  assert.equal(label.isError, false, label.text);
  for (const [name, c] of [['other', other], ['viewer', viewer], ['admin', admin]] as const) {
    const titles = (await c.mcp('list_bugs')).json.map((b: any) => b.title);
    assert.ok(titles.includes('no-env bug'), `${name} sees the no-env bug`);
    assert.ok(titles.includes('label-env bug'), `${name} sees the label-env bug`);
    assert.ok(!titles.includes('bug in d-private') || name === 'admin', `${name}: the private design's bug stays hidden`);
    assert.equal((await c.mcp('get_bug', { id: r.json.id })).isError, false, `${name} can get it`);
  }
  assert.equal((await P.other.call('GET', '/api/bugs')).body.some((b: any) => b.title === 'no-env bug'), true, 'REST list too');
  assert.equal((await P.other.call('POST', '/api/bugs', { title: 'rest no-env' })).status, 201);
  assert.equal((await P.other.call('POST', '/api/bugs', { title: 'x', env: 'd-private' })).status, 404, 'a private env is still not reportable by others');
});
