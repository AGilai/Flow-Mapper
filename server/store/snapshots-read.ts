// Snapshot reads: services, entities, the whole-env model, changelog.

import type { DB } from '../db/connection.ts';
import { LISTS, type ListName } from '../schema.ts';
import type { ContractReport } from '../../core/contract.ts';
import { notFound } from '../errors.ts';
import type { Model, Service } from '../../core/types.ts';

export type Entities = Partial<Record<ListName, any[]>>;
export type Source = 'api' | 'ui' | 'mcp' | 'seed';
export interface Changes { added: Partial<Record<ListName, string[]>>; changed: Partial<Record<ListName, string[]>>; removed: Partial<Record<ListName, string[]>> }
export interface WriteResult { env: string; service: string; fromVersion: number | null; toVersion: number; changes: Changes; changelogId: number; contract?: ContractReport }

export interface SnapshotRow { env: string; service: string; kind: string; meta: string; version: number; harvested_at: string; commit_sha: string | null }

export function rowToService(r: SnapshotRow): Service {
  return { name: r.service, kind: r.kind as Service['kind'], ...JSON.parse(r.meta), version: r.version, harvestedAt: r.harvested_at, commit: r.commit_sha ?? undefined };
}

export function getSnapshotRow(db: DB, env: string, service: string): SnapshotRow | undefined {
  return db.prepare('SELECT * FROM snapshots WHERE env = ? AND service = ?').get(env, service) as SnapshotRow | undefined;
}

export function getService(db: DB, env: string, service: string): Service {
  const r = getSnapshotRow(db, env, service);
  if (!r) throw notFound(`service '${service}' in env '${env}'`);
  return rowToService(r);
}

export function loadEntities(db: DB, env: string, service: string): Required<Entities> {
  const out = Object.fromEntries(LISTS.map((l) => [l, []])) as unknown as Required<Entities>;
  const rows = db.prepare('SELECT list, data FROM entities WHERE env = ? AND service = ? ORDER BY list, key').all(env, service) as { list: ListName; data: string }[];
  for (const r of rows) out[r.list].push(JSON.parse(r.data));
  return out;
}

export function loadModel(db: DB, env: string): Model {
  const services = (db.prepare('SELECT * FROM snapshots WHERE env = ? ORDER BY service').all(env) as unknown as SnapshotRow[]).map(rowToService);
  const model: Model = { env, services, functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [] };
  const rows = db.prepare('SELECT service, list, data FROM entities WHERE env = ? ORDER BY service, list, key').all(env) as { service: string; list: ListName; data: string }[];
  for (const r of rows) {
    const e = { ...JSON.parse(r.data), service: r.service };
    if (r.list === 'functions') e.steps = e.steps ?? [];
    (model[r.list] as any[]).push(e);
  }
  return model;
}

export function getEntity(db: DB, env: string, service: string, list: ListName, key: string) {
  const r = db.prepare('SELECT data FROM entities WHERE env = ? AND service = ? AND list = ? AND key = ?').get(env, service, list, key) as { data: string } | undefined;
  if (!r) throw notFound(`${list} '${key}' in service '${service}'`);
  return JSON.parse(r.data);
}


export function listChangelog(db: DB, env: string, opts: { service?: string; limit?: number; before?: number }) {
  const rows = db.prepare(`SELECT * FROM changelog WHERE env = ? ${opts.service ? 'AND service = ?' : ''} ${opts.before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`)
    .all(...([env, opts.service, opts.before, opts.limit ?? 50].filter((x) => x !== undefined) as (string | number)[])) as any[];
  return rows.map((r) => ({ ...r, changes: JSON.parse(r.changes) }));
}

