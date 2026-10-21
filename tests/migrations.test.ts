// Incremental migrations: an old database is upgraded in place (data kept, backup written), an
// edited applied migration is refused, a fresh database gets everything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db/connection.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'flow-mapper-mig-'));
/** Every shipped migration file, so a new NNN_*.sql does not need this test edited. */
const ALL_MIGRATIONS = readdirSync(join(import.meta.dirname, '../server/db/migrations')).filter((f) => f.endsWith('.sql')).sort();
const INIT = readFileSync(join(import.meta.dirname, '../server/db/migrations/001_init.sql'), 'utf8');
const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;

/** A database as it was before 002: only 001 applied, with some rows in it. */
function oldDb(path: string) {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON');
  raw.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)');
  raw.exec(INIT);
  raw.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run('001_init.sql', 'then', createHash('sha256').update(INIT).digest('hex'));
  raw.exec(`
    INSERT INTO snapshots (env, service, version, harvested_at, updated_at) VALUES ('prod', 'svc', 1, 't', 't');
    INSERT INTO endpoint_dtos (env, service, ingress, role, content, updated_at) VALUES ('prod', 'svc', 'in.a', 'request', '{"a":1}', 't');
    INSERT INTO endpoint_dtos (env, service, ingress, role, content, updated_at) VALUES ('prod', 'svc', 'in.a', 'response', '{"b":2}', 't');
    INSERT INTO event_dtos (env, event_type, content, updated_at) VALUES ('prod', 'E', '{"c":3}', 't');
    INSERT INTO bugs (title, priority, app_version, created_at, updated_at) VALUES ('a bug', 'P3', '0.4.5', 't', 't');`);
  raw.close();
}

test('an old database is upgraded in place: data kept, backup written', () => {
  const path = join(dir(), 'old.db');
  oldDb(path);

  const logs: string[] = [];
  const log = console.log; console.log = (m: string) => logs.push(m);
  const db = openDb(path);
  console.log = log;

  const applied = (db.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as { name: string }[]).map((r) => r.name);
  assert.deepEqual(applied, ALL_MIGRATIONS);
  const rows = db.prepare('SELECT role, status, content, meta FROM endpoint_dtos ORDER BY role').all() as any[];
  assert.deepEqual(rows.map((r) => [r.role, r.status, r.content, r.meta]), [['request', '', '{"a":1}', null], ['response', '', '{"b":2}', null]]);
  assert.deepEqual({ ...(db.prepare('SELECT content, meta FROM event_dtos').get() as any) }, { content: '{"c":3}', meta: null });
  assert.equal(count(db, 'SELECT count(*) AS n FROM bugs'), 1);
  assert.equal(count(db, 'SELECT count(*) AS n FROM snapshots'), 1);
  assert.equal((db.prepare('PRAGMA foreign_keys').get() as any).foreign_keys, 1, 'foreign keys are back on');

  // a response per status now coexists, and the foreign key to snapshots still cascades
  db.prepare("INSERT INTO endpoint_dtos (env, service, ingress, role, status, content, updated_at) VALUES ('prod', 'svc', 'in.a', 'response', '404', '{}', 't')").run();
  assert.throws(() => db.prepare("INSERT INTO endpoint_dtos (env, service, ingress, role, content, updated_at) VALUES ('prod', 'nope', 'in.a', 'request', '{}', 't')").run());
  db.prepare("DELETE FROM snapshots WHERE env = 'prod' AND service = 'svc'").run();
  assert.equal(count(db, 'SELECT count(*) AS n FROM endpoint_dtos'), 0);
  db.close();

  const bak = `${path}.pre-002.bak`;
  assert.ok(existsSync(bak), 'backup exists');
  assert.equal(logs.length, 1);
  assert.ok(logs[0].includes(bak));
  const b = new DatabaseSync(bak, { readOnly: true });
  assert.equal(count(b, 'SELECT count(*) AS n FROM endpoint_dtos'), 2); // the state before the upgrade
  assert.equal(count(b, "SELECT count(*) AS n FROM pragma_table_info('endpoint_dtos') WHERE name = 'status'"), 0);
  b.close();
});

test('a failed foreign key check rolls a rebuild migration back', () => {
  const path = join(dir(), 'orphans.db');
  oldDb(path);
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = OFF');
  raw.exec("INSERT INTO endpoint_dtos (env, service, ingress, role, content, updated_at) VALUES ('prod', 'ghost', 'in.a', 'request', '{}', 't')");
  raw.close();
  assert.throws(() => openDb(path), /foreign key violation/);
  const check = new DatabaseSync(path);
  assert.equal(count(check, "SELECT count(*) AS n FROM pragma_table_info('endpoint_dtos') WHERE name = 'status'"), 0);
  assert.equal(count(check, 'SELECT count(*) AS n FROM schema_migrations'), 1);
  check.close();
});

test('a fresh database gets every migration and no backup', () => {
  const path = join(dir(), 'fresh.db');
  const logs: string[] = [];
  const log = console.log; console.log = (m: string) => logs.push(m);
  const db = openDb(path);
  console.log = log;
  const names = (db.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as { name: string }[]).map((r) => r.name);
  assert.deepEqual(names, ALL_MIGRATIONS);
  assert.equal(count(db, "SELECT count(*) AS n FROM pragma_table_info('event_dtos') WHERE name = 'meta'"), 1);
  db.close();
  assert.deepEqual(logs, []);
  assert.equal(existsSync(`${path}.pre-001.bak`), false);
  openDb(path).close(); // reopening applies nothing
  assert.equal(existsSync(`${path}.pre-002.bak`), false);
});

test('a changed applied migration is refused', () => {
  const path = join(dir(), 'edited.db');
  openDb(path).close();
  const raw = new DatabaseSync(path);
  raw.prepare("UPDATE schema_migrations SET checksum = 'old' WHERE name = '001_init.sql'").run();
  raw.close();
  assert.throws(() => openDb(path), /add a new NNN_\*\.sql instead/);
});

test('concurrent openers of an old database all succeed and the backup stays pre-migration', async () => {
  const path = join(dir(), 'race.db');
  oldDb(path);
  const code = `import('${join(import.meta.dirname, '../server/db/connection.ts')}').then((m) => { m.openDb(process.argv[1]).close(); })`;
  const run = () => new Promise<{ code: number | null; err: string }>((resolve) => {
    const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', code, path]);
    let err = ''; c.stderr.on('data', (d) => (err += d));
    c.on('close', (n) => resolve({ code: n, err }));
  });
  const results = await Promise.all([run(), run(), run()]);
  for (const r of results) assert.equal(r.code, 0, r.err);
  const db = new DatabaseSync(path);
  assert.equal(count(db, 'SELECT count(*) AS n FROM schema_migrations'), ALL_MIGRATIONS.length);
  assert.equal(count(db, 'SELECT count(*) AS n FROM endpoint_dtos'), 2);
  db.close();
  const b = new DatabaseSync(`${path}.pre-002.bak`, { readOnly: true });
  assert.equal(count(b, "SELECT count(*) AS n FROM pragma_table_info('endpoint_dtos') WHERE name = 'status'"), 0);
  b.close();
});

test('004 adds the Redis key tables to an old database without touching its rows (0.16.0)', () => {
  const path = join(dir(), 'old.db');
  oldDb(path);
  const log = console.log; console.log = () => {};
  const db = openDb(path);
  console.log = log;
  assert.equal(count(db, 'SELECT count(*) AS n FROM resource_keys'), 0);
  assert.equal(count(db, 'SELECT count(*) AS n FROM resource_keys_meta'), 0);
  assert.equal(count(db, 'SELECT count(*) AS n FROM bugs'), 1, 'existing rows are kept');
  db.prepare("INSERT INTO resource_keys (env, instance, db_index, key_template, service, access, commands, ops_per_hour, ttl_seconds) VALUES ('prod', 'redis:c', 0, 'k:{id}', 'svc', 'write', '[\"SET\"]', NULL, 60)").run();
  assert.throws(() => db.prepare("INSERT INTO resource_keys (env, instance, db_index, key_template, service, access, commands, ops_per_hour, ttl_seconds) VALUES ('prod', 'redis:c', 0, 'k2', 'svc', 'rw', '[]', NULL, NULL)").run(), 'access is checked');
  assert.throws(() => db.prepare("INSERT INTO resource_keys (env, instance, db_index, key_template, service, access, commands, ops_per_hour, ttl_seconds) VALUES ('prod', 'redis:c', 0, 'k:{id}', 'svc', 'read', '[]', NULL, NULL)").run(), 'one row per env, instance, db, template and service');
  assert.ok(existsSync(`${path}.pre-002.bak`), 'the backup is taken before the first pending migration');
  db.close();
});

test('005 adds envs and baseline_items; every env found in any table becomes sealed, rows are kept, the backup lacks envs (0.21.0)', () => {
  const path = join(dir(), 'old.db');
  oldDb(path);
  const raw = new DatabaseSync(path);
  raw.exec(`
    INSERT INTO snapshots (env, service, version, harvested_at, updated_at) VALUES ('p81', 'other', 3, 't', '2026-01-02T00:00:00Z');
    INSERT INTO bugs (title, priority, app_version, env, created_at, updated_at) VALUES ('b2', 'P3', '0.4.5', 'only-in-bugs', 't', 't');
    INSERT INTO changelog (env, service, kind, at, changes) VALUES ('only-in-log', 's', 'crud', 't', '{}');
    INSERT INTO store_schemas (env, store_key, source, content, updated_at) VALUES ('only-in-schemas', 'k', 'code', '{}', 't');`);
  raw.close();
  const log = console.log; console.log = () => {};
  const db = openDb(path);
  console.log = log;
  const envs = db.prepare('SELECT name, kind, source, copied_at, levels, groups, created_by FROM envs ORDER BY name').all() as any[];
  assert.deepEqual(envs.map((e) => [e.name, e.kind]), [['only-in-log', 'sealed'], ['only-in-schemas', 'sealed'], ['p81', 'sealed'], ['prod', 'sealed']]);
  assert.equal(envs.some((e) => e.name === 'only-in-bugs'), false, 'an env only a bug report names is not map data');
  assert.deepEqual({ ...envs[0] }, { name: 'only-in-log', kind: 'sealed', source: null, copied_at: null, levels: '["Subsystem","Component"]', groups: '[]', created_by: 'anonymous' });
  assert.equal((db.prepare("SELECT created_at FROM envs WHERE name = 'p81'").get() as any).created_at, '2026-01-02T00:00:00Z', 'created_at comes from the first snapshot');
  assert.throws(() => db.prepare("INSERT INTO envs (name, kind, created_at) VALUES ('x', 'harvested', 't')").run(), 'kind is checked');
  assert.equal(count(db, 'SELECT count(*) AS n FROM snapshots'), 2);
  assert.equal(count(db, 'SELECT count(*) AS n FROM bugs'), 2);
  assert.equal(count(db, 'SELECT count(*) AS n FROM baseline_items'), 0);
  db.prepare("INSERT INTO baseline_items VALUES ('d', 's', 'ingress', 'k', '{}', 'prod', 1, 't')").run();
  assert.throws(() => db.prepare("INSERT INTO baseline_items VALUES ('d', 's', 'ingress', 'k', '{}', 'prod', 1, 't')").run(), 'primary key (env, service, list, key)');
  db.close();
  const b = new DatabaseSync(`${path}.pre-002.bak`, { readOnly: true });
  assert.equal(count(b, "SELECT count(*) AS n FROM sqlite_master WHERE name = 'envs'"), 0, 'the backup is the state before the upgrade');
  b.close();
});

test('005 only adds: no table is rebuilt and the file is Postgres-friendly (TEXT JSON and timestamps, no WITHOUT ROWID)', () => {
  const sql = readFileSync(join(import.meta.dirname, '../server/db/migrations/005_envs.sql'), 'utf8');
  assert.doesNotMatch(sql, /DROP TABLE|ALTER TABLE|WITHOUT ROWID|foreign_keys/i);
  assert.match(sql, /CREATE TABLE envs/);
});
