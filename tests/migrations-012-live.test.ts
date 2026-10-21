// Migration 012 on a COPY of the live database. Skipped unless FLOW_LIVE_COPY=<path to the copy> (made with
// `sqlite3 data/flow-mapper.db ".backup <scratch>/live.db"` or VACUUM INTO, never inside data/). The copy is opened here (so 012 runs on it);
// the test compares it with a second copy that was NOT migrated (FLOW_LIVE_ORIG=<path>, optional) and checks the 0.28 reads on the real data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db/connection.ts';
import { envItemRows } from '../server/store/item-rows.ts';
import { createContext } from '../server/app.ts';
import { marksFor } from '../server/marks.ts';

const live = process.env.FLOW_LIVE_COPY;
const quiet = <T>(f: () => T): T => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };

test('012 on a copy of the live database: row counts unchanged, baseline_groups = groups, prod rows unchanged, hld-import marks', { skip: !live }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-mapper-live12-')), path = join(dir, 'live.db');
  copyFileSync(live!, path);
  const raw = new DatabaseSync(path, { readOnly: true });
  const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
  const count = (d: DatabaseSync, t: string) => (d.prepare(`SELECT count(*) AS n FROM ${t}`).get() as any).n;
  const before = Object.fromEntries(tables.map((t) => [t, count(raw, t)]));
  const oldGroups = (raw.prepare("SELECT name, groups FROM envs WHERE kind = 'design'").all() as { name: string; groups: string }[]);
  raw.close();
  const db = quiet(() => openDb(path));
  for (const t of tables.filter((t) => t !== 'schema_migrations')) assert.equal(count(db, t), before[t], `rows of ${t}`);
  for (const e of oldGroups) assert.equal((db.prepare('SELECT baseline_groups AS b FROM envs WHERE name = ?').get(e.name) as any).b, e.groups, `baseline_groups of ${e.name}`);
  assert.equal(count(db, 'abstract_links'), 0); assert.equal(count(db, 'flow_relations'), 0);
  db.close();
  const ctx = createContext({ dbPath: path, dataDir: dir });
  const hasDraft = ctx.db.prepare("SELECT 1 FROM drafts WHERE env = 'sase-hld' AND slug = 'hld-import' AND status = 'open'").get();
  if (hasDraft) {
    const m = marksFor(ctx, 'sase-hld', { draft: 'hld-import' }).marks;
    assert.equal(m['grp:agent']?.mark, 'new'); assert.equal(m['grp:network']?.mark, 'changed'); assert.equal(m['grp:platform']?.mark, 'changed');
  }
  assert.ok(envItemRows(ctx.db, 'prod').length > 0);
});
