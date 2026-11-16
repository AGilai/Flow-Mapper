// GET /api/envs/:env/export: the whole design environment as one JSON bundle (read only). Table decisions: spec.ts.

import type { DB } from '../db/connection.ts';
import { badRequest, notFound } from '../errors.ts';
import { SPECS, type TableSpec } from './spec.ts';

export const FORMAT = 'flow-mapper-env';

/** The number of the latest applied migration (its file name starts with it). */
export function schemaVersion(db: DB): number {
  const rows = db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[];
  return Math.max(0, ...rows.map((r) => parseInt(r.name, 10) || 0));
}

export const q = (id: string) => `"${id.replaceAll('"', '""')}"`;

/** SQL (with one `?` for the env) selecting the ids of rows of table `t` that belong to the env. */
function idsOf(t: string): string {
  const s = SPECS.find((x) => x.table === t)!;
  return s.parent ? `SELECT id FROM ${q(t)} WHERE ${q(s.parent.col)} IN (${idsOf(s.parent.table)})` : `SELECT id FROM ${q(t)} WHERE env = ?`;
}

function selectRows(db: DB, s: TableSpec, env: string): Record<string, unknown>[] {
  const order = s.auto ? 'id' : 'rowid';
  if (!s.parent) return db.prepare(`SELECT * FROM ${q(s.table)} WHERE env = ? ORDER BY ${order}`).all(env) as any;
  return db.prepare(`SELECT * FROM ${q(s.table)} WHERE ${q(s.parent.col)} IN (${idsOf(s.parent.table)}) ORDER BY ${order}`).all(env) as any;
}

export function exportEnv(db: DB, env: string, appVersion: string) {
  const row = db.prepare('SELECT * FROM envs WHERE name = ?').get(env) as Record<string, unknown> | undefined;
  if (!row) throw notFound(`environment '${env}'`);
  if (row.kind !== 'design') throw badRequest(`environment '${env}' is sealed (harvested): only design environments are exported`);
  const { owner_user_id: _o, visibility: _v, ...meta } = row;
  const tables: Record<string, Record<string, unknown>[]> = {};
  const userIds = new Set<string>();
  for (const s of SPECS) {
    tables[s.table] = selectRows(db, s, env);
    for (const r of tables[s.table]) for (const c of s.users ?? []) if (typeof r[c] === 'string') userIds.add(r[c] as string);
  }
  const users: Record<string, { name: string; email: string | null }> = {}; // user id -> name and email: an importer matches people by exact email only, the names stay as text on the rows
  for (const id of userIds) { const u = db.prepare('SELECT name, email FROM users WHERE id = ?').get(id) as { name: string; email: string | null } | undefined; if (u) users[id] = { name: u.name, email: u.email }; }
  return { format: FORMAT, formatVersion: 1, appVersion, schemaVersion: schemaVersion(db), exportedAt: new Date().toISOString(), env: meta, users, tables };
}
