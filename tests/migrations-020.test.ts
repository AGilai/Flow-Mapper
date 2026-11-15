// 020 (accounts): a database at 019 upgrades in place, is backed up first, and its existing design envs and drafts stay visible (owner NULL, published / shared).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db/connection.ts';
import { readableEnvs } from '../server/access.ts';
import { runAs } from '../server/auth/context.ts';

test('migration 020 upgrades a seeded 019 database: legacy designs are published and ownerless, drafts shared, backup written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fm-020-'));
  try {
    const path = join(dir, 'a.db');
    const first = openDb(path);
    const at = new Date().toISOString();
    first.prepare("INSERT INTO envs (name, kind, created_at, created_by) VALUES ('old-design', 'design', ?, 'someone')").run(at);
    first.prepare("INSERT INTO envs (name, kind, created_at) VALUES ('old-prod', 'sealed', ?)").run(at);
    first.prepare("INSERT INTO drafts (env, slug, name, created_by, created_at, updated_at) VALUES ('old-design', 'd1', 'D', 'someone', ?, ?)").run(at, at);
    first.prepare("INSERT INTO changelog (env, service, kind, source, at, changes) VALUES ('old-design', '', 'copy', 'api', ?, '{}')").run(at);
    first.close();
    // put the file back at 019
    const raw = new DatabaseSync(path);
    for (const [t, cols] of [['envs', ['owner_user_id', 'visibility']], ['drafts', ['owner_user_id', 'visibility']], ['users', ['is_admin', 'email']], ['changelog', ['user_id']]] as const)
      for (const c of cols) raw.exec(`ALTER TABLE ${t} DROP COLUMN ${c}`);
    for (const t of ['env_members', 'api_tokens', 'sessions', 'app_secrets']) raw.exec(`DROP TABLE ${t}`);
    raw.exec("DELETE FROM schema_migrations WHERE name = '020_ownership.sql'");
    raw.close();

    const db = openDb(path);
    assert.ok(existsSync(`${path}.pre-020.bak`), 'backed up first');
    const env = db.prepare("SELECT owner_user_id, visibility FROM envs WHERE name = 'old-design'").get() as any;
    assert.deepEqual([env.owner_user_id, env.visibility], [null, 'published']);
    const d = db.prepare("SELECT owner_user_id, visibility FROM drafts WHERE slug = 'd1'").get() as any;
    assert.deepEqual([d.owner_user_id, d.visibility], [null, 'shared']);
    assert.equal((db.prepare('SELECT user_id FROM changelog').get() as any).user_id, null);
    for (const t of ['env_members', 'api_tokens', 'sessions', 'app_secrets']) assert.ok(db.prepare(`SELECT count(*) AS n FROM ${t}`).get(), t);
    // a person who signs in after the upgrade still sees everything that was there
    const nobody = { id: 'u_new', name: 'New', admin: false, scope: 'user' as const, via: 'session' as const };
    runAs(nobody, () => { assert.deepEqual([...readableEnvs(db)!].sort(), ['old-design', 'old-prod']); });
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
