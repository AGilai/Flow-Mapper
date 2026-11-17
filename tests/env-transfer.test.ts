// Whole-environment export / import (server/env-transfer): a design env built on instance A moves to instance B that has no source env.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, startDesign } from './helpers.ts';
import { callAnchor, serializeCall } from '../core/call-notes.ts';
import { SPECS, SKIPPED_WITH_ENV } from '../server/env-transfer/spec.ts';

let A: Awaited<ReturnType<typeof startDesign>>, B: Awaited<ReturnType<typeof startApp>>;
let bundle: any;
const ENV = 'hld', FLOW = 'flow:pop-edge/in.open', CALL = callAnchor('api-gateway', 'orders-svc', 'POST /orders');
const D = `/api/envs/${ENV}/drafts`;
const up = (anchor: string, data: unknown) => ({ op: 'upsert', anchor, data });

before(async () => {
  A = await startDesign(ENV); B = await startApp();
  // an applied draft that adds a component + an endpoint, and an open one with ops
  const d = (await A.call('POST', D, { name: 'Agent connects', createdBy: 'ana' })).body;
  await A.call('POST', `${D}/${d.slug}/ops`, { ops: [
    up('svc:pop-edge', { kind: 'service', groupPath: 'agent', team: 'net' }),
    up('fn:pop-edge/H', { id: 'H', name: 'H', steps: [{ seq: 1, type: 'egress', target: 'out.tok' }] }),
    up('ing:pop-edge/in.open', { id: 'in.open', transport: 'socket', bindKey: 'socket:tls/pop-edge/open', handler: 'H' }),
    up('egr:pop-edge/out.tok', { id: 'out.tok', transport: 'http', mode: 'sync', bindKey: 'http:POST auth-svc/token' }),
    up('fn:auth-svc/Tok', { id: 'Tok', name: 'Tok', steps: [] }),
    up('ing:auth-svc/in.token', { id: 'in.token', transport: 'http', bindKey: 'http:POST auth-svc/token', handler: 'Tok' }),
  ], author: 'ana' });
  assert.equal((await A.call('POST', `${D}/${d.slug}/apply`, { by: 'ana' })).status, 200);
  const o = (await A.call('POST', D, { name: 'Open work', createdBy: 'ben' })).body;
  await A.call('POST', `${D}/${o.slug}/ops`, { ops: [up('fn:auth-svc/Later', { id: 'Later', name: 'Later', steps: [] })], author: 'ben' });
  // comments with a reply, an action item from a comment, flow notes, call notes, a colour
  const top = (await A.call('POST', `/api/envs/${ENV}/comments`, { anchor: FLOW, author: 'Ana', body: '<p>Why?</p>' })).body;
  await A.call('POST', `/api/envs/${ENV}/comments`, { anchor: FLOW, author: 'Ben', body: '<p>Because.</p>', parentId: top.id });
  await A.call('POST', `/api/envs/${ENV}/action-items`, { anchor: FLOW, owner: 'Dana', description: 'check it', actor: 'Ana', commentId: top.id });
  await A.call('PUT', `/api/envs/${ENV}/notes`, { anchor: FLOW, author: 'Ana', body: '<p>v1</p>', baseVersion: 0 });
  await A.call('PUT', `/api/envs/${ENV}/notes`, { anchor: FLOW, author: 'Ana', body: '<p>v2</p>', baseVersion: 1 });
  await A.call('PUT', `/api/envs/${ENV}/notes`, { anchor: CALL, author: 'Ana', body: serializeCall({ what: 'Creates.', watch: { on: true, text: 'not idempotent' } }), baseVersion: 0 });
  await A.call('PUT', `/api/envs/${ENV}/color`, { color: 4 });
  const ex = await A.call('GET', `/api/envs/${ENV}/export`);
  assert.equal(ex.status, 200); bundle = ex.body;
});
after(async () => { await A.close(); await B.close(); });

/** Drop autoincrement ids (they differ by design); everything else must be equal. */
const strip = (x: any): any => Array.isArray(x) ? x.map(strip) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([k]) => !['id', 'draft_id', 'draftId', 'changelogId', 'parentId', 'commentId', 'itemId', 'authorId', 'ownerId', 'createdById', 'userId'].includes(k)).map(([k, v]) => [k, strip(v)])) : x;
const same = async (path: string, name = path) => {
  const [a, b] = [await A.call('GET', path), await B.call('GET', path)];
  assert.equal(b.status, a.status, `${name}: status ${JSON.stringify(b.body)}`);
  assert.deepEqual(strip(b.body), strip(a.body), name);
  return a.body;
};

test('bundle: format header, no owner, every table decided', () => {
  assert.equal(bundle.format, 'flow-mapper-env'); assert.equal(bundle.formatVersion, 1);
  assert.equal(bundle.schemaVersion, 20); assert.ok(bundle.appVersion && bundle.exportedAt);
  assert.equal(bundle.env.owner_user_id, undefined); assert.equal(bundle.env.name, ENV); assert.equal(bundle.env.source, 'prod');
assert.ok(bundle.tables.baseline_items.length > 0 && bundle.tables.draft_ops.length > 0 && bundle.tables.comments.length === 2);
  const db = A.ctx.db, known = new Set([...SPECS.map((s) => s.table), ...SKIPPED_WITH_ENV]);
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]) {
    const cols = (db.prepare(`PRAGMA table_info("${t.name}")`).all() as { name: string }[]).map((c) => c.name);
    if (cols.includes('env')) assert.ok(known.has(t.name), `table ${t.name} has an env column: decide it in server/env-transfer/spec.ts`);
  }
});

test('import into an instance without the source: dry run leaves nothing, then the real one', async () => {
  const dry = await B.call('POST', '/api/envs/import?dryRun=1', bundle);
  assert.equal(dry.status, 200, JSON.stringify(dry.body)); assert.equal(dry.body.env, ENV); assert.ok(dry.body.counts.comments === 2);
  assert.equal((await B.call('GET', `/api/envs/${ENV}/meta`)).status, 404);
  assert.equal(B.ctx.db.prepare('SELECT count(*) AS n FROM comments').get()!.n, 0);
  const r = await B.call('POST', '/api/envs/import', bundle);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.counts, dry.body.counts);
  assert.ok(r.body.warnings.some((w: string) => /source prod not here/.test(w)), JSON.stringify(r.body.warnings));
});

test('the same answers on both instances', async () => {
  const strip2 = (m: any) => ({ ...m, access: undefined, color: undefined, colorAuto: undefined });
  const [ma, mb] = [(await A.call('GET', `/api/envs/${ENV}/meta`)).body, (await B.call('GET', `/api/envs/${ENV}/meta`)).body];
  assert.deepEqual(strip2(mb), strip2(ma)); assert.ok(Object.keys(ma.colors).length > 0 && ma.groups.length === 2);
  const flows = await same(`/api/envs/${ENV}/flows/counts`); assert.ok(Object.keys(flows).length > 0 || flows.length > 0);
  const tr = await same(`/api/envs/${ENV}/trace?service=pop-edge&ingress=in.open`); assert.ok(JSON.stringify(tr).length > 100);
  await same(`/api/envs/${ENV}/views/system`);
  await same(`/api/envs/${ENV}/health/history`);
  const th = await same(`/api/envs/${ENV}/notes?anchor=${encodeURIComponent(FLOW)}&history=1`); assert.equal(th.version, 2);
  const calls = await same(`/api/envs/${ENV}/notes/calls`); assert.ok(JSON.stringify(calls).includes('Creates'));
  await same(`/api/envs/${ENV}/notes/index`);
  const c = await same(`/api/envs/${ENV}/comments?anchor=${encodeURIComponent(FLOW)}`);
  assert.deepEqual(c.comments.map((x: any) => x.replies.length), [1]);
  const ai = await same(`/api/envs/${ENV}/action-items?anchor=${encodeURIComponent(FLOW)}`); assert.equal(JSON.stringify(ai).includes('check it'), true);
  await same(`/api/envs/${ENV}/comments/counts`);
});

test('baseline marks (new / changed) are identical with the source missing; against=source says NO_SOURCE', async () => {
  const m = await same(`/api/envs/${ENV}/marks`);
  assert.ok(JSON.stringify(m).includes('pop-edge'), 'the applied draft shows as new');
  const s = await B.call('GET', `/api/envs/${ENV}/marks?against=source`);
  assert.equal(s.status, 409); assert.equal(s.body.error.code, 'NO_SOURCE');
});

test('history: drafts of every status with their ops, changelog, versions', async () => {
  const la = (await A.call('GET', `${D}?status=all`)).body, lb = (await B.call('GET', `${D}?status=all`)).body;
  assert.deepEqual(lb.map((d: any) => [d.slug, d.status]), la.map((d: any) => [d.slug, d.status]));
  assert.deepEqual(new Set(lb.map((d: any) => d.status)), new Set(['applied', 'open']));
  for (const d of la) await same(`${D}/${d.slug}`, `draft ${d.slug}`);
  const log = await same(`/api/envs/${ENV}/changelog?limit=500`);
  assert.ok(log.some((r: any) => r.kind === 'draft'));
  // changelog rows point at the new draft ids
  const rows = B.ctx.db.prepare("SELECT c.draft_id, d.slug FROM changelog c JOIN drafts d ON d.id = c.draft_id WHERE c.env = ? AND c.kind = 'draft'").all(ENV);
  assert.equal(rows.length, 1);
  await same(`/api/envs/${ENV}/services/pop-edge`);
  await same(`/api/envs/${ENV}/services/auth-svc`);
});

test('ids are re-keyed inside the import: parents, replies, note versions, items', () => {
  const db = B.ctx.db;
  const q = (sql: string) => db.prepare(sql).all() as any[];
  assert.equal(q('SELECT count(*) AS n FROM comments c JOIN comments p ON p.id = c.parent_id').at(0).n, 1);
  assert.equal(q('SELECT count(*) AS n FROM action_items a JOIN comments c ON c.id = a.comment_id').at(0).n, 1);
  assert.equal(q('SELECT count(*) AS n FROM draft_ops o JOIN drafts d ON d.id = o.draft_id').at(0).n, bundle.tables.draft_ops.length);
  assert.equal(q('SELECT count(*) AS n FROM action_item_events e JOIN action_items a ON a.id = e.item_id').at(0).n, bundle.tables.action_item_events.length);
});

test('rules: ENV_EXISTS, ?as= rename, BAD_FORMAT, SCHEMA_NEWER, older bundle with an unknown column', async () => {
  const again = await B.call('POST', '/api/envs/import', bundle);
  assert.equal(again.status, 409); assert.equal(again.body.error.code, 'ENV_EXISTS');
  const as = await B.call('POST', '/api/envs/import?as=hld-copy', bundle);
  assert.equal(as.status, 201); assert.equal(as.body.env, 'hld-copy');
  assert.equal((await B.call('GET', '/api/envs/hld-copy/comments?anchor=' + encodeURIComponent(FLOW))).body.count, 2);
  assert.equal((await B.call('POST', '/api/envs/import', { ...bundle, formatVersion: 2 })).body.error.code, 'BAD_FORMAT');
  assert.equal((await B.call('POST', '/api/envs/import', { nope: 1 })).status, 400);
  const nw = await B.call('POST', '/api/envs/import?as=x1', { ...bundle, schemaVersion: 999 });
  assert.equal(nw.status, 409); assert.equal(nw.body.error.code, 'SCHEMA_NEWER');
  const old = structuredClone(bundle); old.schemaVersion = 19; old.tables.comments[0].future_col = 'x'; delete old.tables.comments[0].steps_from;
  const o = await B.call('POST', '/api/envs/import?as=x2', old);
  assert.equal(o.status, 201, JSON.stringify(o.body)); assert.ok(o.body.warnings.some((w: string) => /future_col/.test(w)));
  assert.equal((await B.call('GET', '/api/envs/x1/meta')).status, 404);
});

test('export refuses a sealed env and an unknown one', async () => {
  assert.equal((await A.call('GET', '/api/envs/prod/export')).status, 400);
  assert.equal((await A.call('GET', '/api/envs/nope/export')).status, 404);
});

test('users: matched by exact email only, never by name, none created', async () => {
  const count = () => (B.ctx.db.prepare('SELECT count(*) AS n FROM users').get() as any).n;
  const n = (sql: string) => (B.ctx.db.prepare(sql).get() as any).n;
  const before = count();
  const r = await B.call('POST', '/api/envs/import?as=u1', bundle);
  assert.ok(r.body.warnings.some((w: string) => /not matched here by email/.test(w) && /Ana/.test(w)), JSON.stringify(r.body.warnings));
  assert.equal(count(), before, 'no user was created');
  assert.equal(n("SELECT count(*) AS n FROM comments WHERE env = 'u1' AND author_id IS NOT NULL"), 0);
  assert.equal(n("SELECT count(*) AS n FROM comments WHERE env = 'u1' AND author = 'Ana'"), 1, 'the name stays as text');
  B.ctx.db.prepare("INSERT INTO users (id, name, color, created_at, email) VALUES ('u_bb', 'Ana', 0, 'x', 'ana@example.com')").run();
  const withEmail = structuredClone(bundle);
  for (const u of Object.values(withEmail.users) as any[]) if (u.name === 'Ana') u.email = 'ANA@example.com';
  assert.equal((await B.call('POST', '/api/envs/import?as=u2', withEmail)).status, 201);
  assert.equal(n("SELECT count(*) AS n FROM comments WHERE env = 'u2' AND author_id = 'u_bb'"), 1);
});
