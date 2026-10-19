// Creates a database with the full schema (server/db/migrations/*.sql).
//   node scripts/db-install.ts           → new database; refuses if one already exists
//   node scripts/db-install.ts --force   → deletes the existing database (and its data) first
// Uses FLOW_DB / FLOW_DATA_DIR like the server. Stop the server before --force.

import { existsSync, rmSync } from 'node:fs';
import { config } from '../server/config.ts';
import { openDb } from '../server/db/connection.ts';

const path = config.dbPath;
if (existsSync(path)) {
  if (!process.argv.includes('--force')) {
    console.error(`${path} already exists. Use --force to delete it and install a fresh one.`);
    process.exit(1);
  }
  for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true });
}

const db = openDb(path);
const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
db.close();
console.log(`installed ${path} (${tables.length} tables: ${tables.join(', ')})`);
console.log('next: npm run seed');
