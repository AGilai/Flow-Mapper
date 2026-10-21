// What a draft's apply writes outside manifests: endpoint DTOs, event DTOs, store schemas and flow texts, through the
// unguarded row writers (the draft's apply is the guard). The ops were validated when they were appended.

import type { DB } from '../db/connection.ts';
import type { GraphIndex } from '../../core/graph-index.ts';
import { stores } from '../../core/stores.ts';
import type { NetOp } from '../../core/draft-ops.ts';
import { HttpError } from '../errors.ts';
import { deleteDtoRow, deleteEventDtoRow, putDtoRow, putEventDtoRow } from './dtos.ts';
import { deleteSchemaRow, putSchemaRow } from './schemas.ts';
import { putHuman } from './descriptions.ts';
import { putFlowLinks } from './flow-links.ts';

const ignoreMissing = (f: () => unknown) => { try { f(); } catch (e) { if (!(e instanceof HttpError && e.status === 404)) throw e; } };
const bar = (key: string): [string, string] => { const i = key.lastIndexOf('|'); return [key.slice(0, i), key.slice(i + 1)]; };

/** The flow's description as one text: the description, then its steps as a numbered list (per-step texts come later). */
function flowText(d: any): string {
  const steps = Array.isArray(d.steps) ? d.steps.map((s: any, i: number) => `${s.n ?? i + 1}. ${s.text ?? ''}`.trimEnd()) : [];
  return [String(d.description ?? '').trim(), ...steps].filter(Boolean).join('\n').slice(0, 4000);
}

/** Write the side ops in seq order. Returns warnings (a flow text that could not be stored because the flow does not trace). */
export function writeSide(db: DB, env: string, side: NetOp[], g: GraphIndex, by: string): string[] {
  const known = new Set(stores(g).map((s) => s.key)), warnings: string[] = [];
  for (const o of side) {
    const d = o.data as any;
    if (o.list === 'dto') {
      const [rest, status] = bar(o.key), [ingress, role] = bar(rest);
      if (o.op === 'upsert') putDtoRow(db, env, { service: o.service, ingress, role, status, content: d.content, meta: d.meta ?? undefined });
      else ignoreMissing(() => deleteDtoRow(db, env, o.service, ingress, role, status));
    } else if (o.list === 'event_dto') {
      if (o.op === 'upsert') putEventDtoRow(db, env, { event: o.key, content: d.content, meta: d.meta ?? undefined });
      else ignoreMissing(() => deleteEventDtoRow(db, env, o.key));
    } else if (o.list === 'schema') {
      const [key, source] = bar(o.key);
      if (o.op === 'upsert') putSchemaRow(db, env, { key, source, content: d }, (k) => known.has(k));
      else ignoreMissing(() => deleteSchemaRow(db, env, key, source));
    } else if (o.list === 'flow') {
      if (o.op === 'delete') { db.prepare('DELETE FROM flow_names WHERE env = ? AND service = ? AND ingress = ?').run(env, o.service, o.key); putFlowLinks(db, env, o.service, o.key, null); continue; }
      if (d.links !== undefined) putFlowLinks(db, env, o.service, o.key, d.links, by); // null clears
      if (typeof d.name === 'string' && !d.name.trim()) db.prepare('DELETE FROM flow_names WHERE env = ? AND service = ? AND ingress = ?').run(env, o.service, o.key); // '' clears the name
      else if (typeof d.name === 'string') {
        db.prepare(`INSERT INTO flow_names (env, service, ingress, name, author, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (env, service, ingress) DO UPDATE SET name = excluded.name, author = excluded.author, updated_at = excluded.updated_at`)
          .run(env, o.service, o.key, d.name.trim().slice(0, 200), by.slice(0, 80), new Date().toISOString());
      }
      const text = flowText(d);
      if (text) {
        try { putHuman(db, g, env, { service: o.service, ingress: o.key, text, editedBy: by }); }
        catch (e) { if (!(e instanceof HttpError)) throw e; warnings.push(`flow ${o.service}/${o.key}: description not stored (${e.message})`); }
      }
    }
  }
  return warnings;
}
