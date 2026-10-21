// Migration 006 (drafts): upgrade of a 005 database, shape of the tables, and (optionally) a copy of the live database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db/connection.ts';

const MIG = join(import.meta.dirname, '../server/db/migrations');
const ALL = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const dir = () => mkdtempSync(join(tmpdir(), 'flow-mapper-mig6-'));
const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;

/** A database as it was when only the migrations up to `last` had been applied, with rows in prod. */
function dbUpTo(path: string, last: string, skip: string[] = []) {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)');
  for (const f of ALL.filter((f) => f <= last && !skip.includes(f))) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    raw.exec(sql);
    raw.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(f, 'then', createHash('sha256').update(sql).digest('hex'));
  }
  raw.exec(`
    INSERT INTO envs (name, kind, created_at) VALUES ('prod', 'sealed', 't');
    INSERT INTO snapshots (env, service, version, harvested_at, updated_at) VALUES ('prod', 'svc', 1, 't', 't');
    INSERT INTO entities (env, service, list, key, data) VALUES ('prod', 'svc', 'ingress', 'in.a', '{}');
    INSERT INTO changelog (env, service, kind, at, changes) VALUES ('prod', 'svc', 'full', 't', '{}');`);
  raw.close();
}

const quiet = <T>(f: () => T): T => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };

test('006 adds drafts, draft_ops, flow_names and changelog.draft_id to a 005 database: rows kept, draft_id NULL, backup lacks drafts', () => {
  const path = join(dir(), 'old.db');
  dbUpTo(path, '005_envs.sql');
  const db = quiet(() => openDb(path));
  assert.deepEqual(db.prepare('SELECT draft_id FROM changelog').all().map((r: any) => r.draft_id), [null]);
  assert.equal(count(db, 'SELECT count(*) AS n FROM entities'), 1);
  assert.equal(count(db, 'SELECT count(*) AS n FROM drafts'), 0);
  db.prepare("INSERT INTO envs (name, kind, created_at) VALUES ('d', 'design', 't')").run();
  const draft = (slug: string, status = 'open') => db.prepare('INSERT INTO drafts (env, slug, name, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('d', slug, 'A', status, 'x', 't', 't');
  draft('a');
  assert.throws(() => draft('a'), 'slug is unique per env');
  assert.throws(() => draft('b', 'weird'), 'status is checked');
  const op = (seq: number, kind: string) => db.prepare("INSERT INTO draft_ops (draft_id, seq, op, anchor, list, key, author, at) VALUES (1, ?, ?, 'svc:s', 'header', '', 'x', 't')").run(seq, kind);
  op(1, 'delete');
  assert.throws(() => op(1, 'delete'), 'primary key (draft, seq)');
  assert.throws(() => op(2, 'rename'), 'op is checked');
  db.prepare('DELETE FROM drafts WHERE id = 1').run();
  assert.equal(count(db, 'SELECT count(*) AS n FROM draft_ops'), 0, 'ops go with their draft');
  db.close();
  const b = new DatabaseSync(`${path}.pre-006.bak`, { readOnly: true });
  assert.equal(count(b, "SELECT count(*) AS n FROM sqlite_master WHERE name = 'drafts'"), 0);
  b.close();
});

test('006 applies after 007 on a database that has 007 but not 006 (the live DB state)', () => {
  const path = join(dir(), 'live.db');
  dbUpTo(path, '007_events.sql', ['006_drafts.sql']); // up to 007 (the state this models; later migrations such as 008 need 006)
  const db = quiet(() => openDb(path));
  assert.equal(count(db, "SELECT count(*) AS n FROM schema_migrations WHERE name IN ('006_drafts.sql', '007_events.sql')"), 2);
  assert.equal(count(db, "SELECT count(*) AS n FROM sqlite_master WHERE name IN ('drafts', 'draft_ops', 'flow_names', 'events')"), 4);
  assert.equal(count(db, 'SELECT count(*) AS n FROM entities'), 1);
  db.close();
});

test('006 only adds (no rebuild) and stays Postgres-friendly', () => {
  const sql = readFileSync(join(MIG, '006_drafts.sql'), 'utf8');
  assert.doesNotMatch(sql, /DROP TABLE|WITHOUT ROWID|foreign_keys/i);
  assert.equal((sql.match(/ALTER TABLE/g) ?? []).length, 1);
});

// A copy of the real database (never data/ itself): LIVE_COPY=/tmp/x.db node --test tests/migrations-006.test.ts
test('006 on a copy of the live database: row counts per env are unchanged', { skip: !process.env.LIVE_COPY }, () => {
  const copy = join(dir(), 'live.db');
  const src = new DatabaseSync(process.env.LIVE_COPY!, { readOnly: true });
  src.exec(`VACUUM INTO '${copy}'`);
  src.close();
  const tables = ['snapshots', 'entities', 'changelog', 'endpoint_dtos', 'event_dtos', 'store_schemas', 'descriptions', 'baseline_items'];
  const snap = (d: DatabaseSync) => Object.fromEntries(tables.map((t) => [t, d.prepare(`SELECT env, count(*) AS n FROM ${t} GROUP BY env ORDER BY env`).all().map((r: any) => `${r.env}=${r.n}`).join(',')]));
  const before = new DatabaseSync(copy, { readOnly: true });
  const was = snap(before);
  before.close();
  const db = quiet(() => openDb(copy));
  assert.deepEqual(snap(db), was);
  assert.equal(count(db, 'SELECT count(*) AS n FROM changelog WHERE draft_id IS NOT NULL'), 0);
  assert.equal(count(db, "SELECT count(*) AS n FROM sqlite_master WHERE name IN ('drafts', 'draft_ops', 'flow_names')"), 3);
  console.log(`# live copy: ${JSON.stringify(was)}`);
  db.close();
});
