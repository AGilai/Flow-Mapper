// Flow names: a short title for a flow (an entry point), next to its description. An annotation like descriptions, so it is allowed in
// every environment, sealed ones included, and needs no draft. In a design a rename can also go through a draft (a `flow:` op, applied
// with it); this file is the direct path.

import type { DB } from '../db/connection.ts';
import { netOps } from '../../core/draft-ops.ts';
import type { GraphIndex } from '../../core/graph-index.ts';
import { sid } from '../../core/graph-index.ts';
import { HttpError, notFound } from '../errors.ts';
import { getDraft, loadOps } from './drafts.ts';
import { getEnvRow } from './envs.ts';

export interface FlowName { service: string; ingress: string; name: string; author: string | null; updatedAt: string }

export function listFlowNames(db: DB, env: string, draft?: string | null): FlowName[] {
  if (!getEnvRow(db, env)) throw notFound(`environment '${env}'`);
  const out = new Map<string, FlowName>();
  for (const r of db.prepare('SELECT service, ingress, name, author, updated_at FROM flow_names WHERE env = ? ORDER BY service, ingress').all(env) as any[]) {
    out.set(`${r.service}/${r.ingress}`, { service: r.service, ingress: r.ingress, name: r.name, author: r.author, updatedAt: r.updated_at });
  }
  if (draft) {
    for (const o of netOps(loadOps(db, getDraft(db, env, draft).id))) {
      if (o.list !== 'flow') continue;
      const k = `${o.service}/${o.key}`, name = o.op === 'upsert' ? (o.data as any)?.name : undefined;
      if (o.op === 'delete' || name === '') out.delete(k);
      else if (typeof name === 'string') out.set(k, { service: o.service, ingress: o.key, name, author: o.author, updatedAt: o.at });
    }
  }
  return [...out.values()].sort((a, b) => (a.service + a.ingress < b.service + b.ingress ? -1 : 1));
}

/** Set (or, with '', remove) the name of a flow. The entry must be an ingress of the environment's graph (422 NO_INGRESS). */
export function putFlowName(db: DB, g: GraphIndex, env: string, i: { service: string; ingress: string; name: unknown; author?: string }): { service: string; ingress: string; name: string | null } {
  if (!getEnvRow(db, env)) throw notFound(`environment '${env}'`);
  if (typeof i.service !== 'string' || typeof i.ingress !== 'string' || typeof i.name !== 'string') throw new HttpError(422, 'INVALID', 'service, ingress and name are required strings');
  if (!g.ingress.has(sid(i.service, i.ingress))) throw new HttpError(422, 'NO_INGRESS', `'${i.ingress}' is not an endpoint of '${i.service}' in environment '${env}'`);
  const name = i.name.trim();
  if (name.length > 200) throw new HttpError(422, 'INVALID', 'name is at most 200 characters');
  if (!name) { db.prepare('DELETE FROM flow_names WHERE env = ? AND service = ? AND ingress = ?').run(env, i.service, i.ingress); return { service: i.service, ingress: i.ingress, name: null }; }
  db.prepare(`INSERT INTO flow_names (env, service, ingress, name, author, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (env, service, ingress) DO UPDATE SET name = excluded.name, author = excluded.author, updated_at = excluded.updated_at`)
    .run(env, i.service, i.ingress, name, String(i.author ?? 'anonymous').slice(0, 80), new Date().toISOString());
  return { service: i.service, ingress: i.ingress, name };
}
