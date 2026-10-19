// Service snapshots and their entities: load, full/delta ingest, and per-entity CRUD.
// Every write is one transaction, bumps the service version and writes a changelog entry.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { LISTS, keyOf, validateEntity, validateManifest, validateServiceHeader, type ListName } from '../schema.ts';
import { integrityErrors } from '../../core/integrity.ts';
import { conflict, invalid, notFound } from '../errors.ts';
import type { Model, Service } from '../../core/types.ts';

type Entities = Partial<Record<ListName, any[]>>;
export type Source = 'api' | 'ui' | 'mcp' | 'seed';
export interface Changes { added: Partial<Record<ListName, string[]>>; changed: Partial<Record<ListName, string[]>>; removed: Partial<Record<ListName, string[]>> }
export interface WriteResult { env: string; service: string; fromVersion: number | null; toVersion: number; changes: Changes; changelogId: number }

const now = () => new Date().toISOString();

interface SnapshotRow { env: string; service: string; kind: string; meta: string; version: number; harvested_at: string; commit_sha: string | null }

function rowToService(r: SnapshotRow): Service {
  return { name: r.service, kind: r.kind as Service['kind'], ...JSON.parse(r.meta), version: r.version, harvestedAt: r.harvested_at, commit: r.commit_sha ?? undefined };
}

export function listEnvs(db: DB): string[] {
  return (db.prepare('SELECT DISTINCT env FROM snapshots ORDER BY env').all() as { env: string }[]).map((r) => r.env);
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

// ---------- internal write helpers ----------

function diff(before: Entities, after: Entities): Changes {
  const c: Changes = { added: {}, changed: {}, removed: {} };
  for (const l of LISTS) {
    const b = new Map((before[l] ?? []).map((e) => [keyOf(l, e), JSON.stringify(e)]));
    const a = new Map((after[l] ?? []).map((e) => [keyOf(l, e), JSON.stringify(e)]));
    const add = [...a.keys()].filter((k) => !b.has(k));
    const rem = [...b.keys()].filter((k) => !a.has(k));
    const chg = [...a.keys()].filter((k) => b.has(k) && b.get(k) !== a.get(k));
    if (add.length) c.added[l] = add;
    if (rem.length) c.removed[l] = rem;
    if (chg.length) c.changed[l] = chg;
  }
  return c;
}

function assertIntegrity(service: string, e: Entities) {
  const errs = integrityErrors(e);
  if (errs.length) throw invalid(`service '${service}' has broken internal references`, errs);
}

function replaceEntities(db: DB, env: string, service: string, e: Entities) {
  db.prepare('DELETE FROM entities WHERE env = ? AND service = ?').run(env, service);
  const ins = db.prepare('INSERT INTO entities (env, service, list, key, data) VALUES (?, ?, ?, ?, ?)');
  for (const l of LISTS) for (const x of e[l] ?? []) ins.run(env, service, l, keyOf(l, x), JSON.stringify(x));
}

function writeChangelog(db: DB, env: string, service: string, from: number | null, to: number | null, kind: string, source: Source, changes: unknown): number {
  const r = db.prepare('INSERT INTO changelog (env, service, from_version, to_version, kind, source, at, changes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(env, service, from, to, kind, source, now(), JSON.stringify(changes));
  return Number(r.lastInsertRowid);
}

function upsertSnapshot(db: DB, env: string, svc: { name: string; kind?: string; [k: string]: unknown }, version: number, harvestedAt: string, commit?: string) {
  const { name, kind, ...meta } = svc;
  db.prepare(`INSERT INTO snapshots (env, service, kind, meta, version, harvested_at, commit_sha, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (env, service) DO UPDATE SET kind = excluded.kind, meta = excluded.meta, version = excluded.version,
      harvested_at = excluded.harvested_at, commit_sha = excluded.commit_sha, updated_at = excluded.updated_at`)
    .run(env, name, kind ?? 'service', JSON.stringify(meta), version, harvestedAt, commit ?? null, now());
}

// ---------- ingest ----------

/** Thrown at the end of a dry run so the transaction rolls back; carries the result. */
class DryRun extends Error {
  result: WriteResult;
  constructor(result: WriteResult) { super('dry run'); this.result = result; }
}

/** Ingest a manifest. With dryRun, everything runs (validation, version checks, diff) and is rolled back. */
export function ingest(db: DB, manifest: any, source: Source = 'api', { dryRun = false } = {}): WriteResult {
  try {
    return apply(db, manifest, source, dryRun);
  } catch (err) {
    if (err instanceof DryRun) return err.result;
    throw err;
  }
}

function apply(db: DB, manifest: any, source: Source, dryRun: boolean): WriteResult {
  const errs = validateManifest(manifest);
  if (errs.length) throw invalid('manifest does not match schema', errs.slice(0, 50));
  const env = manifest.env ?? 'default';
  const name = manifest.service.name;

  return tx(db, () => {
    const cur = getSnapshotRow(db, env, name);
    if (cur && manifest.version <= cur.version)
      throw conflict('VERSION_NOT_NEWER', `version ${manifest.version} is not newer than current ${cur.version}`, { currentVersion: cur.version });
    const before = cur ? loadEntities(db, env, name) : {};
    let after: Entities;
    let header = manifest.service;

    if (manifest.kind === 'full') {
      after = Object.fromEntries(LISTS.map((l) => [l, manifest[l] ?? []]));
    } else {
      if (!cur) throw notFound(`service '${name}' in env '${env}' (send a full manifest first)`);
      if (cur.version !== manifest.baseVersion)
        throw conflict('VERSION_MISMATCH', `delta base ${manifest.baseVersion} does not match current ${cur.version}; send a full manifest`, { currentVersion: cur.version });
      header = { ...rowToService(cur), ...manifest.service };
      delete header.version; delete header.harvestedAt; delete header.commit;
      after = {};
      for (const l of LISTS) {
        const del = new Set(manifest.delete?.[l] ?? []);
        const map = new Map(((before as any)[l] ?? []).filter((e: any) => !del.has(keyOf(l, e))).map((e: any) => [keyOf(l, e), e]));
        for (const u of manifest.upsert?.[l] ?? []) map.set(keyOf(l, u), u);
        after[l] = [...map.values()];
      }
    }
    assertIntegrity(name, after);
    const changes = diff(before, after);
    upsertSnapshot(db, env, header, manifest.version, manifest.harvestedAt, manifest.commit);
    replaceEntities(db, env, name, after);
    const changelogId = writeChangelog(db, env, name, cur?.version ?? null, manifest.version, manifest.kind, source, changes);
    const result = { env, service: name, fromVersion: cur?.version ?? null, toVersion: manifest.version, changes, changelogId };
    if (dryRun) throw new DryRun(result); // tx rolls back
    return result;
  });
}

// ---------- CRUD ----------

/** Apply a manual edit to one service. Bumps the version by one. */
function edit(db: DB, env: string, service: string, source: Source, mutate: (e: Required<Entities>) => void): WriteResult {
  return tx(db, () => {
    const cur = getSnapshotRow(db, env, service);
    if (!cur) throw notFound(`service '${service}' in env '${env}'`);
    const before = loadEntities(db, env, service);
    const after = structuredClone(before);
    mutate(after);
    assertIntegrity(service, after);
    const changes = diff(before, after);
    const to = cur.version + 1;
    db.prepare('UPDATE snapshots SET version = ?, updated_at = ? WHERE env = ? AND service = ?').run(to, now(), env, service);
    replaceEntities(db, env, service, after);
    const changelogId = writeChangelog(db, env, service, cur.version, to, 'crud', source, changes);
    return { env, service, fromVersion: cur.version, toVersion: to, changes, changelogId };
  });
}

export function upsertEntity(db: DB, env: string, service: string, list: ListName, data: any, source: Source = 'api') {
  const errs = validateEntity(list, data);
  if (errs.length) throw invalid(`${list} entity does not match schema`, errs);
  return edit(db, env, service, source, (e) => {
    const k = keyOf(list, data);
    const i = e[list].findIndex((x) => keyOf(list, x) === k);
    if (i >= 0) e[list][i] = data; else e[list].push(data);
  });
}

export function deleteEntity(db: DB, env: string, service: string, list: ListName, key: string, source: Source = 'api') {
  return edit(db, env, service, source, (e) => {
    const i = e[list].findIndex((x) => keyOf(list, x) === key);
    if (i < 0) throw notFound(`${list} '${key}' in service '${service}'`);
    e[list].splice(i, 1);
  });
}

export function getEntity(db: DB, env: string, service: string, list: ListName, key: string) {
  const r = db.prepare('SELECT data FROM entities WHERE env = ? AND service = ? AND list = ? AND key = ?').get(env, service, list, key) as { data: string } | undefined;
  if (!r) throw notFound(`${list} '${key}' in service '${service}'`);
  return JSON.parse(r.data);
}

export function createService(db: DB, env: string, header: any, source: Source = 'api') {
  const errs = validateServiceHeader(header);
  if (errs.length) throw invalid('service does not match schema', errs);
  return tx(db, () => {
    if (getSnapshotRow(db, env, header.name)) throw conflict('EXISTS', `service '${header.name}' already exists in env '${env}'`);
    upsertSnapshot(db, env, header, 1, now());
    writeChangelog(db, env, header.name, null, 1, 'crud', source, { created: true });
    return getService(db, env, header.name);
  });
}

export function updateService(db: DB, env: string, name: string, patch: any, source: Source = 'api') {
  return tx(db, () => {
    const cur = getService(db, env, name);
    const { version, harvestedAt, commit, ...rest } = cur;
    const header = { ...rest, ...patch, name };
    const errs = validateServiceHeader(header);
    if (errs.length) throw invalid('service does not match schema', errs);
    upsertSnapshot(db, env, header, version + 1, harvestedAt, commit);
    writeChangelog(db, env, name, version, version + 1, 'crud', source, { serviceUpdated: Object.keys(patch) });
    return getService(db, env, name);
  });
}

export function deleteService(db: DB, env: string, name: string, source: Source = 'api') {
  return tx(db, () => {
    const cur = getSnapshotRow(db, env, name);
    if (!cur) throw notFound(`service '${name}' in env '${env}'`);
    db.prepare('DELETE FROM snapshots WHERE env = ? AND service = ?').run(env, name);
    writeChangelog(db, env, name, cur.version, null, 'delete-service', source, {});
    return { deleted: name };
  });
}

export function listChangelog(db: DB, env: string, opts: { service?: string; limit?: number; before?: number }) {
  const rows = db.prepare(`SELECT * FROM changelog WHERE env = ? ${opts.service ? 'AND service = ?' : ''} ${opts.before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`)
    .all(...([env, opts.service, opts.before, opts.limit ?? 50].filter((x) => x !== undefined) as (string | number)[])) as any[];
  return rows.map((r) => ({ ...r, changes: JSON.parse(r.changes) }));
}
