// Migration 010 (resource_keys.assumed): upgrade of an older database that holds key entries.

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
const quiet = <T>(f: () => T): T => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };

test('010 adds resource_keys.assumed to an older database: rows kept with [], a backup without the column, a value can be stored', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'flow-mapper-mig10-')), 'old.db');
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)');
  for (const f of ALL.filter((f) => f < '010')) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    raw.exec(sql);
    raw.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(f, 'then', createHash('sha256').update(sql).digest('hex'));
  }
  raw.exec(`INSERT INTO resource_keys (env, instance, db_index, key_template, service, access, commands) VALUES ('prod', 'redis:c', 0, 'k:{id}', 's', 'read', '["GET"]')`);
  raw.close();
  const db = quiet(() => openDb(path));
  assert.equal((db.prepare('SELECT assumed FROM resource_keys').get() as any).assumed, '[]');
  db.prepare('UPDATE resource_keys SET assumed = ?').run('[{"what":"ttl"}]');
  assert.equal((db.prepare('SELECT assumed FROM resource_keys').get() as any).assumed, '[{"what":"ttl"}]');
  db.close();
  const b = new DatabaseSync(`${path}.pre-010.bak`, { readOnly: true });
  assert.equal((b.prepare("SELECT count(*) AS n FROM pragma_table_info('resource_keys') WHERE name = 'assumed'").get() as any).n, 0);
  assert.equal((b.prepare('SELECT count(*) AS n FROM resource_keys').get() as any).n, 1);
  b.close();
});
