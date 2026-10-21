// Data-store schemas, one per source ('code', 'db', 'manual'), keyed by the store's bind key.
// Keeping the source lets a later check compare what the code expects with what the database holds.

import type { DB } from '../db/connection.ts';
import { badRequest, notFound } from '../errors.ts';
import { guardEnv } from './envs.ts';
import { withDry } from './dry-run.ts';

export const SOURCES = ['code', 'db', 'manual'] as const;
export interface StoreSchema { key: string; source: string; content: unknown; updatedAt: string }
interface Row { store_key: string; source: string; content: string; updated_at: string }
const toSchema = (r: Row): StoreSchema => ({ key: r.store_key, source: r.source, content: JSON.parse(r.content), updatedAt: r.updated_at });

export function listSchemas(db: DB, env: string, key?: string): StoreSchema[] {
  return (db.prepare('SELECT * FROM store_schemas WHERE env = ? AND (? IS NULL OR store_key = ?) ORDER BY store_key, source')
    .all(env, key ?? null, key ?? null) as unknown as Row[]).map(toSchema);
}

/** The unguarded row writer: validates the source and that the store exists. */
export function putSchemaRow(db: DB, env: string, s: { key: string; source?: string; content: unknown }, known: (key: string) => boolean) {
  const source = s.source ?? 'code';
  if (!SOURCES.includes(source as any)) throw badRequest(`source must be one of ${SOURCES.join(', ')}`);
  if (typeof s.key !== 'string' || !known(s.key)) throw notFound(`data store '${s.key}' in env '${env}'`);
  if (s.content === undefined) throw badRequest('content is required');
  db.prepare(`INSERT INTO store_schemas (env, store_key, source, content, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (env, store_key, source) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`)
    .run(env, s.key, source, JSON.stringify(s.content), new Date().toISOString());
}

export function putSchema(db: DB, env: string, s: { key: string; source: string; content: unknown }, known: (key: string) => boolean) {
  guardEnv(db, env, 'harvester');
  putSchemaRow(db, env, s, known);
  return listSchemas(db, env, s.key).find((x) => x.source === s.source)!;
}

/** Load many schemas in one transaction: [{key, source = 'code', content}]. All or nothing. dryRun: validate only, any environment kind. */
export function loadSchemas(db: DB, env: string, items: unknown, known: (key: string) => boolean, { dryRun = false }: { dryRun?: boolean } = {}) {
  if (!Array.isArray(items)) throw badRequest('body must be {schemas: [{key, source, content}]}');
  guardEnv(db, env, dryRun ? 'dry' : 'harvester');
  return withDry(db, dryRun, () => {
    items.forEach((s: any, i) => {
      try { putSchemaRow(db, env, s ?? {}, known); } catch (err: any) { err.message = `schemas[${i}]: ${err.message}`; throw err; }
    });
    return { env, loaded: items.length, ...(dryRun ? { dryRun: true } : {}) };
  });
}

export function deleteSchemaRow(db: DB, env: string, key: string, source: string) {
  const r = db.prepare('DELETE FROM store_schemas WHERE env = ? AND store_key = ? AND source = ?').run(env, key, source);
  if (!r.changes) throw notFound(`${source} schema of '${key}'`);
  return { deleted: { key, source } };
}
export function deleteSchema(db: DB, env: string, key: string, source: string) {
  guardEnv(db, env, 'harvester');
  return deleteSchemaRow(db, env, key, source);
}
