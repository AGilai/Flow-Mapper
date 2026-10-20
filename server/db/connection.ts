// Opens the SQLite database and applies pending migrations from ./migrations (NNN_name.sql).
// Uses Node's built-in node:sqlite, so the project has no native dependencies.

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

export type DB = DatabaseSync;

const MIGRATIONS = join(import.meta.dirname, 'migrations');

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db, path);
  return db;
}

// Migrations are append-only. Once a file has shipped it is frozen (001_init.sql included): a
// change goes in a new NNN_name.sql that upgrades existing databases in place. An applied file
// whose checksum changed is a developer error and the database is refused.
//
// Before pending migrations run on a file-backed database that already has some applied, it is
// copied to <db>.pre-<NNN>.bak (VACUUM INTO, so WAL content is included).
//
// A migration that rebuilds a table (create new, copy, drop, rename) needs foreign keys off, and
// that pragma cannot change inside a transaction. Put `-- migrate: foreign_keys=off` in the file:
// foreign keys go off before the transaction, `PRAGMA foreign_key_check` runs at its end (any
// violation rolls the migration back), and they go back on afterwards.
function migrate(db: DB, path: string) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)');
  const done = new Map((db.prepare('SELECT * FROM schema_migrations').all() as { name: string; checksum?: string }[]).map((r) => [r.name, r.checksum]));
  const pending: { file: string; sql: string; sum: string }[] = [];
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const sum = createHash('sha256').update(sql).digest('hex');
    if (!done.has(file)) { pending.push({ file, sql, sum }); continue; }
    if (done.get(file) !== sum) {
      db.close();
      throw new Error(`Database ${path} has applied ${file}, but that file has changed since. Applied migrations are frozen: ` +
        'restore the file and add a new NNN_*.sql instead.');
    }
  }
  if (!pending.length) return;
  if (path !== ':memory:' && done.size > 0) {
    const bak = `${path}.pre-${pending[0].file.split('_')[0]}.bak`;
    rmSync(bak, { force: true });
    db.exec(`VACUUM INTO '${bak.replaceAll("'", "''")}'`);
    console.log(`flow-mapper: backed up ${path} to ${bak} before applying ${pending.map((p) => p.file).join(', ')}`);
  }
  for (const { file, sql, sum } of pending) {
    const fkOff = /^--\s*migrate:\s*foreign_keys\s*=\s*off\s*$/m.test(sql);
    if (fkOff) db.exec('PRAGMA foreign_keys = OFF');
    try {
      tx(db, () => {
        db.exec(sql);
        if (fkOff) {
          const bad = db.prepare('PRAGMA foreign_key_check').all();
          if (bad.length) throw new Error(`migration ${file} left ${bad.length} foreign key violation(s)`);
        }
        db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(file, new Date().toISOString(), sum);
      });
    } finally {
      if (fkOff) db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

/** Run fn in a transaction; rolls back on throw. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
