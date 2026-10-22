// Perf batch 3: F11 (mentions memo), F12 (events), F6 and the payload work are in their own sections below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, sampleManifests } from './helpers.ts';
import { listNotesMentions } from '../server/store/notes-mentions.ts';
import { listAboutMentions } from '../server/store/mentions-about.ts';
import { sinceWrite } from '../server/store/write-memo.ts';
import { tx } from '../server/db/connection.ts';

test('F11: the mentions scans run once between writes and see every write after it', async () => {
  const app = await startApp();
  try {
    assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
    const db = app.ctx.db as any;
    const dana = (await app.call('POST', '/api/users', { name: 'Dana Levi' })).body;
    const note = (body: string) => app.call('PUT', '/api/envs/prod/notes', { anchor: 'flow:api-gateway/in.createOrder', author: 'Ana', body });
    assert.equal((await note(`<p>ask @[${dana.id}] today</p>`)).status, 200);
    const a = listNotesMentions(db, dana.id);
    assert.deepEqual(a.map((m) => [m.env, m.anchor, m.text]), [['prod', 'flow:api-gateway/in.createOrder', 'ask @Dana Levi today']]);
    assert.equal(listNotesMentions(db, dana.id), a, 'a hit between writes');
    assert.deepEqual(listNotesMentions(db, dana.id, 'prod'), a);
    assert.deepEqual(listNotesMentions(db, dana.id, 'other'), []);
    assert.equal((await note('<p>nobody now</p>')).status, 200);
    assert.deepEqual(listNotesMentions(db, dana.id), [], 'the next note version replaces the mention');
    // an about
    const m = structuredClone(sampleManifests().find((x: any) => x.service.name === 'orders-svc'));
    m.version += 1; m.service.about = `Ask @[${dana.id}]`;
    const b0 = listAboutMentions(db, dana.id);
    assert.deepEqual(b0, []);
    assert.equal((await app.call('POST', '/api/ingest', m)).status, 201);
    assert.deepEqual(listAboutMentions(db, dana.id).map((x) => [x.kind, x.id, x.text]), [['component', 'orders-svc', 'Ask @Dana Levi']]);
    assert.equal((await app.call('PATCH', `/api/users/${dana.id}`, { name: 'Dana Cohen' })).status, 200);
    assert.equal(listAboutMentions(db, dana.id)[0].text, 'Ask @Dana Cohen', 'a rename is a write');
  } finally { await app.close(); }
});

test('F11: sinceWrite never keeps a value computed in a transaction that rolls back', async () => {
  const app = await startApp();
  try {
    const db = app.ctx.db as any;
    let n = 0;
    const get = () => sinceWrite(db, 'k', () => ++n);
    assert.equal(get(), 1); assert.equal(get(), 1);
    db.exec("INSERT INTO envs (name, kind, created_at, color) VALUES ('zz', 'sealed', 'x', 1)");
    assert.equal(get(), 2);
    assert.throws(() => tx(db, () => { db.exec("DELETE FROM envs WHERE name = 'zz'"); assert.equal(get(), 3); throw new Error('rb'); }), /rb/);
    assert.equal(get(), 4, 'computed again: the value of the rolled-back transaction was not kept');
    assert.equal(get(), 4);
  } finally { await app.close(); }
});
