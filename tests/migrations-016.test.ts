// Migration 016 (users): a database at 015 keeps its comments and items, and the authors and owners become users (names that differ only
// in case or spacing are one), linked by id; the name index is unique among live users only.

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

test('016 turns existing authors and owners into users and links the rows', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'flow-mapper-mig16-')), 'old.db');
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)');
  for (const f of ALL.filter((f) => f < '016')) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    raw.exec(sql);
    raw.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(f, 'then', createHash('sha256').update(sql).digest('hex'));
  }
  raw.exec(`INSERT INTO comments (env, anchor, author, body, created_at) VALUES ('prod', 'flow:s/i', 'Ana', 'x', 'now'), ('prod', 'flow:s/i', 'ana ', 'y', 'now'), ('dsn', 'flow:s/i', 'Ben', 'z', 'now');
    INSERT INTO action_items (env, anchor, number, owner, description, status, created_by, updated_by, created_at, updated_at) VALUES ('prod', 'flow:s/i', 1, 'Cy', 'd', 'open', 'ana', 'ana', 'now', 'now')`);
  raw.close();
  const db = quiet(() => openDb(path));
  const users = db.prepare('SELECT * FROM users ORDER BY name').all() as any[];
  assert.deepEqual(users.map((u) => u.name), ['Ana', 'Ben', 'Cy']);
  for (const u of users) { assert.match(u.id, /^u_[0-9a-f]{8}$/); assert.equal(u.color, parseInt(u.id.slice(-1), 16) % 8); }
  const ids = Object.fromEntries(users.map((u) => [u.name, u.id]));
  assert.deepEqual((db.prepare('SELECT author_id FROM comments ORDER BY id').all() as any[]).map((r) => r.author_id), [ids.Ana, ids.Ana, ids.Ben]);
  const it = db.prepare('SELECT * FROM action_items').get() as any;
  assert.equal(it.owner_id, ids.Cy); assert.equal(it.created_by_id, ids.Ana);
  assert.throws(() => db.prepare("INSERT INTO users (id, name, color, created_at) VALUES ('u_x', 'ANA', 0, 'now')").run(), /UNIQUE/);
  db.prepare("UPDATE users SET merged_into = ? WHERE id = ?").run(ids.Ana, ids.Cy);
  db.prepare("INSERT INTO users (id, name, color, created_at) VALUES ('u_y', 'cy', 0, 'now')").run(); // a merged user's name is free again
  db.close();
  const b = new DatabaseSync(`${path}.pre-016.bak`, { readOnly: true });
  assert.ok(!(b.prepare('PRAGMA table_info(comments)').all() as any[]).some((c) => c.name === 'author_id'));
  b.close();
});
