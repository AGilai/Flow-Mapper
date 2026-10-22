// Migration 017 (flow notes, comment step ranges): a database at 016 keeps its comments, gains the `flow_notes` table with its index and two
// nullable columns on comments; the old file is backed up first.

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

test('017 adds flow_notes (latest-first index) and the step range columns; existing comments are untouched', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'flow-mapper-mig17-')), 'old.db');
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)');
  for (const f of ALL.filter((f) => f < '017')) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    raw.exec(sql);
    raw.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(f, 'then', createHash('sha256').update(sql).digest('hex'));
  }
  raw.exec("INSERT INTO comments (env, anchor, step, author, body, created_at) VALUES ('prod', 'flow:s/i', '#step:x', 'Ana', '<p>x</p>', 'now')");
  raw.close();
  const db = quiet(() => openDb(path));
  const c = db.prepare('SELECT * FROM comments').get() as any;
  assert.deepEqual([c.step, c.steps_from, c.steps_to, c.body], ['#step:x', null, null, '<p>x</p>']);
  db.prepare("INSERT INTO flow_notes (env, anchor, version, body, author, created_at) VALUES ('prod', 'flow:s/i', 1, 'a', 'Ana', 'now'), ('prod', 'flow:s/i', 2, 'b', 'Ana', 'now')").run();
  assert.throws(() => db.prepare("INSERT INTO flow_notes (env, anchor, version, body, author, created_at) VALUES ('prod', 'flow:s/i', 2, 'c', 'Ana', 'now')").run(), /UNIQUE/, 'one row per version');
  const plan = (db.prepare("EXPLAIN QUERY PLAN SELECT * FROM flow_notes WHERE env = 'prod' AND anchor = 'flow:s/i' ORDER BY version DESC LIMIT 1").all() as any[]).map((r) => r.detail).join(' ');
  assert.match(plan, /idx_flow_notes_latest/);
  db.close();
  const b = new DatabaseSync(`${path}.pre-017.bak`, { readOnly: true });
  assert.ok(!(b.prepare('PRAGMA table_info(comments)').all() as any[]).some((x) => x.name === 'steps_from'));
  b.close();
});
