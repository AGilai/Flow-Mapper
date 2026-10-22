// A user merge reaches the owners and the mentions inside an About (0.33.0): `owners: [userId]` of a component header and a subsystem, and `@[userId]` in an about,
// live in JSON (the headers of every environment, their subsystems, the baselines and the open drafts' ops). The merged id is replaced by the surviving one there;
// an owners list that then names the same person twice keeps one.

import type { DB } from '../db/connection.ts';
import { cleanOwners } from '../../core/owners.ts';

const SPOTS: [table: string, column: string][] = [['snapshots', 'meta'], ['envs', 'groups'], ['envs', 'baseline_groups'], ['baseline_items', 'data'], ['draft_ops', 'data']];

/** `owners` lists without duplicates, anywhere in a parsed JSON value. */
function dedupe(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dedupe);
  if (v && typeof v === 'object') {
    const o = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, k === 'owners' && Array.isArray(x) ? cleanOwners(x) ?? [] : dedupe(x)]));
    if (Array.isArray(o.owners) && !o.owners.length) delete o.owners;
    return o;
  }
  return v;
}

/** Replace user id `from` by `into` in the owners and about mentions of every header, subsystem, baseline and draft op. Returns how many rows changed. Call inside the merge transaction. */
export function repointOwnerIds(db: DB, from: string, into: string): number {
  let n = 0;
  for (const [table, column] of SPOTS) {
    const rows = db.prepare(`SELECT rowid AS r, ${column} AS v FROM ${table} WHERE ${column} LIKE ?`).all(`%${from}%`) as unknown as { r: number; v: string }[];
    for (const { r, v } of rows) {
      let next: string;
      try { next = JSON.stringify(dedupe(JSON.parse(v.split(from).join(into)))); } catch { continue; }
      if (next !== v) { db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`).run(next, r); n++; }
    }
  }
  return n;
}
