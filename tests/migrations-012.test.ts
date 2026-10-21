// Migration 012 (subsystems): an 011 database upgrades in place: rows kept, baseline_groups = groups for designs only, two new tables, a backup
// without them. The live copy (tests/migrations-012-live.test.ts) checks the same on a copy of the real database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db/connection.ts';
import { baselineRows, envItemRows } from '../server/store/item-rows.ts';

const MIG = join(import.meta.dirname, '../server/db/migrations');
const ALL = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const quiet = <T>(f: () => T): T => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };

/** A database at migration 011 with a design (groups), a sealed environment with groups, and a design with none. */
export function oldDb(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'flow-mapper-mig12-')), 'old.db');
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)');
  for (const f of ALL.filter((f) => f < '012')) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    raw.exec(sql);
    raw.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(f, 'then', createHash('sha256').update(sql).digest('hex'));
  }
  const g = JSON.stringify([{ key: 'agent', label: 'Agent' }, { key: 'platform', label: 'Platform' }]);
  raw.prepare("INSERT INTO envs (name, kind, source, copied_at, levels, groups, created_at, created_by) VALUES ('d1', 'design', 'prod', 'then', '[\"Subsystem\",\"Component\"]', ?, 'then', 'ana')").run(g);
  raw.prepare("INSERT INTO envs (name, kind, levels, groups, created_at, created_by) VALUES ('s1', 'sealed', '[\"Subsystem\",\"Component\"]', ?, 'then', 'ana')").run(g);
  raw.prepare("INSERT INTO envs (name, kind, source, copied_at, levels, groups, created_at, created_by) VALUES ('d2', 'design', 'prod', 'then', '[\"Subsystem\",\"Component\"]', '[]', 'then', 'ana')").run();
  raw.prepare("INSERT INTO snapshots (env, service, kind, meta, version, harvested_at, updated_at) VALUES ('d1', 'a', 'service', '{\"groupPath\":\"agent\"}', 1, 'then', 'then')").run();
  raw.close();
  return path;
}

test('012 on a database at 011: rows kept, baseline_groups = groups for designs and NULL for sealed, a backup without the new tables, a link can be stored', () => {
  const path = oldDb();
  const db = quiet(() => openDb(path));
  const col = (n: string) => (db.prepare('SELECT baseline_groups AS b, groups AS g FROM envs WHERE name = ?').get(n) as any);
  assert.equal(col('d1').b, col('d1').g); assert.equal(col('d2').b, '[]'); assert.equal(col('s1').b, null);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as any).n, 1);
  for (const t of ['abstract_links', 'flow_relations']) assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n, 0, t);
  db.prepare("INSERT INTO abstract_links (env, id, name, from_ref, to_ref, refined_by, updated_at) VALUES ('d1', 'x', 'X', 'grp:agent', 'grp:platform', '[]', 'now')").run();
  db.prepare("INSERT INTO flow_relations (env, id, from_service, from_ingress, to_service, to_ingress, type, updated_at) VALUES ('d1', 'r1', 'a', 'i', 'b', 'j', 'same-topic', 'now')").run();
  assert.throws(() => db.prepare("INSERT INTO flow_relations (env, id, from_service, from_ingress, to_service, to_ingress, type, updated_at) VALUES ('d1', 'r2', 'a', 'i', 'b', 'j', 'likes', 'now')").run());
  // the rows: subsystem settings from groups (order = index), the link, the relation; the baseline from baseline_groups
  const rows = envItemRows(db, 'd1');
  assert.deepEqual(rows.filter((r) => r.list === 'subsystem').map((r) => [r.key, r.data.order]), [['agent', 0], ['platform', 1]]);
  assert.deepEqual(rows.filter((r) => r.list === 'link' || r.list === 'flowrel').map((r) => r.key), ['x', 'r1']);
  assert.deepEqual(baselineRows(db, 'd1').filter((r) => r.list === 'subsystem').map((r) => [r.key, r.sourceEnv, r.takenAt]), [['agent', 'prod', 'then'], ['platform', 'prod', 'then']]);
  assert.deepEqual(baselineRows(db, 's1'), [], 'a sealed environment has no baseline');
  db.close();
  const b = new DatabaseSync(`${path}.pre-012.bak`, { readOnly: true });
  assert.equal((b.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('abstract_links', 'flow_relations')").get() as any).n, 0);
  assert.equal((b.prepare("SELECT count(*) AS n FROM pragma_table_info('envs') WHERE name = 'baseline_groups'").get() as any).n, 0);
  b.close();
});
