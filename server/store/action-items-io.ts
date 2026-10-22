// Action items in bulk (0.29.0): a Full copy, the rows for the static preview, and the seed data (samples/action-items/*.json).

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import type { GraphIndex } from '../../core/graph-index.ts';
import { flowAnchor } from '../../core/comments.ts';
import type { ActionItem, ActionEvent, ActionStatus, ActionKind } from '../../core/action-items.ts';
import { HttpError } from '../errors.ts';
import { addItem, updateItem, listItems, type R } from './action-items.ts';

/** A Full copy keeps every item (deleted ones too, so numbers are never reused), their events, and the comment links remapped to the copy's comment ids. */
export function copyActionItems(db: DB, from: string, to: string, commentIds: Map<number, number>) {
  const ins = db.prepare('INSERT INTO action_items (env, anchor, number, owner, description, status, due, step, comment_id, source, created_by, updated_by, created_at, updated_at, closed_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const evs = db.prepare('SELECT kind, actor, at FROM action_item_events WHERE item_id = ? ORDER BY id'), insEv = db.prepare('INSERT INTO action_item_events (item_id, kind, actor, at) VALUES (?, ?, ?, ?)');
  tx(db, () => { for (const r of db.prepare('SELECT * FROM action_items WHERE env = ? ORDER BY id').all(from) as unknown as R[]) {
    const id = Number(ins.run(to, r.anchor, r.number, r.owner, r.description, r.status, r.due, r.step, r.comment_id == null ? null : commentIds.get(r.comment_id) ?? null, r.source, r.created_by, r.updated_by, r.created_at, r.updated_at, r.closed_at, r.deleted_at).lastInsertRowid);
    for (const e of evs.all(r.id) as unknown as { kind: string; actor: string; at: string }[]) insEv.run(id, e.kind, e.actor, e.at);
  } });
}

/** Every live item and event of an env, for the static preview build. */
export function allRows(db: DB, env: string): { items: ActionItem[]; events: ActionEvent[] } {
  const anchors = (db.prepare('SELECT DISTINCT anchor FROM action_items WHERE env = ? AND deleted_at IS NULL').all(env) as unknown as { anchor: string }[]).map((a) => a.anchor);
  const all = anchors.map((a) => listItems(db, env, a));
  return { items: all.flatMap((l) => l.items), events: all.flatMap((l) => l.events) };
}

/** `ago` is minutes before the seed ran; `dueIn` is days from today (negative = overdue). `fromComment` is the author of a top comment on the flow. */
export interface SampleItem {
  service: string; ingress: string; owner: string; description: string; status?: ActionStatus; dueIn?: number; step?: string; fromComment?: string;
  by?: string; closedBy?: string; ago?: number; closedAgo?: number; source?: 'human' | 'ai';
}
const when = (ago?: number) => (ago == null ? null : new Date(Date.now() - ago * 60000).toISOString());
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** Seeding twice adds nothing: a flow that already has an item with the same owner and description is skipped. */
export function loadActionItems(db: DB, g: GraphIndex, env: string, list: SampleItem[], warn: (m: string) => void = () => {}): number {
  let n = 0;
  for (const s of list) {
    try {
      const anchor = flowAnchor(s.service, s.ingress);
      if (listItems(db, env, anchor).items.some((x) => x.owner === s.owner && x.description === s.description.trim())) continue;
      const c = s.fromComment ? db.prepare('SELECT id FROM comments WHERE env = ? AND anchor = ? AND author = ? AND parent_id IS NULL AND deleted_at IS NULL ORDER BY id').get(env, anchor, s.fromComment) as { id: number } | undefined : undefined;
      if (s.fromComment && !c) warn(`no comment by ${s.fromComment} on ${s.service} / ${s.ingress}: item not linked`);
      const by = s.by ?? s.owner;
      const row = addItem(db, g, env, { anchor, owner: s.owner, description: s.description, due: s.dueIn == null ? null : day(s.dueIn), step: s.step ?? null, commentId: c?.id ?? null, actor: by, source: s.source ?? 'human' });
      const status = s.status ?? 'open';
      if (status !== 'open') updateItem(db, g, env, row.id, { actor: s.closedBy ?? s.owner, status });
      const t = when(s.ago);
      if (t) {
        db.prepare('UPDATE action_items SET created_at = ?, updated_at = ?, closed_at = CASE WHEN closed_at IS NULL THEN NULL ELSE ? END WHERE id = ?').run(t, when(s.closedAgo ?? s.ago), when(s.closedAgo ?? s.ago), row.id);
        db.prepare('UPDATE action_item_events SET at = ? WHERE item_id = ? AND kind = ?').run(t, row.id, 'created' satisfies ActionKind);
        db.prepare("UPDATE action_item_events SET at = ? WHERE item_id = ? AND kind != 'created'").run(when(s.closedAgo ?? s.ago), row.id);
      }
      n++;
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      warn(`skipped action item on ${s.service} / ${s.ingress}: ${e.message}`);
    }
  }
  return n;
}
