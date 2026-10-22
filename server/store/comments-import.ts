// Comments for importers (0.29.2, bug #66, migration 014): the fields an importer sets on a comment (its time, its own ids, the resolved
// state), the re-import that updates a comment it already created, and resolve / reopen. Spec: docs/plans/comments-import.md.

import type { DB } from '../db/connection.ts';
import { isoTime, MAX_EXTERNAL } from '../../core/comments.ts';
import { plainText } from '../../core/rich-text-text.ts';
import { badRequest, notFound, conflict } from '../errors.ts';
import { commentEdited, commentResolved } from '../events/emitters.ts';
import { type R, checkEnv, authorOf, getRow } from './comments-rows.ts';
import { identify } from '../identity.ts';

export interface ImportFields {
  createdAt?: string; externalId?: string; externalSource?: string; authorExternalId?: string; parentExternalId?: string;
  resolved?: boolean; resolvedBy?: string; resolvedAt?: string;
}
export interface Imported {
  createdAt: string | null; externalId: string | null; externalSource: string | null; authorExternalId: string | null; parentExternalId: string | null;
  resolved: boolean | undefined; resolvedBy: string | null; resolvedAt: string | null;
}

const ext = (v: unknown, what: string): string | null => {
  if (v == null) return null;
  if (typeof v !== 'string' || !v.trim()) throw badRequest(`${what} must be a non-empty string`);
  if (v.length > MAX_EXTERNAL) throw badRequest(`${what} is longer than ${MAX_EXTERNAL} characters`);
  return v;
};

/** Validates the importer's fields; nothing is written. `now` is injectable for tests. */
export function parseImport(i: ImportFields | undefined, now = Date.now()): Imported {
  const t = (what: string, v: unknown) => {
    if (v == null) return null;
    const iso = isoTime(v);
    if (!iso) throw badRequest(`${what} must be an ISO 8601 time`);
    if (Date.parse(iso) > now + 5 * 60000) throw badRequest(`${what} is in the future`);
    return iso;
  };
  const externalId = ext(i?.externalId, 'externalId'), externalSource = ext(i?.externalSource, 'externalSource');
  if ((externalId === null) !== (externalSource === null)) throw badRequest('externalId and externalSource go together: give both or neither');
  const parentExternalId = ext(i?.parentExternalId, 'parentExternalId');
  if (parentExternalId !== null && externalSource === null) throw badRequest('parentExternalId needs externalSource (the parent is looked up in that source)');
  if (i?.resolved !== undefined && typeof i.resolved !== 'boolean') throw badRequest('resolved must be true or false');
  return {
    createdAt: t('createdAt', i?.createdAt), externalId, externalSource, authorExternalId: ext(i?.authorExternalId, 'authorExternalId'), parentExternalId,
    resolved: i?.resolved, resolvedBy: i?.resolvedBy == null ? null : authorOf(i.resolvedBy, 'resolvedBy'), resolvedAt: t('resolvedAt', i?.resolvedAt),
  };
}

export const findExternal = (db: DB, env: string, source: string, id: string) =>
  db.prepare('SELECT * FROM comments WHERE env = ? AND external_source = ? AND external_id = ?').get(env, source, id) as unknown as R | undefined;

/** Sets or clears the state on a top comment and emits the event when it actually changed. */
export function setResolved(db: DB, env: string, id: number, at: string | null, by: string) {
  const r = getRow(db, id);
  if (!!r.resolved_at === !!at) return;
  db.prepare('UPDATE comments SET resolved_at = ?, resolved_by = ? WHERE id = ?').run(at, at ? by : null, id);
  commentResolved(db, { env, anchor: r.anchor, id, author: by, resolved: !!at });
}

/** What an import says about the state of a top comment (nothing when `resolved` is absent). */
export function applyImported(db: DB, env: string, id: number, x: Imported, author: string) {
  if (x.resolved === undefined) return;
  setResolved(db, env, id, x.resolved ? x.resolvedAt ?? new Date().toISOString() : null, x.resolvedBy ?? author);
  if (x.resolved && x.resolvedBy) db.prepare('UPDATE comments SET resolved_by = ? WHERE id = ?').run(x.resolvedBy, id);
}

/** A POST whose (externalSource, externalId) exists: the comment is updated (body, author, step, time, resolved), never duplicated. A deleted one comes back. */
export function reimport(db: DB, env: string, old: R, x: Imported, v: { author: string; authorId: string | null; body: string; step: string | null }): R {
  const now = new Date().toISOString(), changed = old.body !== v.body;
  db.prepare('UPDATE comments SET author = ?, author_id = COALESCE(?, author_id), body = ?, step = ?, created_at = ?, author_external_id = COALESCE(?, author_external_id), edited_at = ?, deleted_at = NULL WHERE id = ?')
    .run(v.author, v.authorId, v.body, v.step, x.createdAt ?? old.created_at, x.authorExternalId, changed || old.deleted_at ? now : old.edited_at, old.id);
  if (changed) commentEdited(db, { env, anchor: old.anchor, id: old.id, author: v.author, text: plainText(v.body) });
  if (old.parent_id == null) applyImported(db, env, old.id, x, v.author);
  return getRow(db, old.id);
}

/** Anyone may resolve or reopen a thread (the `actor` is kept in `resolvedBy`); only a top comment can be, its replies follow it. */
export function resolveComment(db: DB, env: string, id: number, i: { actor?: unknown; author?: unknown; userId?: string | null; resolved?: unknown }): R {
  checkEnv(db, env);
  const by = identify(db, { userId: i?.userId, name: i?.actor ?? i?.author, what: 'actor' }).name;
  if (typeof i.resolved !== 'boolean') throw badRequest('resolved must be true or false');
  const r = db.prepare('SELECT * FROM comments WHERE id = ? AND env = ?').get(Number(id), env) as unknown as R | undefined;
  if (!r || r.deleted_at) throw notFound(`comment ${id}`);
  if (r.parent_id != null) throw badRequest('a reply cannot be resolved on its own: resolve its top comment');
  setResolved(db, env, r.id, i.resolved ? new Date().toISOString() : null, by);
  return getRow(db, r.id);
}

export const takenBy = (anchor: string) => conflict('EXTERNAL_ID_TAKEN', `that externalId already belongs to a comment under ${anchor}`);
