// Opens the SQLite database and applies pending migrations from ./migrations (NNN_name.sql).
// Uses Node's built-in node:sqlite, so the project has no native dependencies.

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
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

// While the project is early, schema changes edit the migration files in place instead of adding
// new ones. A database built from an older copy of a file is refused; `npm run db:install -- --force`
// rebuilds it.
function migrate(db: DB, path: string) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)');
  const done = new Map((db.prepare('SELECT * FROM schema_migrations').all() as { name: string; checksum?: string }[]).map((r) => [r.name, r.checksum]));
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const sum = createHash('sha256').update(sql).digest('hex');
    if (done.has(file)) {
      if (done.get(file) !== sum) {
        db.close();
        throw new Error(`Database ${path} was built from an older schema (${file} has changed). ` +
          'Rebuild it with "npm run db:install -- --force" (this deletes its data), then "npm run seed".');
      }
      continue;
    }
    tx(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(file, new Date().toISOString(), sum);
    });
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
