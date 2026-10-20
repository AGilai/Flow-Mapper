// Key templates per Redis instance: full replace per instance, versioned like an ingest (a pushed `version` must be above
// the stored one; without it the server adds one). Validation and grouping are in core/keys.ts and core/instances.ts.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import type { GraphIndex } from '../../core/graph-index.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { keySummary, normaliseKeys, type KeyEntry, type KeyFilter, type KeySummary } from '../../core/keys.ts';
import { instanceView, keysView, resolveInstance, type KeyMeta } from '../../core/instances.ts';

interface Row { db_index: number; key_template: string; service: string; access: string; commands: string; ops_per_hour: number | null; ttl_seconds: number | null }
const toEntry = (r: Row): KeyEntry => ({
  keyTemplate: r.key_template, dbIndex: r.db_index, service: r.service, access: r.access as KeyEntry['access'], commands: JSON.parse(r.commands),
  ...(r.ops_per_hour != null ? { opsPerHour: r.ops_per_hour } : {}), ...(r.ttl_seconds != null ? { ttlSeconds: r.ttl_seconds } : {}),
});

export function getMeta(db: DB, env: string, instance: string): KeyMeta | null {
  const r = db.prepare('SELECT version, pushed_at, producer FROM resource_keys_meta WHERE env = ? AND instance = ?').get(env, instance) as any;
  return r ? { version: r.version, pushedAt: r.pushed_at, producer: r.producer } : null;
}

export function getEntries(db: DB, env: string, instance: string): KeyEntry[] {
  return (db.prepare('SELECT * FROM resource_keys WHERE env = ? AND instance = ? ORDER BY db_index, key_template, service').all(env, instance) as unknown as Row[]).map(toEntry);
}

/** Stored key summary per instance of an env (for the Inventory). */
export function allSummaries(db: DB, env: string): Map<string, KeySummary> {
  const rows = db.prepare('SELECT instance, summary FROM resource_keys_meta WHERE env = ?').all(env) as { instance: string; summary: string }[];
  return new Map(rows.map((r) => [r.instance, JSON.parse(r.summary)]));
}

/** Everything the static preview needs: [{instance, meta, entries}] of an env. */
export function allForPreview(db: DB, env: string) {
  return (db.prepare('SELECT instance FROM resource_keys_meta WHERE env = ? ORDER BY instance').all(env) as { instance: string }[])
    .map((r) => ({ instance: r.instance, meta: getMeta(db, env, r.instance), entries: getEntries(db, env, r.instance) }));
}

/** Replace the keys of one instance. `body`: {keys, version?, producer?} or the bare array. The instance must exist in the env's map. */
export function putKeys(db: DB, g: GraphIndex, env: string, id: string, body: any) {
  const instance = resolveInstance(g, id);
  if (!instance) throw notFound(`Redis instance '${id}' in env '${env}' (a resource with a bind key 'redis:<name>/…' or an infra resource 'redis:<name>')`);
  const obj = Array.isArray(body) ? { keys: body } : body;
  if (!obj || typeof obj !== 'object') throw badRequest('body must be {keys: [...]} or a list of keys');
  const { entries, errors } = normaliseKeys(obj.keys);
  if (errors.length) throw badRequest(`${errors.length} invalid key entr${errors.length === 1 ? 'y' : 'ies'}: ${errors.slice(0, 3).map((e) => `keys[${e.index}].${e.field} ${e.message}`).join('; ')}`, errors.slice(0, 50));
  if (obj.version !== undefined && !(Number.isInteger(obj.version) && obj.version >= 1)) throw badRequest('version must be an integer >= 1');
  if (obj.producer !== undefined && typeof obj.producer !== 'string') throw badRequest('producer must be a string');
  const cur = getMeta(db, env, instance);
  if (obj.version !== undefined && cur && obj.version <= cur.version) throw conflict('STALE_VERSION', `version ${obj.version} is not above the stored ${cur.version}`, { current: cur.version });
  const version = obj.version ?? (cur?.version ?? 0) + 1;
  const summary = keySummary(entries);
  const now = new Date().toISOString();
  tx(db, () => {
    db.prepare('DELETE FROM resource_keys WHERE env = ? AND instance = ?').run(env, instance);
    const ins = db.prepare('INSERT INTO resource_keys (env, instance, db_index, key_template, service, access, commands, ops_per_hour, ttl_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const e of entries) ins.run(env, instance, e.dbIndex, e.keyTemplate, e.service, e.access, JSON.stringify(e.commands), e.opsPerHour ?? null, e.ttlSeconds ?? null);
    db.prepare(`INSERT INTO resource_keys_meta (env, instance, version, pushed_at, producer, summary) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (env, instance) DO UPDATE SET version = excluded.version, pushed_at = excluded.pushed_at, producer = excluded.producer, summary = excluded.summary`)
      .run(env, instance, version, now, obj.producer ?? null, JSON.stringify(summary));
  });
  return { env, instance, version, pushedAt: now, entries: entries.length, summary };
}

/** The grouped key list of one instance (pushed keys, else the interim inline ones), filtered; 404 when the instance is unknown. */
export function readKeys(db: DB, g: GraphIndex, env: string, id: string, filter: KeyFilter = {}) {
  const instance = resolveInstance(g, id);
  if (!instance) throw notFound(`Redis instance '${id}' in env '${env}'`);
  return keysView(g, instance, getEntries(db, env, instance), getMeta(db, env, instance), filter)!;
}

/** The page of one instance: identity, who connects, key summary (not the keys). */
export function readInstance(db: DB, g: GraphIndex, env: string, id: string) {
  const instance = resolveInstance(g, id);
  const v = instance && instanceView(g, instance, getEntries(db, env, instance), getMeta(db, env, instance));
  if (!v) throw notFound(`Redis instance '${id}' in env '${env}'`);
  return v;
}
