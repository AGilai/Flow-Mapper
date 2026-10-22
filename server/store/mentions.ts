// @mentions in comment bodies (0.31.0): the token `@[userId]` (core/mentions.ts). Writes resolve the `@{Display Name}` form to tokens and keep
// `comment_mentions` (who a comment points at) in step with the body; the reads (unread, seen) are in mentions-read.ts. Spec: docs/plans/users-mentions.md.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { mentionIds, resolveNamed } from '../../core/mentions.ts';
import { ensureUser, findUser } from './users.ts';

/** `@{Display Name}` -> `@[id]`: the name is matched to a user (external id never, name or alias) and a user is created when none matches (first use). */
export function resolveMentions(db: DB, body: string): string {
  return resolveNamed(body, (name) => { try { return ensureUser(db, { name })?.id ?? null; } catch { return null; } });
}

/** Rows of `comment_mentions` for a comment: one per distinct known user in its body. A mention that went out of the body loses its seen mark (a new one is unread again). */
export function syncMentions(db: DB, commentId: number, body: string, authorId: string | null = null) {
  const want = new Set<string>();
  for (const id of mentionIds(body)) { const u = findUser(db, id); if (u) want.add(u.id); }
  const have = (db.prepare('SELECT user_id FROM comment_mentions WHERE comment_id = ?').all(commentId) as unknown as { user_id: string }[]).map((r) => r.user_id);
  tx(db, () => {
    for (const u of have) if (!want.has(u)) { db.prepare('DELETE FROM comment_mentions WHERE comment_id = ? AND user_id = ?').run(commentId, u); db.prepare('DELETE FROM mention_seen WHERE comment_id = ? AND user_id = ?').run(commentId, u); }
    for (const u of want) if (!have.includes(u)) {
      db.prepare('INSERT INTO comment_mentions (comment_id, user_id) VALUES (?, ?)').run(commentId, u);
      if (u === authorId) markSeen(db, u, [commentId]); // mentioning yourself is not news
    }
  });
}

export function markSeen(db: DB, userId: string, commentIds: number[]) {
  const at = new Date().toISOString(), ins = db.prepare('INSERT OR IGNORE INTO mention_seen (user_id, comment_id, seen_at) VALUES (?, ?, ?)');
  for (const c of commentIds) ins.run(userId, c, at);
}
