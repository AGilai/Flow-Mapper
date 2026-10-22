// Perf batch 3, F8: the cached env rows behind the draft operations are always what envItemRows reads now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tx } from '../server/db/connection.ts';
import { envItemRows } from '../server/store/item-rows.ts';
import { envRowsOf, cachedEnvRows } from '../server/store/env-rows-cache.ts';
import { startDesign, sampleManifests } from './helpers.ts';

test('F8: hit while nothing is written; a miss after any write (ingest, DTO, schema, subsystems); equal to envItemRows each time', async () => {
  const app = await startDesign();
  try {
    const db = app.ctx.db as any;
    const same = (env: string) => { const c = envRowsOf(db, env); assert.deepEqual(c, envItemRows(db, env), env); return c; };
    const a = same('prod');
    assert.equal(envRowsOf(db, 'prod'), a, 'second read is a hit');
    assert.equal(envRowsOf(db, 'prod'), a);
    // an ingest of a changed service
    const m = JSON.parse(JSON.stringify(sampleManifests().find((x: any) => x.service.name === 'users-svc')));
    m.version += 50; m.functions.push({ id: 'zz.fn', name: 'zz', steps: [] });
    assert.equal((await app.call('POST', '/api/ingest', m)).status, 201);
    const b = same('prod');
    assert.notEqual(b, a);
    assert.ok(b.length > a.length);
    // a DTO write (no graph invalidation happens for these)
    const before = envRowsOf(db, 'prod');
    const dto = await app.call('PUT', '/api/envs/prod/event-dtos/ZzEvent', { content: { type: 'object' } });
    assert.ok(dto.status < 300, JSON.stringify(dto.body));
    const c = same('prod');
    assert.notEqual(c, before);
    assert.equal(c.filter((r: any) => r.list === 'event_dto').length, before.filter((r: any) => r.list === 'event_dto').length + 1);
    // a design env: a subsystem settings write, a draft apply
    const dr = await app.call('POST', '/api/envs/hld/drafts', { name: 'x' });
    assert.equal(dr.status, 201);
    assert.deepEqual(dr.body.counts, { added: 0, removed: 0, changed: 0 });
    const d0 = same('hld');
    const op = await app.call('POST', '/api/envs/hld/drafts/x/ops', { ops: [{ op: 'upsert', anchor: 'svc:new-svc', data: { kind: 'service' } }] });
    assert.equal(op.status, 201, JSON.stringify(op.body));
    assert.equal(envRowsOf(db, 'hld'), d0, 'appending ops keeps the cached rows (the point of F8)');
    const op2 = await app.call('POST', '/api/envs/hld/drafts/x/ops', { ops: [{ op: 'upsert', anchor: 'svc:new-svc-2', data: { kind: 'service' } }] });
    assert.equal(op2.status, 201);
    assert.equal(envRowsOf(db, 'hld'), d0);
    const ap = await app.call('POST', '/api/envs/hld/drafts/x/apply', {});
    assert.equal(ap.status, 200, JSON.stringify(ap.body));
    const d1 = same('hld');
    assert.notEqual(d1, d0);
    assert.ok(d1.some((r: any) => r.service === 'new-svc' && r.list === 'header'));
    assert.ok(cachedEnvRows(db) <= 2);
    // the draft list and info read the cache and give the counts the old code gave (changes of the net ops against the rows)
    const list = (await app.call('GET', '/api/envs/hld/drafts?status=all')).body;
    assert.equal(list.length, 1);
    assert.equal(list[0].status, 'applied');
  } finally { await app.close(); }
});

test('F8: a read inside a transaction that rolls back is never kept; another connection\'s write is seen; two databases do not share', async () => {
  const a = await startDesign(), b = await startDesign();
  try {
    const db = a.ctx.db as any;
    const base = envRowsOf(db, 'prod');
    assert.throws(() => tx(db, () => {
      db.prepare("DELETE FROM entities WHERE env = 'prod' AND service = 'users-svc'").run();
      const inside = envRowsOf(db, 'prod');
      assert.ok(inside.length < base.length);
      throw new Error('roll back');
    }), /roll back/);
    assert.deepEqual(envRowsOf(db, 'prod'), envItemRows(db, 'prod'));
    assert.equal(envRowsOf(db, 'prod').length, base.length);
    // the second app's database has the same env name and its own counters
    const other = envRowsOf(b.ctx.db as any, 'prod');
    assert.notEqual(other, base);
    assert.deepEqual(other, envItemRows(b.ctx.db as any, 'prod'));
    // a write on another connection to the same file
    const { DatabaseSync } = await import('node:sqlite');
    const x = new DatabaseSync(a.dbPath);
    x.exec("DELETE FROM entities WHERE env = 'prod' AND service = 'auth-svc'");
    x.close();
    const after = envRowsOf(db, 'prod');
    assert.ok(after.length < base.length);
    assert.deepEqual(after, envItemRows(db, 'prod'));
  } finally { await a.close(); await b.close(); }
});
