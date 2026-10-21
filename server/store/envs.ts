// Environments: the envs table (sealed | design), the one write guard, listing with metadata, delete.
// sealed = harvester APIs only; design = created by a copy, never written by harvesters. Annotations are allowed everywhere.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { conflict, notFound } from '../errors.ts';

export type EnvKind = 'sealed' | 'design';
export interface EnvGroup { key: string; label: string }
export interface EnvMeta {
  name: string; kind: EnvKind; source: string | null; copiedAt: string | null; groups: EnvGroup[]; levels: string[];
  createdAt: string; createdBy: string; counts: Record<string, number>;
}
interface Row { name: string; kind: EnvKind; source: string | null; copied_at: string | null; groups: string; levels: string; created_at: string; created_by: string }
const toMeta = (r: Row, counts: Record<string, number> = {}): EnvMeta => ({
  name: r.name, kind: r.kind, source: r.source, copiedAt: r.copied_at, groups: JSON.parse(r.groups), levels: JSON.parse(r.levels),
  createdAt: r.created_at, createdBy: r.created_by, counts,
});

/** Names only (GET /api/envs): the envs table plus any env that still has snapshots (a rollout safety net). */
export function listEnvs(db: DB): string[] {
  return (db.prepare('SELECT name FROM envs UNION SELECT DISTINCT env FROM snapshots ORDER BY 1').all() as { name: string }[]).map((r) => r.name);
}

export function getEnvRow(db: DB, name: string): Row | undefined {
  return db.prepare('SELECT * FROM envs WHERE name = ?').get(name) as Row | undefined;
}

function countsOf(db: DB, env: string): Record<string, number> {
  const out: Record<string, number> = { components: (db.prepare('SELECT count(*) AS n FROM snapshots WHERE env = ?').get(env) as { n: number }).n };
  for (const r of db.prepare('SELECT list, count(*) AS n FROM entities WHERE env = ? GROUP BY list').all(env) as { list: string; n: number }[]) out[r.list] = r.n;
  return out;
}

export function getEnv(db: DB, name: string): EnvMeta {
  const r = getEnvRow(db, name);
  if (!r) throw notFound(`environment '${name}'`);
  return toMeta(r, countsOf(db, name));
}

export function listEnvMeta(db: DB): EnvMeta[] {
  const rows = new Map((db.prepare('SELECT * FROM envs').all() as unknown as Row[]).map((r) => [r.name, r]));
  const fallback = (n: string): Row => ({ name: n, kind: 'sealed', source: null, copied_at: null, groups: '[]', levels: '["Subsystem","Component"]', created_at: '', created_by: 'anonymous' });
  return listEnvs(db).map((n) => toMeta(rows.get(n) ?? fallback(n), countsOf(db, n)));
}

/** An ingest into a name that is not known yet creates it, sealed. */
export function ensureEnv(db: DB, name: string) {
  db.prepare("INSERT INTO envs (name, kind, created_at) VALUES (?, 'sealed', ?) ON CONFLICT (name) DO NOTHING").run(name, new Date().toISOString());
}

export type Writer = 'harvester' | 'manual';

/**
 * The one guard of the write path. A harvester (ingest, DTOs, schemas, Redis keys) may write to a sealed or a new
 * environment, never to a design. A manual edit (entity CRUD, service CRUD, MCP upsert/delete_entity) needs a design:
 * a sealed environment is the harvesters' record. Annotations (descriptions, bugs) do not pass through here.
 */
export function guardEnv(db: DB, env: string, writer: Writer) {
  const kind = getEnvRow(db, env)?.kind;
  if (writer === 'harvester') {
    if (kind === 'design') throw conflict('ENV_DESIGN', `environment '${env}' is a design environment: harvesters do not write to it. Edit it through the entity routes instead.`);
    return;
  }
  if (!kind) throw notFound(`environment '${env}'`);
  if (kind === 'sealed') throw conflict('ENV_SEALED', `environment '${env}' is sealed: only harvesters fill it (ingest, DTOs, schemas). Copy it into a design environment to edit it (POST /api/envs).`);
}

const TABLES = ['entities', 'snapshots', 'changelog', 'health_history', 'endpoint_dtos', 'event_dtos', 'store_schemas', 'resource_keys', 'resource_keys_meta', 'descriptions', 'baseline_items', 'drafts', 'flow_names'];

/** Delete a design environment with everything in it (bugs stay: they are reports about the app, not map data). */
export function deleteEnv(db: DB, name: string) {
  const r = getEnvRow(db, name);
  if (!r) throw notFound(`environment '${name}'`);
  if (r.kind !== 'design') throw conflict('ENV_SEALED', `environment '${name}' is sealed and cannot be deleted; only design environments can`);
  tx(db, () => {
    for (const t of TABLES) db.prepare(`DELETE FROM ${t} WHERE env = ?`).run(name);
    db.prepare('DELETE FROM envs WHERE name = ?').run(name);
  });
  return { deleted: name };
}
