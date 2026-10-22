// Comments under a flow (0.27.0, migration 011). Bodies are sanitized HTML (core/rich-text.ts): every write sanitizes, so what is stored
// is what may be shown. Anyone may add; only the author edits or deletes: the request's `author` must equal the stored one. That is
// naive identity, like drafts (there are no accounts); see docs/API.md. A delete is soft and empties the body. Any environment takes
// comments, sealed ones too: they are annotations, like descriptions.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import type { GraphIndex } from '../../core/graph-index.ts';
import { isStepKey } from '../../core/description.ts';
import { requireFlow, flowSteps, hasStepIn } from './flow-check.ts';
import { buildThread, parseFlowAnchor, flowAnchor, type CommentRow, type Thread } from '../../core/comments.ts';
import { sanitize } from '../../core/rich-text.ts';
import { plainText } from '../../core/rich-text-text.ts';
import { HttpError, badRequest, invalid, notFound } from '../errors.ts';
import { commentCreated, commentEdited, commentDeleted } from '../events/emitters.ts';
import { type R, toRow, out, forbidden, getRow, checkEnv, bodyOf } from './comments-rows.ts';
import { identify, type Caller } from '../identity.ts';
import { nameIndex } from './users.ts';
import { resolveMentions, syncMentions, markSeen } from './mentions.ts';

const bodyIn = (db: DB, b: unknown) => bodyOf(typeof b === 'string' ? resolveMentions(db, b) : b); // `@{Name}` becomes `@[id]` before the sanitizer sees it
import { checkRange } from './comments-range.ts';
import { parseImport, findExternal, applyImported, reimport, takenBy, type ImportFields } from './comments-import.ts';
import { resolveComment } from './comments-import.ts';
export { resolveComment };

function flowOf(anchor: unknown) { const f = parseFlowAnchor(anchor); if (!f) throw badRequest("anchor must be 'flow:<service>/<ingress>'"); return f; }

export function listThread(db: DB, env: string, anchor: string): Thread {
  checkEnv(db, env); flowOf(anchor);
  const names = nameIndex(db); // the author shows under the user's current name (a rename or merge changes old comments too)
  // sanitized again on the way out: a row that did not come through a write here (a restore, a hand-made insert) is never served raw
  return buildThread(anchor, (db.prepare('SELECT * FROM comments WHERE env = ? AND anchor = ?').all(env, anchor) as unknown as R[]).map((r) => ({ ...toRow(r), body: sanitize(r.body), author: (r.author_id && names.get(r.author_id)?.name) || r.author })));
}

/** Open discussions per anchor, for the Flows list: `{anchor: n}`, live top comments that are not resolved (anchors with none are absent). */
export function counts(db: DB, env: string): Record<string, number> {
  checkEnv(db, env);
  return Object.fromEntries((db.prepare('SELECT anchor, COUNT(*) AS n FROM comments WHERE env = ? AND deleted_at IS NULL AND parent_id IS NULL AND resolved_at IS NULL GROUP BY anchor').all(env) as unknown as { anchor: string; n: number }[]).map((r) => [r.anchor, r.n]));
}

/** `author` (a name) or `authorId` (a user id, from X-Flow-User) says who writes; with neither the call is refused. */
export interface NewComment extends ImportFields { anchor: string; step?: string | null; steps?: { from: string; to: string } | null; parentId?: number | null; author?: string; authorId?: string | null; body: string }
export type Written = ReturnType<typeof out> & { updated?: true };

export function addComment(db: DB, g: GraphIndex, env: string, i: NewComment): Written {
  checkEnv(db, env);
  const { service, ingress } = flowOf(i?.anchor);
  const body = bodyIn(db, i.body), x = parseImport(i);
  const who = identify(db, { userId: i.authorId, name: i.author, source: x.externalSource, externalId: x.authorExternalId }), author = who.name;
  const step = i.step ?? null; // 404 for a missing flow is a lookup; the trace is only built (once per graph) when a step or a range is given
  const fs = step !== null || (i.steps !== undefined && i.steps !== null) ? flowSteps(g, env, service, ingress) : (requireFlow(g, env, service, ingress), null);
  if (step !== null && (typeof step !== 'string' || !isStepKey(step) || !hasStepIn(fs!, step))) throw badRequest(`step '${step}' is not in the flow ${service} / ${ingress}`);
  const range = checkRange(i.steps, step, i.parentId != null || x.parentExternalId !== null, fs?.t as never, `${service} / ${ingress}`); // 0.34.0
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
  if (old) { const row = reimport(db, env, old, x, { author, authorId: who.id, body, step }); syncMentions(db, row.id, row.body, row.author_id); return { ...out(row), updated: true }; }
  const at = x.createdAt ?? new Date().toISOString();
  const id = Number(db.prepare('INSERT INTO comments (env, anchor, step, parent_id, author, author_id, body, created_at, external_id, external_source, author_external_id, steps_from, steps_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(env, i.anchor, step, parent, author, who.id, body, at, x.externalId, x.externalSource, x.authorExternalId, range?.from ?? null, range?.to ?? null).lastInsertRowid);
  syncMentions(db, id, body, who.id);
  commentCreated(db, { env, anchor: i.anchor, id, author, text: plainText(body) });
  if (parent === null) applyImported(db, env, id, x, author);
  return out(getRow(db, id));
}

/** Only the author changes a comment: by user id when the row has one (a rename does not lock the author out), else by the stored name. */
function mine(db: DB, env: string, id: number, who: Caller): R {
  checkEnv(db, env);
  const r = db.prepare('SELECT * FROM comments WHERE id = ? AND env = ?').get(Number(id), env) as unknown as R | undefined;
  if (!r || r.deleted_at) throw notFound(`comment ${id}`);
  if (r.author_id ? r.author_id !== who.id : r.author !== who.name) throw forbidden('only the author can change a comment');
  return r;
}
const caller = (db: DB, i: { author?: unknown; authorId?: string | null }) => identify(db, { userId: i.authorId, name: i.author }, false);

export function editComment(db: DB, env: string, id: number, i: { author?: string; authorId?: string | null; body: string }) {
  const r = mine(db, env, id, caller(db, i ?? {})), body = bodyIn(db, i.body);
  db.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?').run(body, new Date().toISOString(), r.id);
  syncMentions(db, r.id, body, r.author_id);
  commentEdited(db, { env, anchor: r.anchor, id: r.id, author: r.author, text: plainText(body) });
  return out(getRow(db, r.id));
}

export function deleteComment(db: DB, env: string, id: number, author: unknown, authorId?: string | null): { deleted: number } {
  const r = mine(db, env, id, caller(db, { author, authorId }));
  db.prepare("UPDATE comments SET deleted_at = ?, body = '' WHERE id = ?").run(new Date().toISOString(), r.id);
  commentDeleted(db, { env, anchor: r.anchor, id: r.id, author: r.author });
  return { deleted: r.id };
}

/** A Full copy keeps the discussion: authors, times, the importer's ids, the resolved state and the reply structure (new ids). Soft-deleted rows come too, empty, so replies keep their parent. */
export function copyComments(db: DB, from: string, to: string): Map<number, number> {
  const ids = new Map<number, number>();
  const ins = db.prepare('INSERT INTO comments (env, anchor, step, parent_id, author, author_id, body, created_at, edited_at, deleted_at, external_id, external_source, author_external_id, resolved_at, resolved_by, steps_from, steps_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  tx(db, () => { for (const r of db.prepare('SELECT * FROM comments WHERE env = ? ORDER BY id').all(from) as unknown as R[]) {
    const nid = Number(ins.run(to, r.anchor, r.step, r.parent_id == null ? null : ids.get(r.parent_id) ?? null, r.author, r.author_id, r.body, r.created_at, r.edited_at, r.deleted_at, r.external_id, r.external_source, r.author_external_id, r.resolved_at, r.resolved_by, r.steps_from, r.steps_to).lastInsertRowid);
    ids.set(r.id, nid);
    if (!r.deleted_at) { syncMentions(db, nid, r.body, r.author_id); for (const u of (db.prepare('SELECT user_id FROM comment_mentions WHERE comment_id = ?').all(nid) as unknown as { user_id: string }[])) markSeen(db, u.user_id, [nid]); } // a copy's mentions are not news
  } });
  return ids;
}

/** Every row of an env, for the static preview build. */
export const allRows = (db: DB, env: string): CommentRow[] => (db.prepare('SELECT * FROM comments WHERE env = ? ORDER BY id').all(env) as unknown as R[]).map(toRow);

/** `ago` is minutes before the seed ran, so the demo always reads "2 days ago" and not a fixed date. */
export interface SampleComment { service: string; ingress: string; step?: string; steps?: { from: string; to: string }; author: string; body: string; ago?: number; edited?: boolean; externalId?: string; externalSource?: string; authorExternalId?: string; resolved?: boolean; resolvedBy?: string; replies?: { author: string; body: string; ago?: number }[] }
const when = (ago?: number) => (ago == null ? null : new Date(Date.now() - ago * 60000).toISOString());

/** Seed data (samples/comments/*.json). Seeding twice adds nothing: a flow that already has a comment with the same author and body is skipped. */
export function loadComments(db: DB, g: GraphIndex, env: string, list: SampleComment[], warn: (m: string) => void = () => {}): number {
  let n = 0;
  for (const c of list) {
    try {
      const anchor = flowAnchor(c.service, c.ingress);
      const have = listThread(db, env, anchor).comments;
      if (have.some((x) => x.author === c.author && x.body === sanitize(resolveMentions(db, c.body)))) continue; // @{Name} in a sample is resolved to the user's token first
      const row = addComment(db, g, env, { anchor, step: c.step ?? null, steps: c.steps ?? null, author: c.author, body: c.body, externalId: c.externalId, externalSource: c.externalSource, authorExternalId: c.authorExternalId });
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
