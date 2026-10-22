// Reading mentions (0.31.0): who was asked something, across every environment, and what is still unread. A mention is unread for a user until
// a row in `mention_seen` says otherwise (it survives a merge: re-pointed; an edit that adds a mention makes a new unread one). A comment that
// was deleted, or that sits in an environment that is gone, is not listed. Spec: docs/plans/users-mentions.md.

import type { DB } from '../db/connection.ts';
import { plainText } from '../../core/rich-text-text.ts';
import { sanitize } from '../../core/rich-text.ts';
import { parseFlowAnchor } from '../../core/comments.ts';
import { badRequest } from '../errors.ts';
import { getUser, nameIndex } from './users.ts';
import { markSeen } from './mentions.ts';

export interface Mention {
  commentId: number; env: string; anchor: string; service: string; ingress: string; step: string | null; parentId: number | null;
  author: string; authorId: string | null; text: string; html: string; createdAt: string; unread: boolean;
}
interface Row { id: number; env: string; anchor: string; step: string | null; parent_id: number | null; author: string; author_id: string | null; body: string; created_at: string; seen_at: string | null }

/** The user a request means: an id, or (for MCP and scripts) an exact name. */
export function userOf(db: DB, id: unknown): string {
  if (typeof id !== 'string' || !id) throw badRequest('user is required (a user id, or the X-Flow-User header)');
  return getUser(db, id).id;
}

export interface MentionQuery { user: string; unread?: boolean; env?: string | null; anchor?: string | null; limit?: number }

/** Newest first. `unread` keeps only the ones not seen; `env` / `anchor` narrow to one flow. */
export function listMentions(db: DB, q: MentionQuery): Mention[] {
  const user = userOf(db, q.user), names = nameIndex(db);
  const where = ['m.user_id = ?', 'c.deleted_at IS NULL', 'EXISTS (SELECT 1 FROM envs e WHERE e.name = c.env)'], args: (string | number)[] = [user];
  if (q.unread) where.push('s.seen_at IS NULL');
  if (q.env) { where.push('c.env = ?'); args.push(q.env); }
  if (q.anchor) { where.push('c.anchor = ?'); args.push(q.anchor); }
  const rows = db.prepare(`SELECT c.id, c.env, c.anchor, c.step, c.parent_id, c.author, c.author_id, c.body, c.created_at, s.seen_at
    FROM comment_mentions m JOIN comments c ON c.id = m.comment_id LEFT JOIN mention_seen s ON s.user_id = m.user_id AND s.comment_id = m.comment_id
    WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC, c.id DESC LIMIT ?`).all(...args, Math.max(1, Math.min(Number(q.limit) || 200, 1000))) as unknown as Row[];
  return rows.map((r) => {
    const f = parseFlowAnchor(r.anchor) ?? { service: '', ingress: '' }, body = sanitize(r.body);
    return { commentId: r.id, env: r.env, anchor: r.anchor, service: f.service, ingress: f.ingress, step: r.step, parentId: r.parent_id,
      author: (r.author_id && names.get(r.author_id)?.name) || r.author, authorId: r.author_id, text: plainText(body), html: body, createdAt: r.created_at, unread: r.seen_at === null };
  });
}

/** Unread mentions per flow of one environment: `{anchor: n}` (the Flows list's "@ n new"). */
export function unreadCounts(db: DB, user: string, env: string): Record<string, number> {
  const u = userOf(db, user);
  return Object.fromEntries((db.prepare(`SELECT c.anchor, COUNT(*) AS n FROM comment_mentions m JOIN comments c ON c.id = m.comment_id
    LEFT JOIN mention_seen s ON s.user_id = m.user_id AND s.comment_id = m.comment_id
    WHERE m.user_id = ? AND c.env = ? AND c.deleted_at IS NULL AND s.seen_at IS NULL GROUP BY c.anchor`).all(u, env) as unknown as { anchor: string; n: number }[]).map((r) => [r.anchor, r.n]));
}

/** Mark mentions seen for a user. Only comments that really mention that user get a mark; the answer is how many were new. */
export function seen(db: DB, user: string, commentIds: unknown): { marked: number } {
  const u = userOf(db, user);
  if (!Array.isArray(commentIds) || commentIds.some((x) => !Number.isInteger(x))) throw badRequest('commentIds must be a list of comment ids');
  const mine = new Set((db.prepare('SELECT comment_id FROM comment_mentions WHERE user_id = ?').all(u) as unknown as { comment_id: number }[]).map((r) => r.comment_id));
  const todo = (commentIds as number[]).filter((c) => mine.has(c));
  const before = (db.prepare('SELECT COUNT(*) AS n FROM mention_seen WHERE user_id = ?').get(u) as { n: number }).n;
  markSeen(db, u, todo);
  return { marked: (db.prepare('SELECT COUNT(*) AS n FROM mention_seen WHERE user_id = ?').get(u) as { n: number }).n - before };
}
