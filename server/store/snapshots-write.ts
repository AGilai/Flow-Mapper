// Internal write helpers shared by ingest and CRUD: diff, integrity, entity/snapshot/changelog rows.

import type { DB } from '../db/connection.ts';
import { LISTS, keyOf, type ListName } from '../schema.ts';
import { integrityErrors } from '../../core/integrity.ts';
import { invalid } from '../errors.ts';
import type { Changes, Entities, Source } from './snapshots-read.ts';

export const now = () => new Date().toISOString();

export function diff(before: Entities, after: Entities): Changes {
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

export function assertIntegrity(service: string, e: Entities, before?: Entities) {
  const had = new Set(before ? integrityErrors(before) : []);
  const errs = integrityErrors(e).filter((x) => !had.has(x));
  if (errs.length) throw invalid(`service '${service}' has broken internal references`, errs);
}

export function replaceEntities(db: DB, env: string, service: string, e: Entities) {
  db.prepare('DELETE FROM entities WHERE env = ? AND service = ?').run(env, service);
  const ins = db.prepare('INSERT INTO entities (env, service, list, key, data) VALUES (?, ?, ?, ?, ?)');
  for (const l of LISTS) for (const x of e[l] ?? []) ins.run(env, service, l, keyOf(l, x), JSON.stringify(x));
}

export function writeChangelog(db: DB, env: string, service: string, from: number | null, to: number | null, kind: string, source: Source, changes: unknown): number {
  const r = db.prepare('INSERT INTO changelog (env, service, from_version, to_version, kind, source, at, changes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(env, service, from, to, kind, source, now(), JSON.stringify(changes));
  return Number(r.lastInsertRowid);
}

export function upsertSnapshot(db: DB, env: string, svc: { name: string; kind?: string; [k: string]: unknown }, version: number, harvestedAt: string, commit?: string) {
  const { name, kind, ...meta } = svc;
  db.prepare(`INSERT INTO snapshots (env, service, kind, meta, version, harvested_at, commit_sha, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (env, service) DO UPDATE SET kind = excluded.kind, meta = excluded.meta, version = excluded.version,
      harvested_at = excluded.harvested_at, commit_sha = excluded.commit_sha, updated_at = excluded.updated_at`)
    .run(env, name, kind ?? 'service', JSON.stringify(meta), version, harvestedAt, commit ?? null, now());
}
