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
  return out;
}

export interface BaselineRow extends ItemRow { sourceEnv: string; sourceVersion: number | null; takenAt: string }

/** The rows the design was copied from, frozen at copy time. */
export function baselineRows(db: DB, env: string): BaselineRow[] {
  return (db.prepare('SELECT service, list, key, data, source_env, source_version, taken_at FROM baseline_items WHERE env = ?').all(env) as any[])
    .map((r) => ({ service: r.service, list: r.list, key: r.key, data: JSON.parse(r.data), sourceEnv: r.source_env, sourceVersion: r.source_version, takenAt: r.taken_at }));
}

/** The rows of the source environments now (core/diff/source-now.ts has the rules); an environment that is gone is passed as null. */
export function sourceNowRows(db: DB, env: string, base: BaselineRow[], copiedAt?: string | null): { rows: ItemRow[]; vanished: Set<string> } {
  const sources = new Map<string, ItemRow[] | null>();
  for (const r of base) if (!sources.has(r.sourceEnv)) sources.set(r.sourceEnv, db.prepare('SELECT 1 FROM envs WHERE name = ?').get(r.sourceEnv) ? envItemRows(db, r.sourceEnv) : null);
  return sourceNow(sources, base, copiedAt);
}

export const rowMap = (rows: ItemRow[]) => new Map(rows.map((r) => [rowId(r), r]));
