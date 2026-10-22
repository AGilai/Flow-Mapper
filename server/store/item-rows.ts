// The tables of one environment (or its frozen baseline) as ItemRows (core/item-rows.ts): the one shape the diff and the
// drafts work on. Reads only; nothing here writes.

import type { DB } from '../db/connection.ts';
import { rowId, type ItemRow } from '../../core/item-rows.ts';
import { sourceNow } from '../../core/diff/source-now.ts';

const parse = (s: string | null) => (s ? JSON.parse(s) : null);

/** Every item of an environment as it is stored now. Header rows carry version, harvestedAt and commit too (rowsToModel reads them). */
export function envItemRows(db: DB, env: string): ItemRow[] {
  const out: ItemRow[] = [];
  for (const r of db.prepare('SELECT * FROM snapshots WHERE env = ? ORDER BY service').all(env) as any[]) {
    out.push({ service: r.service, list: 'header', key: '', data: { kind: r.kind, ...JSON.parse(r.meta), version: r.version, harvestedAt: r.harvested_at, ...(r.commit_sha ? { commit: r.commit_sha } : {}) } });
  }
  for (const r of db.prepare('SELECT service, list, key, data FROM entities WHERE env = ?').all(env) as any[]) out.push({ service: r.service, list: r.list, key: r.key, data: JSON.parse(r.data) });
  for (const r of db.prepare('SELECT service, ingress, role, status, content, meta FROM endpoint_dtos WHERE env = ?').all(env) as any[]) {
    out.push({ service: r.service, list: 'dto', key: `${r.ingress}|${r.role}|${r.status}`, data: { content: JSON.parse(r.content), meta: parse(r.meta) } });
  }
  for (const r of db.prepare('SELECT event_type, content, meta FROM event_dtos WHERE env = ?').all(env) as any[]) {
    out.push({ service: '', list: 'event_dto', key: r.event_type, data: { content: JSON.parse(r.content), meta: parse(r.meta) } });
  }
  for (const r of db.prepare('SELECT store_key, source, content FROM store_schemas WHERE env = ?').all(env) as any[]) {
    out.push({ service: '', list: 'schema', key: `${r.store_key}|${r.source}`, data: JSON.parse(r.content) });
  }
  // Design lists (core/item-rows.ts DESIGN_LISTS): subsystem settings (envs.groups, order = index), abstract links, flow relations.
  const env_ = db.prepare('SELECT groups FROM envs WHERE name = ?').get(env) as { groups: string } | undefined;
  if (env_) subsystemRowsOf(env_.groups).forEach((r) => out.push(r));
  for (const r of db.prepare('SELECT * FROM abstract_links WHERE env = ? ORDER BY id').all(env) as any[]) {
    const refined = JSON.parse(r.refined_by || '[]');
    out.push({ service: '', list: 'link', key: r.id, data: { name: r.name, from: r.from_ref, to: r.to_ref, ...(r.mode ? { mode: r.mode } : {}), ...(r.transport ? { transport: r.transport } : {}),
      ...(r.description ? { description: r.description } : {}), ...(r.doc ? { doc: JSON.parse(r.doc) } : {}), ...(refined.length ? { refinedBy: refined } : {}) } });
  }
  for (const r of db.prepare('SELECT * FROM flow_relations WHERE env = ? ORDER BY id').all(env) as any[]) {
    out.push({ service: '', list: 'flowrel', key: r.id, data: { from: `flow:${r.from_service}/${r.from_ingress}`, to: `flow:${r.to_service}/${r.to_ingress}`, type: r.type, ...(r.note ? { note: r.note } : {}) } });
  }
  return out;
}

/** `envs.groups` / `envs.baseline_groups` ([{key, label, icon?, about?}] in display order) as `subsystem` rows. */
export function subsystemRowsOf(json: string | null): ItemRow[] {
  if (!json) return [];
  return (JSON.parse(json) as { key: string; label: string; icon?: string; about?: string; owners?: string[] }[]).map((g, i) => ({ service: '', list: 'subsystem', key: g.key, data: { label: g.label, ...(g.icon ? { icon: g.icon } : {}), ...(g.about ? { about: g.about } : {}), ...(g.owners?.length ? { owners: g.owners } : {}), order: i } }));
}

export interface BaselineRow extends ItemRow { sourceEnv: string; sourceVersion: number | null; takenAt: string }

/** The rows the design was copied from, frozen at copy time. */
export function baselineRows(db: DB, env: string): BaselineRow[] {
  const out = (db.prepare('SELECT service, list, key, data, source_env, source_version, taken_at FROM baseline_items WHERE env = ?').all(env) as any[])
    .map((r) => ({ service: r.service, list: r.list, key: r.key, data: JSON.parse(r.data), sourceEnv: r.source_env, sourceVersion: r.source_version, takenAt: r.taken_at }));
  // The subsystems the design started with (envs.baseline_groups); none when the column is NULL (a sealed environment, or a design from before 0.28 that was never copied).
  const e = db.prepare('SELECT source, copied_at, baseline_groups FROM envs WHERE name = ?').get(env) as { source: string | null; copied_at: string | null; baseline_groups: string | null } | undefined;
  if (e?.baseline_groups) for (const r of subsystemRowsOf(e.baseline_groups)) out.push({ ...r, sourceEnv: e.source ?? env, sourceVersion: null, takenAt: e.copied_at ?? '' });
  return out;
}

/** The rows of the source environments now (core/diff/source-now.ts has the rules); an environment that is gone is passed as null. */
export function sourceNowRows(db: DB, env: string, base: BaselineRow[], copiedAt?: string | null): { rows: ItemRow[]; vanished: Set<string> } {
  const sources = new Map<string, ItemRow[] | null>();
  for (const r of base) if (!sources.has(r.sourceEnv)) sources.set(r.sourceEnv, db.prepare('SELECT 1 FROM envs WHERE name = ?').get(r.sourceEnv) ? envItemRows(db, r.sourceEnv) : null);
  return sourceNow(sources, base, copiedAt);
}

export const rowMap = (rows: ItemRow[]) => new Map(rows.map((r) => [rowId(r), r]));
