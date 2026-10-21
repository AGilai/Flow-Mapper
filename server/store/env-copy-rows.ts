// The row-level work of copying an environment: one service's snapshot and entities, DTOs, event DTOs, schemas,
// Redis keys, descriptions, and the baseline rows (what the design was copied from, frozen). Nothing here is shared
// with the source afterwards: every row is a new row of the new environment.

import type { DB } from '../db/connection.ts';
import { keySummary } from '../../core/keys.ts';
import { getEntries, getMeta } from './keys.ts';
import type { SnapshotRow } from './snapshots-read.ts';

export interface CopyCtx { db: DB; from: string; to: string; at: string; fromKind: 'sealed' | 'design'; mode: 'components' | 'full'; behaviour?: boolean }

const base = (c: CopyCtx, service: string, list: string, key: string, data: unknown, version: number | null) =>
  c.db.prepare('INSERT OR REPLACE INTO baseline_items (env, service, list, key, data, source_env, source_version, taken_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(c.to, service, list, key, JSON.stringify(data), c.from, version, c.at);

/** A design source keeps its own baseline for the rows that come along; a sealed source's copied rows become the baseline. */
function copyBaseline(c: CopyCtx, where: string, args: (string | number)[]) {
  c.db.prepare(`INSERT OR REPLACE INTO baseline_items (env, service, list, key, data, source_env, source_version, taken_at)
    SELECT ?, service, list, key, data, source_env, source_version, taken_at FROM baseline_items WHERE env = ? AND ${where}`).run(c.to, c.from, ...args);
}

/** Snapshot header (with the subsystem path) and entities of one service. Components mode leaves the functions out unless `behaviour` is set. */
export function copyService(c: CopyCtx, name: string, groupPath: string | undefined) {
  const row = c.db.prepare('SELECT * FROM snapshots WHERE env = ? AND service = ?').get(c.from, name) as SnapshotRow | undefined;
  if (!row) return null;
  const meta = JSON.parse(row.meta);
  if (groupPath !== undefined) { if (groupPath) meta.groupPath = groupPath; else delete meta.groupPath; }
  c.db.prepare('INSERT INTO snapshots (env, service, kind, meta, version, harvested_at, commit_sha, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(c.to, name, row.kind, JSON.stringify(meta), row.version, row.harvested_at, row.commit_sha, c.at);
  const skip = c.mode === 'components' && !c.behaviour ? 'functions' : '';
  const rows = c.db.prepare('SELECT list, key, data FROM entities WHERE env = ? AND service = ? AND list <> ?').all(c.from, name, skip) as { list: string; key: string; data: string }[];
  const ins = c.db.prepare('INSERT INTO entities (env, service, list, key, data) VALUES (?, ?, ?, ?, ?)');
  for (const r of rows) ins.run(c.to, name, r.list, r.key, r.data);
  if (c.fromKind === 'design') copyBaseline(c, 'service = ? AND list <> ?', [name, skip]);
  else {
    const { groupPath: _drop, ...bare } = meta;
    base(c, name, 'header', '', { kind: row.kind, ...bare }, row.version);
    for (const r of rows) base(c, name, r.list, r.key, JSON.parse(r.data), row.version);
  }
  const types = new Set<string>(), stores = new Set<string>();
  for (const r of rows) {
    const d = JSON.parse(r.data);
    if (r.list === 'egress') for (const t of d.events ?? []) types.add(t);
    if (r.list === 'ingress') for (const e of d.events ?? []) types.add(e.type);
    if (r.list === 'resources' && d.bindKey) stores.add(d.bindKey);
  }
  return { version: row.version, types, stores, entities: rows.length };
}

/** Endpoint DTOs of one service. */
export function copyDtos(c: CopyCtx, service: string) {
  c.db.prepare(`INSERT INTO endpoint_dtos (env, service, ingress, role, status, content, meta, updated_at)
    SELECT ?, service, ingress, role, status, content, meta, updated_at FROM endpoint_dtos WHERE env = ? AND service = ?`).run(c.to, c.from, service);
  if (c.fromKind === 'design') return copyBaseline(c, "service = ? AND list = 'dto'", [service]);
  const rows = c.db.prepare('SELECT ingress, role, status, content, meta FROM endpoint_dtos WHERE env = ? AND service = ?').all(c.from, service) as any[];
  for (const r of rows) base(c, service, 'dto', `${r.ingress}|${r.role}|${r.status}`, { content: JSON.parse(r.content), meta: r.meta ? JSON.parse(r.meta) : null }, null);
}

/** Event DTOs and store schemas, env-scoped: only those the copied services refer to (all in a full copy). */
export function copyShared(c: CopyCtx, types: Set<string>, stores: Set<string>) {
  const full = c.mode === 'full';
  const ev = (c.db.prepare('SELECT event_type, content, meta, updated_at FROM event_dtos WHERE env = ?').all(c.from) as any[]).filter((r) => full || types.has(r.event_type));
  for (const r of ev) {
    c.db.prepare('INSERT INTO event_dtos (env, event_type, content, meta, updated_at) VALUES (?, ?, ?, ?, ?)').run(c.to, r.event_type, r.content, r.meta, r.updated_at);
    if (c.fromKind === 'sealed') base(c, '', 'event_dto', r.event_type, { content: JSON.parse(r.content), meta: r.meta ? JSON.parse(r.meta) : null }, null);
    else copyBaseline(c, "service = '' AND list = 'event_dto' AND key = ?", [r.event_type]);
  }
  const sc = (c.db.prepare('SELECT store_key, source, content, updated_at FROM store_schemas WHERE env = ?').all(c.from) as any[]).filter((r) => full || stores.has(r.store_key));
  for (const r of sc) {
    c.db.prepare('INSERT INTO store_schemas (env, store_key, source, content, updated_at) VALUES (?, ?, ?, ?, ?)').run(c.to, r.store_key, r.source, r.content, r.updated_at);
    if (c.fromKind === 'sealed') base(c, '', 'schema', `${r.store_key}|${r.source}`, JSON.parse(r.content), null);
    else copyBaseline(c, "service = '' AND list = 'schema' AND key = ?", [`${r.store_key}|${r.source}`]);
  }
  return { eventDtos: ev.length, schemas: sc.length };
}

/** Redis key templates: the rows of the copied services (summary recomputed per instance); a full copy takes all of them. */
export function copyKeys(c: CopyCtx, services: Set<string>) {
  const instances = (c.db.prepare('SELECT instance FROM resource_keys_meta WHERE env = ?').all(c.from) as { instance: string }[]).map((r) => r.instance);
  const ins = c.db.prepare('INSERT INTO resource_keys (env, instance, db_index, key_template, service, access, commands, ops_per_hour, ttl_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const instance of instances) {
    const raw = c.db.prepare('SELECT * FROM resource_keys WHERE env = ? AND instance = ?').all(c.from, instance) as any[];
    const rows = c.mode === 'full' ? raw : raw.filter((r) => services.has(r.service));
    if (!rows.length && c.mode !== 'full') continue;
    for (const r of rows) ins.run(c.to, instance, r.db_index, r.key_template, r.service, r.access, r.commands, r.ops_per_hour, r.ttl_seconds);
    const m = getMeta(c.db, c.from, instance)!;
    const summary = c.mode === 'full' ? (c.db.prepare('SELECT summary FROM resource_keys_meta WHERE env = ? AND instance = ?').get(c.from, instance) as any).summary
      : JSON.stringify(keySummary(getEntries(c.db, c.from, instance).filter((e) => services.has(e.service))));
    c.db.prepare('INSERT INTO resource_keys_meta (env, instance, version, pushed_at, producer, summary) VALUES (?, ?, ?, ?, ?, ?)').run(c.to, instance, m.version, m.pushedAt, m.producer ?? null, summary);
  }
}

/** Flow descriptions (annotations of flows): a full copy only, the flows are there. Bugs never come along. */
export function copyDescriptions(c: CopyCtx) {
  c.db.prepare(`INSERT INTO descriptions (env, service, ingress, callee, source, text, author, model, trace_hash, updated_at)
    SELECT ?, service, ingress, callee, source, text, author, model, trace_hash, updated_at FROM descriptions WHERE env = ?`).run(c.to, c.from);
}

/** A full copy of a design keeps the baseline rows of services the design has since removed too (they show as Removed later). */
export function copyAllBaseline(c: CopyCtx) {
  if (c.fromKind === 'design') copyBaseline(c, '1 = 1', []);
}

/** A full copy of a design carries its abstract links and flow relations as they are (a Components or Blank copy, or a copy of a sealed environment, has none). */
export function copyDesignLists(c: CopyCtx) {
  c.db.prepare(`INSERT INTO abstract_links (env, id, name, from_ref, to_ref, mode, transport, description, doc, refined_by, author, updated_at)
    SELECT ?, id, name, from_ref, to_ref, mode, transport, description, doc, refined_by, author, updated_at FROM abstract_links WHERE env = ?`).run(c.to, c.from);
  c.db.prepare(`INSERT INTO flow_relations (env, id, from_service, from_ingress, to_service, to_ingress, type, note, author, updated_at)
    SELECT ?, id, from_service, from_ingress, to_service, to_ingress, type, note, author, updated_at FROM flow_relations WHERE env = ?`).run(c.to, c.from);
}
