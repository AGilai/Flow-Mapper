// A Full copy keeps the discussion (perf batch 3, F7): authors, times, the importer's ids, the resolved state and the reply structure (new ids).
// Soft-deleted rows come too, empty, so replies keep their parent. Same rows and same id remapping as the per-row version it replaced
// (insert in id order, mentions re-derived from the body, mention_seen as the old syncMentions + markSeen wrote it), but the users registry
// is read once, the statements are prepared once and nothing is looked up per comment.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { mentionIds } from '../../core/mentions.ts';
import type { R } from './comments-rows.ts';

/** What `findUser(id)?.id` answered, for every id at once: the user a merged id went into (at most 20 hops), undefined when unknown. */
export function userResolver(db: DB): (id: string) => string | undefined {
  const into = new Map<string, string | null>();
  for (const r of db.prepare('SELECT id, merged_into FROM users').all() as unknown as { id: string; merged_into: string | null }[]) into.set(r.id, r.merged_into);
  return (id) => {
    let cur = id;
    for (let i = 0; i < 20; i++) {
      if (!into.has(cur)) return undefined;
      const next = into.get(cur);
      if (next) { cur = next; continue; }
      return cur;
    }
    return undefined;
  };
}

export function copyComments(db: DB, from: string, to: string): Map<number, number> {
  const ids = new Map<number, number>();
  const canon = userResolver(db), seenAt = new Date().toISOString();
  const ins = db.prepare('INSERT INTO comments (env, anchor, step, parent_id, author, author_id, body, created_at, edited_at, deleted_at, external_id, external_source, author_external_id, resolved_at, resolved_by, steps_from, steps_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insM = db.prepare('INSERT INTO comment_mentions (comment_id, user_id) VALUES (?, ?)');
  const insS = db.prepare('INSERT OR IGNORE INTO mention_seen (user_id, comment_id, seen_at) VALUES (?, ?, ?)');
  tx(db, () => {
    for (const r of db.prepare('SELECT * FROM comments WHERE env = ? ORDER BY id').all(from) as unknown as R[]) {
      const nid = Number(ins.run(to, r.anchor, r.step, r.parent_id == null ? null : ids.get(r.parent_id) ?? null, r.author, r.author_id, r.body, r.created_at, r.edited_at, r.deleted_at, r.external_id, r.external_source, r.author_external_id, r.resolved_at, r.resolved_by, r.steps_from, r.steps_to).lastInsertRowid);
      ids.set(r.id, nid);
      if (r.deleted_at) continue;
      const want = new Set<string>();
      for (const t of mentionIds(r.body)) { const u = canon(t); if (u) want.add(u); }
      for (const u of want) insM.run(nid, u);
      // a copy's mentions are not news: the author's own first (as the insert marked it), then the others by user id (as the old read-back ordered them)
      if (r.author_id && want.has(r.author_id)) insS.run(r.author_id, nid, seenAt);
      for (const u of [...want].sort()) insS.run(u, nid, seenAt);
    }
  });
  return ids;
}
