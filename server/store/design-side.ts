// What a draft's apply writes for the design lists (core/item-rows.ts DESIGN_LISTS): subsystem settings (envs.groups), abstract links and
// flow relations. The ops were validated when they were appended; the apply is the guard.

import type { DB } from '../db/connection.ts';
import type { NetOp } from '../../core/draft-ops.ts';

const now = () => new Date().toISOString();

/** Write the design-list ops in seq order. `subsystem` ops rebuild `envs.groups` (upsert replaces by key or appends, delete drops, then a stable sort by `order`). */
export function writeDesignSide(db: DB, env: string, side: NetOp[], by: string) {
  const subs = side.filter((o) => o.list === 'subsystem');
  if (subs.length) {
    const cur = JSON.parse((db.prepare('SELECT groups FROM envs WHERE name = ?').get(env) as { groups: string }).groups) as { key: string; label: string; icon?: string }[];
    let list = cur.map((g, i) => ({ g, order: i }));
    for (const o of subs) {
      list = list.filter((x) => x.g.key !== o.key);
      if (o.op === 'upsert') { const d = o.data as any; list.push({ g: { key: o.key, label: d.label, ...(d.icon ? { icon: d.icon } : {}) }, order: d.order ?? list.length }); }
    }
    const sorted = list.map((x, i) => ({ ...x, i })).sort((a, b) => a.order - b.order || a.i - b.i).map((x) => x.g);
    db.prepare('UPDATE envs SET groups = ? WHERE name = ?').run(JSON.stringify(sorted), env);
  }
  for (const o of side) {
    const d = o.data as any;
    if (o.list === 'link') {
      if (o.op === 'delete') { db.prepare('DELETE FROM abstract_links WHERE env = ? AND id = ?').run(env, o.key); continue; }
      db.prepare(`INSERT INTO abstract_links (env, id, name, from_ref, to_ref, mode, transport, description, doc, refined_by, author, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (env, id) DO UPDATE SET name = excluded.name, from_ref = excluded.from_ref, to_ref = excluded.to_ref, mode = excluded.mode, transport = excluded.transport,
          description = excluded.description, doc = excluded.doc, refined_by = excluded.refined_by, author = excluded.author, updated_at = excluded.updated_at`)
        .run(env, o.key, d.name, d.from, d.to, d.mode ?? null, d.transport ?? null, d.description ?? null, d.doc === undefined ? null : JSON.stringify(d.doc), JSON.stringify(d.refinedBy ?? []), by.slice(0, 80), now());
    } else if (o.list === 'flowrel') {
      if (o.op === 'delete') { db.prepare('DELETE FROM flow_relations WHERE env = ? AND id = ?').run(env, o.key); continue; }
      const f = /^flow:([^/]+)\/(.+)$/.exec(d.from), t = /^flow:([^/]+)\/(.+)$/.exec(d.to);
      if (!f || !t) continue;
      db.prepare(`INSERT INTO flow_relations (env, id, from_service, from_ingress, to_service, to_ingress, type, note, author, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (env, id) DO UPDATE SET from_service = excluded.from_service, from_ingress = excluded.from_ingress, to_service = excluded.to_service, to_ingress = excluded.to_ingress,
          type = excluded.type, note = excluded.note, author = excluded.author, updated_at = excluded.updated_at`)
        .run(env, o.key, f[1], f[2], t[1], t[2], d.type, d.note ?? null, by.slice(0, 80), now());
    }
  }
}
