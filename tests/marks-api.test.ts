// Marks through the API (QA D9, D11, D13): a fresh copy has none, a draft shows its changes, `against=source` shows drift,
// counts equal the per-anchor marks, the memo follows writes to the environment and to its source.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readSample, startDesign, startApp, sampleManifests } from './helpers.ts';
import { marksFor } from '../server/marks.ts';
import { deleteServiceIn } from '../server/store/snapshots-crud.ts';
import { parseAnchor } from '../core/anchors.ts';
import { generateMock } from '../scripts/mock/generate.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());

const D = '/api/envs/hld/drafts', M = '/api/envs/hld/marks';
const up = (anchor: string, data: unknown) => ({ op: 'upsert', anchor, data });
const marks = async (q = '') => (await app.call('GET', `${M}${q}`)).body;

test('a fresh Components copy has no marks, in baseline and in source mode; a sealed env has none and no baseline', async () => {
  for (const q of ['', '?against=baseline', '?against=source']) {
    const m = await marks(q);
    assert.deepEqual(m.marks, {}, q); assert.deepEqual(m.ghosts, {}, q);
    assert.equal(m.counts.components.changed + m.counts.components.new + m.counts.components.removed, 0);
  }
  const m = await marks();
  assert.equal(m.against, 'baseline'); assert.equal(m.source, 'prod'); assert.ok(m.baselineAt); assert.equal(m.draft, null);
  assert.ok(m.counts.components.unchanged >= 2);
  const sealed = (await app.call('GET', '/api/envs/prod/marks')).body;
  assert.deepEqual([sealed.marks, sealed.baselineAt, sealed.source], [{}, null, null]);
  assert.equal((await app.call('GET', `${M}?against=sideways`)).status, 400);
  assert.equal((await app.call('GET', '/api/envs/nope/marks')).status, 404);
});

test('a Full copy of the whole sample system has no marks either (no diff noise on prod-like data)', async () => {
  assert.equal((await app.call('POST', '/api/envs', { name: 'full-copy', source: 'prod', mode: 'full' })).status, 201);
  for (const q of ['', '?against=source']) assert.deepEqual((await app.call('GET', `/api/envs/full-copy/marks${q}`)).body.marks, {}, q);
});

test('draft marks: new component, new endpoint on a copied one with the roll-up phrase, a changed field of a message', async () => {
  await app.call('POST', D, { name: 'Marks', slug: 'marks' });
  const r = await app.call('POST', `${D}/marks/ops`, { ops: [
    up('svc:pop', { kind: 'service', groupPath: 'agent' }),
    up('fn:pop/H', { id: 'H', name: 'H', steps: [] }),
    up('ing:pop/in.x', { id: 'in.x', transport: 'http', bindKey: 'http:GET pop/x', handler: 'H' }),
    up('fn:auth-svc/T', { id: 'T', name: 'T', steps: [] }),
    up('ing:auth-svc/in.t', { id: 'in.t', transport: 'http', bindKey: 'http:POST auth-svc/t', handler: 'T' }),
    up('egr:auth-svc/out.u', { id: 'out.u', transport: 'http', mode: 'sync', bindKey: 'http:GET users-svc/users/{id}' }),
    up('dto:users-svc/response/-/in.getUser', { content: { id: 'x', name: 'n', email: 'e', tier: 1, createdAt: 'c', cert: 'f' }, meta: null }),
  ] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual((await marks()).marks, {}, 'the environment itself is untouched');
  const m = await marks('?draft=marks');
  assert.equal(m.draft, 'marks');
  assert.equal(m.marks['svc:pop'].mark, 'new');
  assert.equal(m.marks['ing:pop/in.x'], undefined, 'children of a new component carry no mark');
  assert.equal(m.marks['ing:auth-svc/in.t'].mark, 'new');
  assert.equal(m.marks['svc:auth-svc'].mark, 'changed');
  assert.match(m.marks['svc:auth-svc'].what, /\+1 endpoint/);
  assert.equal(m.marks['egr:auth-svc/out.u'].mark, 'new');
  assert.match(m.marks['svc:auth-svc'].what, /call: users-svc/, 'the callee is named');
  assert.equal(m.marks['dto:users-svc/response/-/in.getUser#cert'].mark, 'new');
  assert.equal(m.marks['dto:users-svc/response/-/in.getUser#tier'].was, 'was string');
  assert.equal(m.marks['ing:users-svc/in.getUser'].mark, 'changed');
  assert.match(m.marks['svc:users-svc'].what, /message response of in.getUser: 1 new field, 1 changed field/);
  assert.equal((await app.call('GET', `${M}?draft=nope`)).status, 404);
});

test('D11 counts equal the per-anchor marks (one function computes both)', async () => {
  const m = await marks('?draft=marks');
  const n = { components: 0, endpoints: 0, calls: 0, channels: 0, messages: 0, fields: 0 } as Record<string, number>;
  for (const a of Object.keys(m.marks)) {
    const p = parseAnchor(a)!;
    const cat = p.field !== undefined ? 'fields' : ({ svc: 'components', ing: 'endpoints', egr: 'calls', ch: 'channels', dto: 'messages', evt: 'messages' } as any)[p.kind];
    if (cat) n[cat]++;
  }
  for (const [k, v] of Object.entries(n)) assert.equal(m.counts[k].new + m.counts[k].changed + m.counts[k].removed, v, k);
  assert.ok(m.counts.components.new === 1 && m.counts.components.changed === 2);
});

test('D9 against=source: a prod delta shows as drift in source mode only; a vanished component is new "no longer in prod"', async () => {
  const before = await marks('?against=source');
  assert.deepEqual(before.marks, {});
  const first = app.ctx.db.prepare("SELECT version FROM snapshots WHERE env = 'prod' AND service = 'users-svc'").get() as { version: number };
  const users = readSample('users-svc.json');
  const delta = { schemaVersion: '1.0', kind: 'delta', env: 'prod', service: { name: 'users-svc', kind: 'service' }, version: first.version + 1, baseVersion: first.version, harvestedAt: '2026-10-21T00:00:00Z',
    upsert: { egress: [{ id: 'out.newcall', transport: 'http', mode: 'sync', bindKey: 'http:GET auth-svc/verify' }] } };
  assert.equal((await app.call('POST', '/api/ingest', delta)).status, 201);
  void users;
  const drift = await marks('?against=source');
  assert.ok(drift.marks['egr:users-svc/out.newcall'] || drift.marks['svc:users-svc'], JSON.stringify(drift.marks));
  assert.equal(drift.marks['egr:users-svc/out.newcall']?.mark, 'removed', 'the source has a call the design does not');
  assert.deepEqual((await marks('?against=baseline')).marks, {}, 'baseline mode does not move with the source');
  deleteServiceIn(app.ctx.db, 'prod', 'auth-svc');
  app.ctx.changed('prod');
  const gone = await marks('?against=source');
  assert.deepEqual([gone.marks['svc:auth-svc'].mark, gone.marks['svc:auth-svc'].what], ['new', 'no longer in prod']);
  assert.equal((await marks('?against=baseline')).marks['svc:auth-svc'], undefined);
  app.ctx.db.prepare("DELETE FROM envs WHERE name = 'full-copy'").run();
});

test('the memo is dropped on a write to the environment and on a write to its source', async () => {
  const a = marksFor(app.ctx, 'hld', { against: 'source' }), b = marksFor(app.ctx, 'hld', { against: 'baseline' });
  assert.equal(marksFor(app.ctx, 'hld', { against: 'source' }), a, 'memoised');
  app.ctx.changed('prod');
  assert.notEqual(marksFor(app.ctx, 'hld', { against: 'source' }), a, 'source write');
  assert.equal(marksFor(app.ctx, 'hld', { draft: 'marks' }), marksFor(app.ctx, 'hld', { draft: 'marks' }));
  const d = marksFor(app.ctx, 'hld', { draft: 'marks' });
  app.ctx.changedDraft('hld', 'marks');
  assert.notEqual(marksFor(app.ctx, 'hld', { draft: 'marks' }), d, 'draft write');
  const c = marksFor(app.ctx, 'hld');
  app.ctx.changed('hld');
  assert.notEqual(marksFor(app.ctx, 'hld'), c, 'environment write');
  void b;
});

test('MCP get_marks: fields are off by default, prefix filters, draft lays the draft over', async () => {
  const plain = (await app.mcp('get_marks', { env: 'hld', draft: 'marks' })).json;
  assert.equal(Object.keys(plain.marks).some((k) => k.includes('#')), false);
  const full = (await app.mcp('get_marks', { env: 'hld', draft: 'marks', fields: true })).json;
  assert.ok(Object.keys(full.marks).some((k) => k.includes('#')));
  const only = (await app.mcp('get_marks', { env: 'hld', draft: 'marks', prefix: 'svc:' })).json;
  assert.ok(Object.keys(only.marks).length >= 2 && Object.keys(only.marks).every((k) => k.startsWith('svc:')));
  assert.equal(only.counts.components.new, 1);
});

test('D13 a Full copy of scale-test: draft marks in under 200 ms once the graph is warm', async () => {
  const big = await startApp();
  try {
    assert.equal((await big.call('POST', '/api/ingest', { manifests: [...generateMock({ services: 100, seed: 7, env: 'scale-test' })] })).status, 201);
    assert.equal((await big.call('POST', '/api/envs', { name: 'big', source: 'scale-test', mode: 'full' })).status, 201);
    const some = (await big.call('GET', '/api/envs/big/services')).body.slice(0, 3).map((s: any) => s.name);
    await big.call('POST', '/api/envs/big/drafts', { name: 'p', slug: 'p' });
    const ops = (i: number) => ({ ops: [up(`egr:${some[0]}/out.p${i}`, { id: `out.p${i}`, transport: 'http', bindKey: `http:GET ${some[1]}/p${i}` })] });
    assert.equal((await big.call('POST', '/api/envs/big/drafts/p/ops', ops(1))).status, 201);
    const cold = await big.call('GET', '/api/envs/big/marks?draft=p');
    assert.equal(cold.body.marks[`egr:${some[0]}/out.p1`].mark, 'new');
    // each edit drops the draft's memo and graph, so every round is a real recomputation; the best of three keeps a busy machine from failing the budget
    const times: number[] = [];
    for (let i = 2; i <= 4; i++) {
      assert.equal((await big.call('POST', '/api/envs/big/drafts/p/ops', ops(i))).status, 201);
      const t = performance.now();
      const warm = await big.call('GET', '/api/envs/big/marks?draft=p');
      times.push(performance.now() - t);
      assert.equal(warm.body.counts.calls.new, i);
    }
    assert.ok(Math.min(...times) < 200, times.map((x) => `${x.toFixed(0)} ms`).join(', '));
    assert.deepEqual((await big.call('GET', '/api/envs/big/marks')).body.marks, {}, 'a fresh Full copy of 100 services has no marks');
  } finally { await big.close(); }
});
void sampleManifests;
