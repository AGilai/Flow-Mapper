// Migration 008 (draft_ops.origin): upgrade of a 007 database with ops, shape, and (optionally) a copy of the live database.

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
const dir = () => mkdtempSync(join(tmpdir(), 'flow-mapper-mig8-'));
const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const quiet = <T>(f: () => T): T => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };

/** A database as it was when 007 was the last migration, with a design, a draft and two ops. */
function db007(path: string) {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)');
  for (const f of ALL.filter((f) => f <= '007_events.sql')) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    raw.exec(sql);
    raw.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(f, 'then', createHash('sha256').update(sql).digest('hex'));
  }
  raw.exec(`
    INSERT INTO envs (name, kind, created_at) VALUES ('d', 'design', 't');
    INSERT INTO drafts (env, slug, name, created_by, created_at, updated_at) VALUES ('d', 'x', 'X', 'me', 't', 't');
    INSERT INTO draft_ops (draft_id, seq, op, anchor, service, list, key, data, author, at) VALUES (1, 1, 'upsert', 'svc:s', 's', 'header', '', '{"kind":"service"}', 'me', 't');
    INSERT INTO draft_ops (draft_id, seq, op, anchor, list, key, author, at) VALUES (1, 2, 'delete', 'svc:gone', 'header', '', 'me', 't');`);
  raw.close();
}

test('008 adds draft_ops.origin to a 007 database: ops kept with origin NULL, a backup without the column is written, an origin can be stored', () => {
  const path = join(dir(), 'old.db');
  db007(path);
  const db = quiet(() => openDb(path));
  assert.deepEqual(db.prepare('SELECT seq, origin FROM draft_ops ORDER BY seq').all().map((r: any) => [r.seq, r.origin]), [[1, null], [2, null]]);
  assert.equal(count(db, "SELECT count(*) AS n FROM schema_migrations WHERE name = '008_draft_origin.sql'"), 1);
  db.prepare("INSERT INTO draft_ops (draft_id, seq, op, anchor, service, list, key, data, author, at, origin) VALUES (1, 3, 'upsert', 'fn:s/f', 's', 'functions', 'f', '{}', 'me', 't', ?)").run('{"env":"prod","version":7}');
  assert.equal(JSON.parse((db.prepare('SELECT origin FROM draft_ops WHERE seq = 3').get() as any).origin).version, 7);
  db.close();
  const b = new DatabaseSync(`${path}.pre-008.bak`, { readOnly: true });
  assert.equal(count(b, "SELECT count(*) AS n FROM pragma_table_info('draft_ops') WHERE name = 'origin'"), 0);
  assert.equal(count(b, 'SELECT count(*) AS n FROM draft_ops'), 2);
  b.close();
});

test('008 only adds a column (no rebuild)', () => {
  const sql = readFileSync(join(MIG, '008_draft_origin.sql'), 'utf8');
  assert.doesNotMatch(sql, /DROP TABLE|WITHOUT ROWID|foreign_keys/i);
  assert.equal((sql.match(/ALTER TABLE draft_ops ADD COLUMN origin TEXT/g) ?? []).length, 1);
});

// A copy of the real database (never data/ itself): LIVE_COPY=/tmp/x.db node --test tests/migrations-008.test.ts
test('008 on a copy of the live database: row counts of every table are unchanged', { skip: !process.env.LIVE_COPY }, () => {
  const copy = join(dir(), 'live.db');
  const src = new DatabaseSync(process.env.LIVE_COPY!, { readOnly: true });
  src.exec(`VACUUM INTO '${copy}'`);
  const tables = (src.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
  const before = Object.fromEntries(tables.map((t) => [t, count(src, `SELECT count(*) AS n FROM "${t}"`)]));
  const hadIt = count(src, "SELECT count(*) AS n FROM schema_migrations WHERE name = '008_draft_origin.sql'") > 0;
  src.close();
  const db = quiet(() => openDb(copy));
  for (const t of tables) assert.equal(count(db, `SELECT count(*) AS n FROM "${t}"`), before[t] + (t === 'schema_migrations' && !hadIt ? 1 : 0), t);
  assert.equal(count(db, "SELECT count(*) AS n FROM pragma_table_info('draft_ops') WHERE name = 'origin'"), 1);
  assert.equal(count(db, 'SELECT count(*) AS n FROM draft_ops WHERE origin IS NOT NULL'), 0);
  db.close();
});
