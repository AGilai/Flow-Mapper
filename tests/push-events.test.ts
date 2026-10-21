// Push event stream: ordering, filters, resume, persistence, cleanup, heartbeat, exactly-once emission.

import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSample, startApp } from './helpers.ts';
import { busFor } from '../server/events/bus.ts';

/** Open an SSE stream; collects frames and the raw text (comments included). */
function watch(base: string, path: string, headers: Record<string, string> = {}) {
  const events: any[] = [], ids: string[] = [], names: string[] = [];
  let raw = '', status = 0;
  const waiters: (() => void)[] = [];
  const req = get(base + path, { headers: { accept: 'text/event-stream', ...headers } });
  const ready = new Promise<void>((resolve) => req.on('response', (res) => {
    status = res.statusCode ?? 0;
    res.setEncoding('utf8');
    res.on('data', (c: string) => {
      raw += c;
      for (const frame of raw.split('\n\n').slice(0, -1)) {
        if (!frame.includes('data: ')) continue;
        const line = (p: string) => frame.split('\n').find((l) => l.startsWith(p))!.slice(p.length);
        const e = JSON.parse(line('data: '));
        if (!events.some((x) => x.id === e.id)) { events.push(e); ids.push(line('id: ')); names.push(line('event: ')); }
      }
      waiters.splice(0).forEach((w) => w());
    });
    resolve();
  }));
  req.on('error', () => {});
  const until = async (pred: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error(`timeout; got ${JSON.stringify(events.map((e) => e.type))}`);
      await new Promise<void>((r) => { waiters.push(r); setTimeout(r, 25); });
    }
  };
  return { events, ids, names, ready, until, raw: () => raw, status: () => status, close: () => req.destroy() };
}
const bug = { title: 'harvest fails', reporter: 'loader', severity: 'S2' };

test('each event kind is emitted exactly once per action, in order, with the payload shape', async () => {
  const app = await startApp();
  try {
    const first = (await app.call('GET', '/api/events/recent')).body.events;
    assert.deepEqual(first.map((e: any) => e.type), ['version.deployed']);
    const b = (await app.call('POST', '/api/bugs', bug)).body;
    await app.call('POST', `/api/bugs/${b.id}/comments`, { author: 'lead', body: 'looking' });
    await app.call('PATCH', `/api/bugs/${b.id}`, { status: 'triaged' });
    await app.call('PATCH', `/api/bugs/${b.id}`, { title: 'renamed' });
    await app.call('PATCH', `/api/bugs/${b.id}`, { status: 'in_progress' });
    await app.call('PATCH', `/api/bugs/${b.id}`, { status: 'fixed', fixedInVersion: '9.9.9', resolution: { type: 'code', ref: 'abc' }, assignee: 'lead' });
    await app.call('POST', '/api/ingest', readSample('orders-svc.json'));
    await app.call('POST', '/api/envs', { name: 'd1', source: 'prod', mode: 'blank' });
    await app.call('DELETE', '/api/envs/d1');
    const ev = (await app.call('GET', '/api/events/recent?types=bug.*,manifest.*,env.*')).body.events;
    assert.deepEqual(ev.map((e: any) => e.type), ['bug.created', 'bug.commented', 'bug.status', 'bug.updated', 'bug.status', 'bug.status', 'bug.updated', 'manifest.ingested', 'env.created', 'env.deleted']);
    assert.ok(ev.every((e: any, i: number) => i === 0 || e.id > ev[i - 1].id));
    assert.deepEqual({ bugId: ev[0].bugId, reporter: ev[0].reporter, env: ev[0].env }, { bugId: b.id, reporter: 'loader', env: 'default' });
    assert.equal(ev[1].reporter, 'loader'); assert.equal(ev[1].data.author, 'lead');
    assert.deepEqual([ev[2].data.from, ev[2].data.to], ['open', 'triaged']);
    assert.deepEqual(ev[3].data.fields, ['title']);
    assert.equal(ev[5].data.fixedInVersion, '9.9.9'); assert.equal(ev[5].data.resolution.type, 'code');
    assert.deepEqual(ev[6].data.fields, ['assignee']); // fixedInVersion/resolution travel with the status event
    assert.equal(ev[7].env, 'prod'); assert.equal(ev[7].data.service, 'orders-svc'); assert.equal(ev[7].data.kind, 'full');
    assert.ok(ev[7].summary && ev[7].at);
  } finally { await app.close(); }
});

test('nothing is emitted for failed writes, no-op patches or dry runs', async () => {
  const app = await startApp();
  try {
    const b = (await app.call('POST', '/api/bugs', bug)).body;
    const last = async () => (await app.call('GET', '/api/events/recent')).body.lastId;
    const before = await last();
    assert.ok((await app.call('POST', '/api/bugs', { title: '' })).status >= 400);
    assert.ok((await app.call('PATCH', `/api/bugs/${b.id}`, { status: 'verified' })).status >= 400);
    assert.ok((await app.call('PATCH', `/api/bugs/${b.id}`, { status: 'fixed' })).status >= 400);
    assert.ok((await app.call('POST', `/api/bugs/${b.id}/comments`, { body: ' ' })).status >= 400);
    await app.call('PATCH', `/api/bugs/${b.id}`, {});
    assert.ok((await app.call('POST', '/api/ingest', { service: { name: 'x' } })).status >= 400);
    const m = readSample('orders-svc.json');
    assert.equal((await app.call('POST', '/api/ingest?dryRun=1', m)).status, 200);
    assert.ok((await app.call('POST', '/api/ingest', { manifests: [m, { ...m, version: 0 }] })).status >= 400); // batch rolls back
    assert.ok((await app.call('POST', '/api/envs', { name: 'bad', source: 'nope', mode: 'blank' })).status >= 400);
    assert.equal(await last(), before);
  } finally { await app.close(); }
});

test('SSE: live delivery with id/event/data lines, type and reporter filters', async () => {
  const app = await startApp();
  const all = watch(app.base, '/api/events'), mine = watch(app.base, '/api/events?types=bug.*,version.deployed&reporter=loader');
  try {
    await all.ready; await mine.ready;
    assert.equal(all.status(), 200);
    const a = (await app.call('POST', '/api/bugs', { title: 'a', reporter: 'loader' })).body;
    await app.call('POST', '/api/bugs', { title: 'b', reporter: 'someone' });
    await app.call('POST', '/api/ingest', readSample('orders-svc.json'));
    await all.until(() => all.events.length === 3);
    await mine.until(() => mine.events.length === 1);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(all.names, ['bug.created', 'bug.created', 'manifest.ingested']);
    assert.deepEqual(all.ids, all.events.map((e) => String(e.id)));
    assert.equal(mine.events.length, 1);
    assert.equal(mine.events[0].bugId, a.id);
  } finally { all.close(); mine.close(); await app.close(); }
});

test('resume with Last-Event-ID or ?since replays what was missed, then continues live', async () => {
  const app = await startApp();
  try {
    await app.call('POST', '/api/bugs', { title: 'one' });
    const mid = (await app.call('GET', '/api/events/recent')).body.lastId;
    await app.call('POST', '/api/bugs', { title: 'two' });
    await app.call('POST', '/api/bugs', { title: 'three' });
    const h = watch(app.base, '/api/events?types=bug.*', { 'last-event-id': String(mid) });
    const q = watch(app.base, `/api/events?types=bug.*&since=${mid}`);
    await h.until(() => h.events.length === 2); await q.until(() => q.events.length === 2);
    assert.deepEqual(h.events.map((e) => e.data.title), ['two', 'three']);
    await app.call('POST', '/api/bugs', { title: 'four' });
    await h.until(() => h.events.length === 3);
    assert.deepEqual(h.events.map((e) => e.data.title), ['two', 'three', 'four']);
    const rec = (await app.call('GET', `/api/events/recent?types=bug.*&since=${mid}`)).body;
    assert.deepEqual(rec.events.map((e: any) => e.data.title), ['two', 'three', 'four']);
    assert.equal((await app.call('GET', '/api/events/recent?since=abc')).status, 400);
    h.close(); q.close();
  } finally { await app.close(); }
});

test('events are persisted: replay after a restart, ids continue, version.deployed only on a new version', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-mapper-ev-'));
  const a = await startApp({ dir });
  await a.call('POST', '/api/bugs', { title: 'before restart' });
  const lastId = (await a.call('GET', '/api/events/recent')).body.lastId;
  await a.close();
  const b = await startApp({ dir });
  try {
    const rec = (await b.call('GET', '/api/events/recent')).body;
    assert.deepEqual(rec.events.map((e: any) => e.type), ['version.deployed', 'bug.created']);
    assert.equal(rec.lastId, lastId);
    const w = watch(b.base, `/api/events?since=${rec.events[0].id}`);
    await w.until(() => w.events.length === 1);
    assert.equal(w.events[0].data.title, 'before restart');
    await b.call('POST', '/api/bugs', { title: 'after' });
    await w.until(() => w.events.length === 2);
    assert.equal(w.events[1].id, lastId + 1);
    w.close();
    busFor(b.ctx.db).setState('app_version', '0.0.1'); // pretend the last run was an older version
  } finally { await b.close(); }
  const c = await startApp({ dir });
  try {
    const dep = (await c.call('GET', '/api/events/recent?types=version.deployed')).body.events;
    assert.equal(dep.length, 2);
    assert.equal(dep[1].data.previous, '0.0.1');
  } finally { await c.close(); }
});

test('a disconnected client is cleaned up; the stream is capped; a heartbeat comment arrives', async () => {
  const app = await startApp({ events: { heartbeatMs: 40, maxClients: 2 } });
  const bus = busFor(app.ctx.db);
  const w1 = watch(app.base, '/api/events'), w2 = watch(app.base, '/api/events');
  try {
    await w1.ready; await w2.ready;
    assert.equal(bus.clients, 2);
    const over = await app.call('GET', '/api/events');
    assert.equal(over.status, 503); assert.equal(over.body.error.code, 'TOO_MANY_CLIENTS');
    const end = Date.now() + 2000;
    while (!w1.raw().includes(': heartbeat') && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    assert.ok(w1.raw().includes(': heartbeat'));
    w1.close();
    const t = Date.now() + 2000;
    while (bus.clients > 1 && Date.now() < t) await new Promise((r) => setTimeout(r, 20));
    assert.equal(bus.clients, 1);
    const w3 = watch(app.base, '/api/events'); await w3.ready; assert.equal(w3.status(), 200); w3.close();
  } finally { w1.close(); w2.close(); await app.close(); }
});

test('the table is pruned on insert (5000 rows) and ids keep increasing', async () => {
  const app = await startApp();
  try {
    const bus = busFor(app.ctx.db);
    for (let i = 0; i < 5010; i++) bus.emit({ type: 'x.y', summary: 's', data: {} });
    const n = (app.ctx.db.prepare('SELECT count(*) AS n FROM events').get() as any).n;
    assert.equal(n, 5000);
    assert.equal(bus.since(0, {}, 10).length, 10);
    assert.ok(bus.lastId() >= 5011);
    assert.equal((await app.call('GET', '/api/events/recent?limit=5')).body.events.length, 5);
  } finally { await app.close(); }
});
