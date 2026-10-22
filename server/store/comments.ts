// Comments under a flow (0.27.0, migration 011). Bodies are sanitized HTML (core/rich-text.ts): every write sanitizes, so what is stored
// is what may be shown. Anyone may add; only the author edits or deletes: the request's `author` must equal the stored one. That is
// naive identity, like drafts (there are no accounts); see docs/API.md. A delete is soft and empties the body. Any environment takes
// comments, sealed ones too: they are annotations, like descriptions.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import type { GraphIndex } from '../../core/graph-index.ts';
import { trace } from '../../core/trace.ts';
import { HASH_TRACE, isStepKey, hasStep } from '../../core/description.ts';
import { buildThread, parseFlowAnchor, flowAnchor, type CommentRow, type Thread } from '../../core/comments.ts';
import { sanitize } from '../../core/rich-text.ts';
import { plainText } from '../../core/rich-text-text.ts';
import { HttpError, badRequest, invalid, notFound } from '../errors.ts';
import { commentCreated, commentEdited, commentDeleted } from '../events/emitters.ts';
import { type R, toRow, out, forbidden, getRow, checkEnv, authorOf, bodyOf } from './comments-rows.ts';
import { parseImport, findExternal, applyImported, reimport, takenBy, type ImportFields } from './comments-import.ts';
import { resolveComment } from './comments-import.ts';
export { resolveComment };

function flowOf(anchor: unknown) { const f = parseFlowAnchor(anchor); if (!f) throw badRequest("anchor must be 'flow:<service>/<ingress>'"); return f; }

/** The flow's trace (the graph may be a draft's), 404 when the environment has no such flow. */
function flowTrace(g: GraphIndex, env: string, service: string, ingress: string) {
  return (g.model.services.length ? trace(g, { service, ingress }, HASH_TRACE) : null) ?? (() => { throw notFound(`ingress '${ingress}' of service '${service}' in env '${env}'`); })();
}

export function listThread(db: DB, env: string, anchor: string): Thread {
  checkEnv(db, env); flowOf(anchor);
  // sanitized again on the way out: a row that did not come through a write here (a restore, a hand-made insert) is never served raw
  return buildThread(anchor, (db.prepare('SELECT * FROM comments WHERE env = ? AND anchor = ?').all(env, anchor) as unknown as R[]).map((r) => ({ ...toRow(r), body: sanitize(r.body) })));
}

/** Open discussions per anchor, for the Flows list: `{anchor: n}`, live top comments that are not resolved (anchors with none are absent). */
export function counts(db: DB, env: string): Record<string, number> {
  checkEnv(db, env);
  return Object.fromEntries((db.prepare('SELECT anchor, COUNT(*) AS n FROM comments WHERE env = ? AND deleted_at IS NULL AND parent_id IS NULL AND resolved_at IS NULL GROUP BY anchor').all(env) as unknown as { anchor: string; n: number }[]).map((r) => [r.anchor, r.n]));
}

export interface NewComment extends ImportFields { anchor: string; step?: string | null; parentId?: number | null; author: string; body: string }
export type Written = ReturnType<typeof out> & { updated?: true };

export function addComment(db: DB, g: GraphIndex, env: string, i: NewComment): Written {
  checkEnv(db, env);
  const { service, ingress } = flowOf(i?.anchor);
  const author = authorOf(i.author), body = bodyOf(i.body), x = parseImport(i);
  const t = flowTrace(g, env, service, ingress);
  const step = i.step ?? null;
  if (step !== null && (typeof step !== 'string' || !isStepKey(step) || !hasStep(t, step))) throw badRequest(`step '${step}' is not in the flow ${service} / ${ingress}`);
  if (i.parentId != null && x.parentExternalId !== null) throw badRequest('give parentId or parentExternalId, not both');
  const old = x.externalId !== null ? findExternal(db, env, x.externalSource!, x.externalId) : undefined;
  if (old && old.anchor !== i.anchor) throw takenBy(old.anchor);
  let parent: number | null = null;
  if (i.parentId != null || x.parentExternalId !== null) {
    const p = (i.parentId != null ? db.prepare('SELECT * FROM comments WHERE id = ? AND env = ? AND anchor = ?').get(Number(i.parentId), env, i.anchor) : findExternal(db, env, x.externalSource!, x.parentExternalId!)) as unknown as R | undefined;
    if (!p && i.parentId == null) throw badRequest(`parentExternalId '${x.parentExternalId}' is not a comment of source '${x.externalSource}' in env '${env}'`);
    if (!p) throw notFound(`comment ${i.parentId} under ${i.anchor}`);
    if (p.anchor !== i.anchor) throw badRequest(`parentExternalId '${x.parentExternalId}' belongs to a comment under another flow`);
    if (p.deleted_at) throw invalid('the comment you reply to was deleted');
    parent = p.parent_id ?? p.id; // one level only: a reply to a reply belongs to the top comment
  }
  if (x.resolved === true && (parent !== null || old?.parent_id != null)) throw badRequest('a reply cannot be resolved on its own: resolve its top comment');
  if (old) return { ...out(reimport(db, env, old, x, { author, body, step })), updated: true };
  const at = x.createdAt ?? new Date().toISOString();
  const id = Number(db.prepare('INSERT INTO comments (env, anchor, step, parent_id, author, body, created_at, external_id, external_source, author_external_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(env, i.anchor, step, parent, author, body, at, x.externalId, x.externalSource, x.authorExternalId).lastInsertRowid);
  commentCreated(db, { env, anchor: i.anchor, id, author, text: plainText(body) });
  if (parent === null) applyImported(db, env, id, x, author);
  return out(getRow(db, id));
}

function mine(db: DB, env: string, id: number, author: unknown): R {
  checkEnv(db, env);
  const r = db.prepare('SELECT * FROM comments WHERE id = ? AND env = ?').get(Number(id), env) as unknown as R | undefined;
  if (!r || r.deleted_at) throw notFound(`comment ${id}`);
  if (authorOf(author) !== r.author) throw forbidden('only the author can change a comment');
  return r;
}

export function editComment(db: DB, env: string, id: number, i: { author: string; body: string }) {
  const r = mine(db, env, id, i?.author), body = bodyOf(i.body);
  db.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?').run(body, new Date().toISOString(), r.id);
  commentEdited(db, { env, anchor: r.anchor, id: r.id, author: r.author, text: plainText(body) });
  return out(getRow(db, r.id));
}

export function deleteComment(db: DB, env: string, id: number, author: unknown): { deleted: number } {
  const r = mine(db, env, id, author);
  db.prepare("UPDATE comments SET deleted_at = ?, body = '' WHERE id = ?").run(new Date().toISOString(), r.id);
  commentDeleted(db, { env, anchor: r.anchor, id: r.id, author: r.author });
  return { deleted: r.id };
}

/** A Full copy keeps the discussion: authors, times, the importer's ids, the resolved state and the reply structure (new ids). Soft-deleted rows come too, empty, so replies keep their parent. */
export function copyComments(db: DB, from: string, to: string): Map<number, number> {
  const ids = new Map<number, number>();
  const ins = db.prepare('INSERT INTO comments (env, anchor, step, parent_id, author, body, created_at, edited_at, deleted_at, external_id, external_source, author_external_id, resolved_at, resolved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  tx(db, () => { for (const r of db.prepare('SELECT * FROM comments WHERE env = ? ORDER BY id').all(from) as unknown as R[]) {
    ids.set(r.id, Number(ins.run(to, r.anchor, r.step, r.parent_id == null ? null : ids.get(r.parent_id) ?? null, r.author, r.body, r.created_at, r.edited_at, r.deleted_at, r.external_id, r.external_source, r.author_external_id, r.resolved_at, r.resolved_by).lastInsertRowid));
  } });
  return ids;
}

/** Every row of an env, for the static preview build. */
export const allRows = (db: DB, env: string): CommentRow[] => (db.prepare('SELECT * FROM comments WHERE env = ? ORDER BY id').all(env) as unknown as R[]).map(toRow);

/** `ago` is minutes before the seed ran, so the demo always reads "2 days ago" and not a fixed date. */
export interface SampleComment { service: string; ingress: string; step?: string; author: string; body: string; ago?: number; edited?: boolean; externalId?: string; externalSource?: string; authorExternalId?: string; resolved?: boolean; resolvedBy?: string; replies?: { author: string; body: string; ago?: number }[] }
const when = (ago?: number) => (ago == null ? null : new Date(Date.now() - ago * 60000).toISOString());

/** Seed data (samples/comments/*.json). Seeding twice adds nothing: a flow that already has a comment with the same author and body is skipped. */
export function loadComments(db: DB, g: GraphIndex, env: string, list: SampleComment[], warn: (m: string) => void = () => {}): number {
  let n = 0;
  for (const c of list) {
    try {
      const anchor = flowAnchor(c.service, c.ingress);
      const have = listThread(db, env, anchor).comments;
      if (have.some((x) => x.author === c.author && x.body === sanitize(c.body))) continue;
      const row = addComment(db, g, env, { anchor, step: c.step ?? null, author: c.author, body: c.body, externalId: c.externalId, externalSource: c.externalSource, authorExternalId: c.authorExternalId });
      db.prepare('UPDATE comments SET created_at = COALESCE(?, created_at), edited_at = ? WHERE id = ?').run(when(c.ago), c.edited ? when(Math.max(0, (c.ago ?? 0) - 30)) ?? row.createdAt : null, row.id);
      n++;
      if (c.resolved) { resolveComment(db, env, row.id, { actor: c.resolvedBy ?? c.author, resolved: true }); db.prepare('UPDATE comments SET resolved_at = ? WHERE id = ?').run(when(Math.max(0, (c.ago ?? 0) - 120)) ?? new Date().toISOString(), row.id); }
      for (const r of c.replies ?? []) { const x = addComment(db, g, env, { anchor, parentId: row.id, author: r.author, body: r.body }); db.prepare('UPDATE comments SET created_at = COALESCE(?, created_at) WHERE id = ?').run(when(r.ago), x.id); n++; }
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      warn(`skipped comment on ${c.service} / ${c.ingress}: ${e.message}`);
    }
  }
  return n;
}
