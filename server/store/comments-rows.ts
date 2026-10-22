// The row shape and the small validators the comment stores share (comments.ts, comments-import.ts).

import type { DB } from '../db/connection.ts';
import { cleanName, MAX_AUTHOR, type CommentRow } from '../../core/comments.ts';
import { sanitize, tooLong } from '../../core/rich-text.ts';
import { plainText } from '../../core/rich-text-text.ts';
import { HttpError, badRequest, invalid, notFound } from '../errors.ts';
import { getEnvRow } from './envs.ts';

export interface R {
  id: number; env: string; anchor: string; step: string | null; parent_id: number | null; author: string; body: string; created_at: string; edited_at: string | null; deleted_at: string | null;
  external_id: string | null; external_source: string | null; author_external_id: string | null; resolved_at: string | null; resolved_by: string | null;
}
export const toRow = (r: R): CommentRow => ({
  id: r.id, anchor: r.anchor, step: r.step, parentId: r.parent_id, author: r.author, body: r.body, createdAt: r.created_at, editedAt: r.edited_at, deletedAt: r.deleted_at,
  externalId: r.external_id, externalSource: r.external_source, authorExternalId: r.author_external_id, resolvedAt: r.resolved_at, resolvedBy: r.resolved_by,
});
/** What a write answers: the row plus `resolved` (the state lives on a thread's top comment; a reply's own row never carries it). */
export const out = (r: R) => ({ ...toRow(r), resolved: !!r.resolved_at });
export const forbidden = (m: string) => new HttpError(403, 'FORBIDDEN', m);
export const getRow = (db: DB, id: number) => db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as unknown as R;

export function checkEnv(db: DB, env: string) { if (!getEnvRow(db, env)) throw notFound(`environment '${env}'`); }
export function authorOf(a: unknown, what = 'author') {
  const n = typeof a === 'string' ? cleanName(a) : '';
  if (!n) throw badRequest(`${what} is required`);
  if (n.length > MAX_AUTHOR) throw badRequest(`${what} is longer than ${MAX_AUTHOR} characters`);
  return n;
}
export function bodyOf(b: unknown) {
  if (typeof b !== 'string') throw badRequest('body is required');
  const body = sanitize(b);
  if (!plainText(body)) throw invalid('the comment is empty');
  const long = tooLong(body);
  if (long) throw invalid(long);
  return body;
}
