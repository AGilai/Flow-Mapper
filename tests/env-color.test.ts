// Environment colours (0.34.x step 1): the pure palette rules, migration 018's backfill, creation, PUT /api/envs/:env/color, meta and MCP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db/connection.ts';
import { ENV_COLORS, nextFreeSlot, rankSlot, envSlot, envRanks, isEnvSlot } from '../core/env-colors.ts';
import { startApp, sampleManifests } from './helpers.ts';

test('palette: ten named slots; the lowest free slot is taken; all taken repeats the least used', () => {
  assert.equal(ENV_COLORS.length, 10);
  assert.equal(nextFreeSlot([]), 1);
  assert.equal(nextFreeSlot([1, 2, 4]), 3);
  assert.equal(nextFreeSlot([null, undefined, 1]), 2, 'automatic (null) holds no slot');
  assert.equal(nextFreeSlot([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 1);
  assert.equal(nextFreeSlot([1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 2, 'slot 1 is held twice: the lowest of the once-held ones');
  assert.equal(rankSlot(0), 1); assert.equal(rankSlot(9), 10); assert.equal(rankSlot(10), 1);
  assert.equal(envSlot(4, 0), 4); assert.equal(envSlot(null, 2), 3); assert.equal(envSlot(99, 2), 3, 'an out-of-range stored value falls back');
  assert.deepEqual(envRanks([{ name: 'b', createdAt: '2' }, { name: 'a', createdAt: '2' }, { name: 'z', createdAt: '1' }]), { z: 0, a: 1, b: 2 });
  assert.ok(isEnvSlot(10) && !isEnvSlot(0) && !isEnvSlot(1.5) && !isEnvSlot('3'));
});

const MIG = join(import.meta.dirname, '../server/db/migrations');
const ALL = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const quiet = <T>(f: () => T): T => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };

test('018 gives every existing env a stored slot in creation order and keeps envs.colors', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'flow-mapper-mig18-')), 'old.db');
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)');
  for (const f of ALL.filter((f) => f < '018')) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    raw.exec(sql);
    raw.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(f, 'then', createHash('sha256').update(sql).digest('hex'));
  }
  raw.exec('DELETE FROM envs');
  const ins = raw.prepare("INSERT INTO envs (name, kind, created_at, colors) VALUES (?, 'sealed', ?, ?)");
  ins.run('prod', '2026-01-01T00:00:00Z', '{"svc":3}');
  for (let i = 1; i <= 11; i++) ins.run(`e${String(i).padStart(2, '0')}`, `2026-02-${String(i).padStart(2, '0')}T00:00:00Z`, '{}');
  ins.run('same-time-b', '2026-03-01T00:00:00Z', '{}'); ins.run('same-time-a', '2026-03-01T00:00:00Z', '{}');
  raw.close();
  const db = quiet(() => openDb(path));
  const rows = db.prepare('SELECT name, color, colors FROM envs ORDER BY created_at, name').all() as any[];
  assert.deepEqual(rows.map((r) => r.color), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2, 3, 4], 'creation order, name on a tie, wraps at 10');
  assert.equal(rows[0].name, 'prod'); assert.equal(rows[0].colors, '{"svc":3}');
  assert.equal(rows[12].name, 'same-time-a');
  db.close();
});

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
});
after(() => app.close());

const meta = async (name: string) => (await app.call('GET', `/api/envs/${name}/meta`)).body;

test('a new env takes the lowest free slot; a copy never inherits its source colour', async () => {
  const prod = await meta('prod');
  assert.equal(prod.color, 1); assert.equal(prod.colorAuto, false);
  const a = (await app.call('POST', '/api/envs', { name: 'dsn-a', source: 'prod', mode: 'components', services: [{ name: 'users-svc' }] })).body;
  const b = (await app.call('POST', '/api/envs', { name: 'dsn-b', source: 'dsn-a', mode: 'blank' })).body;
  assert.equal(a.color, 2); assert.equal(b.color, 3);
  assert.notEqual(a.color, prod.color, 'a copy differs from its source');
  assert.notEqual(b.color, a.color);
  // an ingest into a new name creates it sealed, with the next slot
  const m = JSON.parse(JSON.stringify(sampleManifests()[0])); m.env = 'staging';
  assert.equal((await app.call('POST', '/api/ingest', { manifests: [m] })).status, 201);
  assert.equal((await meta('staging')).color, 4);
  // deleting frees the slot for the next one
  assert.equal((await app.call('DELETE', '/api/envs/dsn-a')).status, 200);
  assert.equal((await app.call('POST', '/api/envs', { name: 'dsn-c', mode: 'blank' })).body.color, 2);
});

test('PUT /api/envs/:env/color validates, stores, resets to automatic, and lists in meta', async () => {
  const put = (env: string, body: unknown) => app.call('PUT', `/api/envs/${env}/color`, body);
  const ok = await put('prod', { color: 7 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body, { env: 'prod', color: 7, colorAuto: false, colorName: 'Steel' });
  assert.equal((await meta('prod')).color, 7);
  assert.equal((await app.call('GET', '/api/envs/meta')).body.find((e: any) => e.name === 'prod').color, 7);
  for (const bad of [{ color: 0 }, { color: 11 }, { color: 2.5 }, { color: '3' }, {}, { color: true }]) {
    const r = await put('prod', bad);
    assert.equal(r.status, 422, JSON.stringify(bad)); assert.equal(r.body.error.details.field, 'color');
  }
  assert.equal((await meta('prod')).color, 7, 'a refused value changes nothing');
  assert.equal((await put('no-such', { color: 2 })).status, 404);
  const auto = await put('prod', { color: null });
  assert.equal(auto.status, 200); assert.equal(auto.body.colorAuto, true);
  const m = await meta('prod');
  assert.equal(m.colorAuto, true); assert.equal(m.color, 1, 'automatic: the oldest env reads slot 1');
  assert.equal((await put('prod', { color: 1 })).body.colorAuto, false);
  assert.ok((app.ctx.db.prepare("SELECT count(*) AS n FROM events WHERE type = 'env.updated'").get() as { n: number }).n >= 1, 'open UIs hear about it');
});

test('sealed and design envs both take a colour (it is an annotation)', async () => {
  assert.equal((await app.call('PUT', '/api/envs/dsn-b/color', { color: 9 })).status, 200);
  assert.equal((await meta('dsn-b')).color, 9);
});

test('MCP: list_envs returns the colour and its name; set_env_color writes it', async () => {
  const mcp = async (tool: string, args: any) => {
    const x = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } });
    const { isError, content } = x.body.result;
    return { isError: !!isError, text: content[0].text as string };
  };
  const set = await mcp('set_env_color', { env: 'prod', color: 5 });
  assert.equal(set.isError, false, set.text);
  assert.equal(JSON.parse(set.text).colorName, 'Green');
  const list = JSON.parse((await mcp('list_envs', {})).text);
  const prod = list.find((e: any) => e.name === 'prod');
  assert.equal(prod.color, 5); assert.equal(prod.colorName, 'Green'); assert.equal(prod.colorAuto, false);
  assert.equal((await mcp('set_env_color', { env: 'prod', color: 12 })).isError, true);
  assert.equal((await mcp('set_env_color', { env: 'nope', color: 1 })).isError, true);
  assert.equal(JSON.parse((await mcp('set_env_color', { env: 'prod', color: null })).text).colorAuto, true);
});
