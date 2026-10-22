// Migration 014 (comment import fields): a database at 013 keeps its comments, gets the new columns empty, and the partial unique index
// holds per (env, source, id) only when both are set.

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

test('014 adds the import columns to a database at 013: rows kept, backup without them, external ids unique per env and source', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'flow-mapper-mig14-')), 'old.db');
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)');
  for (const f of ALL.filter((f) => f < '014')) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    raw.exec(sql);
    raw.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(f, 'then', createHash('sha256').update(sql).digest('hex'));
  }
  raw.exec("INSERT INTO comments (env, anchor, author, body, created_at) VALUES ('prod', 'flow:s/i', 'ana', '<p>x</p>', 'now')");
  raw.close();
  const db = quiet(() => openDb(path));
  const old = db.prepare('SELECT * FROM comments').get() as any;
  assert.equal(old.author, 'ana');
  for (const c of ['external_id', 'external_source', 'author_external_id', 'resolved_at', 'resolved_by']) assert.equal(old[c], null, c);
  const ins = db.prepare("INSERT INTO comments (env, anchor, author, body, created_at, external_id, external_source) VALUES (?, 'flow:s/i', 'a', 'b', 'now', ?, ?)");
  ins.run('prod', '1', 'confluence');
  assert.throws(() => ins.run('prod', '1', 'confluence'), /UNIQUE/);
  ins.run('prod', '1', 'jira'); ins.run('dsn', '1', 'confluence'); // another source, another env
  ins.run('prod', null, null); ins.run('prod', null, null); // no external id: not constrained
  db.close();
  const b = new DatabaseSync(`${path}.pre-014.bak`, { readOnly: true });
  assert.ok(!(b.prepare('PRAGMA table_info(comments)').all() as any[]).some((c) => c.name === 'external_id'));
  b.close();
});
