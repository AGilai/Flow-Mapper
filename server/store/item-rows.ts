// The tables of one environment (or its frozen baseline) as ItemRows (core/item-rows.ts): the one shape the diff and the
// drafts work on. Reads only; nothing here writes.

import type { DB } from '../db/connection.ts';
import { rowId, type ItemRow } from '../../core/item-rows.ts';

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

/**
 * The rows of the source environment, now, for the components a design copied or imported (`against=source`). Each baseline row is
 * looked up in its own `sourceEnv` (a design can hold rows from several; a source that is gone is compared with itself: no drift).
 * Per source: for each baseline service with a header, the source's current rows of it (all lists; `functions` only when the
 * baseline has functions of it: a Components copy brought none) and its DTOs; a component that came in by an import (taken after the
 * design was copied, `copiedAt`) is partial, so only the rows the baseline knows are compared; a baseline service the source does not
 * have is looked up item by item (the synthetic `<source>-infra` that holds copied channels and bindings); env-scoped rows (event
 * DTOs, schemas) whose key is in the baseline. `vanished` = copied components the source no longer has.
 */
export function sourceNowRows(db: DB, env: string, base: BaselineRow[], copiedAt?: string | null): { rows: ItemRow[]; vanished: Set<string> } {
  const out: ItemRow[] = [], vanished = new Set<string>();
  const sources = new Map<string, BaselineRow[]>();
  for (const r of base) sources.set(r.sourceEnv, [...(sources.get(r.sourceEnv) ?? []), r]);
  for (const [source, mine] of sources) {
    if (!db.prepare('SELECT 1 FROM envs WHERE name = ?').get(source)) { out.push(...mine.map(({ service, list, key, data }) => ({ service, list, key, data }))); continue; }
    fromSource(envItemRows(db, source), mine, out, vanished, copiedAt);
  }
  return { rows: out, vanished };
}

function fromSource(src: ItemRow[], base: BaselineRow[], out: ItemRow[], vanished: Set<string>, copiedAt?: string | null) {
  const bySvc = new Map<string, ItemRow[]>();
  for (const r of src) bySvc.set(r.service, [...(bySvc.get(r.service) ?? []), r]);
  const find = (list: string, key: string) => src.find((r) => r.list === list && r.key === key && r.service !== '');
  const known = new Set(base.map((r) => rowId(r)));
  for (const h of base.filter((r) => r.list === 'header')) {
    const mine = bySvc.get(h.service);
    const hasFns = base.some((r) => r.service === h.service && r.list === 'functions');
    const partial = copiedAt != null && h.takenAt !== copiedAt;
    if (mine?.some((r) => r.list === 'header')) { out.push(...mine.filter((r) => (hasFns || r.list !== 'functions') && (!partial || r.list === 'header' || known.has(rowId(r))))); continue; }
    if (h.sourceVersion !== null) { vanished.add(h.service); continue; }
    out.push({ service: h.service, list: 'header', key: '', data: h.data });
    for (const b of base.filter((r) => r.service === h.service && r.list !== 'header')) {
      const hit = b.list === 'bindings' ? bindingOf(src, b.key) : find(b.list, b.key);
      if (hit) out.push({ service: h.service, list: b.list, key: b.key, data: b.list === 'bindings' ? { ...hit.data, id: b.key } : hit.data });
    }
  }
  const keys = new Set(base.filter((r) => r.service === '').map((r) => rowId(r)));
  out.push(...(bySvc.get('') ?? []).filter((r) => keys.has(rowId(r))));
}

/** A binding copied under the synthetic infra owner is keyed `<service>.<id>`: find it in the source by trying each split. */
function bindingOf(src: ItemRow[], key: string): ItemRow | undefined {
  for (let i = key.indexOf('.'); i > 0; i = key.indexOf('.', i + 1)) {
    const hit = src.find((r) => r.list === 'bindings' && r.service === key.slice(0, i) && r.key === key.slice(i + 1));
    if (hit) return hit;
  }
}

export const rowMap = (rows: ItemRow[]) => new Map(rows.map((r) => [rowId(r), r]));
