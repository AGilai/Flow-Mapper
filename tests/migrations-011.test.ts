// Migration 011 (comments): upgrade of an older database leaves every existing row alone and adds an empty comments table.

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

test('011 adds the comments table to a database at 010: rows kept, a backup without it, a thread can be stored', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'flow-mapper-mig11-')), 'old.db');
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)');
  for (const f of ALL.filter((f) => f < '011')) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    raw.exec(sql);
    raw.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(f, 'then', createHash('sha256').update(sql).digest('hex'));
  }
  raw.exec(`INSERT INTO descriptions (env, service, ingress, callee, source, text, updated_at) VALUES ('prod', 's', 'i', '', 'human', 'note', 'then')`);
  raw.close();
  const db = quiet(() => openDb(path));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM descriptions').get() as any).n, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM comments').get() as any).n, 0);
  const top = Number(db.prepare("INSERT INTO comments (env, anchor, author, body, created_at) VALUES ('prod', 'flow:s/i', 'ana', '<p>x</p>', 'now')").run().lastInsertRowid);
  db.prepare("INSERT INTO comments (env, anchor, parent_id, author, body, created_at) VALUES ('prod', 'flow:s/i', ?, 'ben', '<p>y</p>', 'now')").run(top);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM comments').get() as any).n, 2);
  db.close();
  const b = new DatabaseSync(`${path}.pre-011.bak`, { readOnly: true });
  assert.equal((b.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'comments'").get() as any).n, 0);
  assert.equal((b.prepare('SELECT count(*) AS n FROM descriptions').get() as any).n, 1);
  b.close();
});
