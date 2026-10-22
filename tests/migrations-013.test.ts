// Migration 013 (action items): an upgrade of a database at 012 leaves every existing row alone and adds two empty tables; numbers are unique per anchor.

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

test('013 adds the action item tables to a database at 012: rows kept, a backup without them, an item and its event can be stored', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'flow-mapper-mig13-')), 'old.db');
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)');
  for (const f of ALL.filter((f) => f < '013')) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    raw.exec(sql);
    raw.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(f, 'then', createHash('sha256').update(sql).digest('hex'));
  }
  raw.exec("INSERT INTO comments (env, anchor, author, body, created_at) VALUES ('prod', 'flow:s/i', 'ana', '<p>x</p>', 'then')");
  raw.close();
  const db = quiet(() => openDb(path));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM comments').get() as any).n, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM action_items').get() as any).n, 0);
  const ins = "INSERT INTO action_items (env, anchor, number, owner, description, status, created_by, updated_by, created_at, updated_at) VALUES ('prod', 'flow:s/i', ?, 'ana', 'd', 'open', 'ana', 'ana', 'now', 'now')";
  const id = Number(db.prepare(ins).run(1).lastInsertRowid);
  db.prepare("INSERT INTO action_item_events (item_id, kind, actor, at) VALUES (?, 'created', 'ana', 'now')").run(id);
  assert.throws(() => db.prepare(ins).run(1), /UNIQUE/, 'a number is unique per environment and anchor');
  assert.equal((db.prepare("SELECT source FROM action_items WHERE id = ?").get(id) as any).source, 'human');
  db.close();
  const b = new DatabaseSync(`${path}.pre-013.bak`, { readOnly: true });
  assert.equal((b.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('action_items', 'action_item_events')").get() as any).n, 0);
  assert.equal((b.prepare('SELECT count(*) AS n FROM comments').get() as any).n, 1);
  b.close();
});
