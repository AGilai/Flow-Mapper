// Perf batch 3, F12: batch ingest events in one transaction, and the producer read without serialising the manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { producerOf } from '../server/events/emitters.ts';
import { Bus, type Draft } from '../server/events/bus.ts';
import { generateMock } from '../scripts/mock/generate.ts';
import { startApp, sampleManifests } from './helpers.ts';

const oldProducer = (m: unknown) => (JSON.stringify(m).match(/"producer":"([^"]*)"/) ?? [])[1] ?? null;

test('F12: producerOf is the old regex over JSON.stringify, on samples, mock manifests and odd shapes', () => {
  const all: unknown[] = [...sampleManifests(), ...generateMock({ services: 40, seed: 3, env: 'x' })];
  let found = 0;
  for (const m of all) { assert.equal(producerOf(m), oldProducer(m)); if (oldProducer(m) !== null) found++; }
  assert.ok(found > 0, 'the fixtures carry a producer somewhere');
  const odd: unknown[] = [
    {}, { a: 1 }, { producer: 'top' }, { a: { producer: 'nested' }, producer: 'later' }, { producer: 5, b: [{ producer: 'in array' }] },
    { producer: 'with "quote" inside' }, { producer: '' }, { producer: 'line\nbreak \\ back' }, { x: '"producer":"inside a string"' }, { list: [[], [{ n: null }], { provenance: { producer: 'p' } }] },
    { producer: null, provenance: { producer: 'second' } }, { a: undefined, producer: 'after undefined' }, 'text', null, [{ producer: 'root array' }], { 'é': 1, producer: 'ünï' },
  ];
  for (const m of odd) assert.equal(producerOf(m), oldProducer(m), JSON.stringify(m));
});

const draft = (i: number): Draft => ({ type: 'manifest.ingested', env: i % 2 ? 'prod' : undefined, summary: `s${i}`, data: { i } });

test('F12: emitMany writes the same rows, ids, ring and subscriber calls as emitting one by one, and prunes the same', async () => {
  const one = await startApp(), many = await startApp();
  try {
    for (const app of [one, many]) { // some history: rows over a week old (pruned by the next emit) and a recent one
      const old = new Date(Date.now() - 9 * 86400000).toISOString();
      for (let i = 0; i < 3; i++) (app.ctx.db as any).prepare("INSERT INTO events (type, at, summary, data) VALUES ('old', ?, 'o', '{}')").run(old);
      (app.ctx.db as any).prepare("INSERT INTO events (type, at, summary, data) VALUES ('recent', ?, 'r', '{}')").run(new Date().toISOString());
    }
    const a = new Bus(one.ctx.db as any), b = new Bus(many.ctx.db as any);
    const seenA: number[] = [], seenB: number[] = [];
    a.subscribe((e) => seenA.push(e.id)); b.subscribe((e) => seenB.push(e.id));
    const ds = [0, 1, 2, 3, 4, 5, 6].map(draft);
    const ra = ds.map((d) => a.emit(d)), rb = b.emitMany(ds);
    const norm = (e: any) => ({ ...e, at: 0 });
    assert.deepEqual(rb.map(norm), ra.map(norm));
    assert.deepEqual(seenB, seenA);
    const rows = (app: any) => app.ctx.db.prepare('SELECT id, type, env, bug_id, reporter, summary, data FROM events ORDER BY id').all();
    assert.deepEqual(rows(many), rows(one));
    assert.ok(!rows(many).some((r: any) => r.type === 'old'), 'rows past 7 days are pruned once, at the end');
    assert.deepEqual(b.latest(100).map(norm), a.latest(100).map(norm));
    assert.equal(b.lastId(), a.lastId());
  } finally { await one.close(); await many.close(); }
});

test('F12: a subscriber that throws does not stop the batch; one failing insert falls back to one by one', async () => {
  const app = await startApp();
  try {
    const bus = new Bus(app.ctx.db as any), got: number[] = [];
    bus.subscribe(() => { throw new Error('boom'); });
    bus.subscribe((e) => got.push(e.id));
    const r = bus.emitMany([draft(1), draft(2), draft(3)]);
    assert.equal(r.length, 3);
    assert.deepEqual(got, r.map((e) => e!.id));
    // a draft whose data cannot be serialised fails the transaction; the others are still recorded one by one
    const circ: any = {}; circ.self = circ;
    const out = bus.emitMany([draft(4), { type: 'bad', summary: 'x', data: circ }, draft(5)]);
    assert.deepEqual(out.map((e) => e && e.summary), ['s4', null, 's5']);
    assert.equal((app.ctx.db as any).prepare("SELECT COUNT(*) AS n FROM events WHERE summary IN ('s4', 's5')").get().n, 2);
  } finally { await app.close(); }
});

test('F12: a batch ingest over HTTP records one manifest.ingested event per manifest, in order, with the producer', async () => {
  const app = await startApp();
  try {
    const ms = sampleManifests().slice(0, 4);
    assert.equal((await app.call('POST', '/api/ingest', { manifests: ms })).status, 201);
    const ev = (app.ctx.db as any).prepare("SELECT summary, data FROM events WHERE type = 'manifest.ingested' ORDER BY id").all();
    assert.equal(ev.length, 4);
    assert.deepEqual(ev.map((e: any) => JSON.parse(e.data).service), ms.map((m: any) => m.service.name));
    ev.forEach((e: any, i: number) => assert.equal(JSON.parse(e.data).producer, oldProducer(ms[i])));
  } finally { await app.close(); }
});
