// 019: the perf indexes exist, a file database gets a .pre-019.bak when it upgrades from 018, and the env count query uses its index.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db/connection.ts';

const INDEXES = ['idx_entities_env_list', 'idx_snapshots_env', 'idx_changelog_env_id', 'idx_comments_open_top', 'idx_action_items_open', 'idx_comments_author', 'idx_action_items_owner', 'idx_bug_links_service', 'idx_bug_links_ref'];

test('migration 019 creates the indexes and countsOf walks idx_entities_env_list', () => {
  const db = openDb(':memory:');
  const have = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map((r) => r.name));
  for (const n of INDEXES) assert.ok(have.has(n), n);
  const plan = (db.prepare('EXPLAIN QUERY PLAN SELECT list, count(*) FROM entities WHERE env = ? GROUP BY list').all('x') as { detail: string }[]).map((r) => r.detail).join(' | ');
  assert.match(plan, /idx_entities_env_list/);
  assert.doesNotMatch(plan, /TEMP B-TREE/);
});

test('migration 019 upgrades a database at 018 and backs it up first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fm-019-'));
  try {
    const path = join(dir, 'a.db');
    openDb(path).close();
    const raw = new DatabaseSync(path);
    for (const n of INDEXES) raw.exec(`DROP INDEX ${n}`);
    raw.exec("DELETE FROM schema_migrations WHERE name = '019_perf_indexes.sql'");
    raw.close();
    const db = openDb(path);
    assert.ok(existsSync(`${path}.pre-019.bak`));
    assert.equal((db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN (" + INDEXES.map((n) => `'${n}'`).join(',') + ')').get() as { n: number }).n, INDEXES.length);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
