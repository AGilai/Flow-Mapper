// Links of flows (migration 009): {main?, sub?} per entry point, next to the flow names. Written by an applied draft's flow op or the flow-names PUT.

import type { DB } from '../db/connection.ts';
import type { Links } from '../../core/links.ts';

export function flowLinks(db: DB, env: string, service: string, ingress: string): Links | undefined {
  const r = db.prepare('SELECT links FROM flow_links WHERE env = ? AND service = ? AND ingress = ?').get(env, service, ingress) as { links: string } | undefined;
  return r ? JSON.parse(r.links) : undefined;
}

/** Every flow's links of an environment, by `<service>/<ingress>`. */
export function allFlowLinks(db: DB, env: string): Map<string, Links> {
  const rows = db.prepare('SELECT service, ingress, links FROM flow_links WHERE env = ?').all(env) as { service: string; ingress: string; links: string }[];
  return new Map(rows.map((r) => [`${r.service}/${r.ingress}`, JSON.parse(r.links)]));
}

/** Store the links of a flow; null (or none) removes them. The caller has checked them. */
export function putFlowLinks(db: DB, env: string, service: string, ingress: string, links: Links | null | undefined, author = 'anonymous') {
  if (!links) { db.prepare('DELETE FROM flow_links WHERE env = ? AND service = ? AND ingress = ?').run(env, service, ingress); return; }
  db.prepare(`INSERT INTO flow_links (env, service, ingress, links, author, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (env, service, ingress) DO UPDATE SET links = excluded.links, author = excluded.author, updated_at = excluded.updated_at`)
    .run(env, service, ingress, JSON.stringify(links), author.slice(0, 80), new Date().toISOString());
}
