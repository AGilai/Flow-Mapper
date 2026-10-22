// Action items under a flow (0.29.0, migration 013): owner / description / status / due per anchor, optionally made from a comment. Anyone may
// add and edit any field (the request's `actor` is recorded in updated_by); only the creator deletes (`actor` must equal created_by). That is
// naive identity, like comments and drafts: there are no accounts. Numbers are per (env, anchor) and never reused. A delete is soft. Any
// environment takes them, sealed ones too: they are annotations, like comments.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import type { GraphIndex } from '../../core/graph-index.ts';
import { isStepKey } from '../../core/description.ts';
import { requireFlow, flowSteps, hasStepIn } from './flow-check.ts';
import { parseFlowAnchor, MAX_AUTHOR, cleanName } from '../../core/comments.ts';
import { checkFields, eventFor, isOpen, type ActionItem, type ActionList, type ActionEvent, type ActionStatus, type ActionKind } from '../../core/action-items.ts';
import { HttpError, notFound } from '../errors.ts';
import { getEnvRow } from './envs.ts';
import { actionItemChanged } from '../events/emitters.ts';
import { identify } from '../identity.ts';
import { findUser, nameIndex } from './users.ts';

export interface R { id: number; env: string; anchor: string; number: number; owner: string; description: string; status: ActionStatus; due: string | null; step: string | null; comment_id: number | null; source: 'human' | 'ai'; owner_id: string | null; created_by_id: string | null; created_by: string; updated_by: string; created_at: string; updated_at: string; closed_at: string | null; deleted_at: string | null }
export const toItem = (r: R): ActionItem => ({ id: r.id, anchor: r.anchor, number: r.number, owner: r.owner, ownerId: r.owner_id, createdById: r.created_by_id, description: r.description, status: r.status, due: r.due, step: r.step, commentId: r.comment_id, source: r.source, createdBy: r.created_by, updatedBy: r.updated_by, createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at });
const bad = (m: string) => new HttpError(400, 'VALIDATION', m);

function checkEnv(db: DB, env: string) { if (!getEnvRow(db, env)) throw notFound(`environment '${env}'`); }
function flowOf(anchor: unknown) { const f = parseFlowAnchor(anchor); if (!f) throw bad("anchor must be 'flow:<service>/<ingress>'"); return f; }
/** The caller: a user id (X-Flow-User) or an actor name. */
const whoOf = (db: DB, id: string | null | undefined, name: unknown, create = true) => asValidation(() => identify(db, { userId: id, name, what: 'actor' }, create));
/** Action items answer VALIDATION (not BAD_REQUEST) for a bad name, as before 0.32.0. */
function asValidation<T>(f: () => T): T { try { return f(); } catch (e) { if (e instanceof HttpError && e.code === 'BAD_REQUEST') throw bad(e.message); throw e; } }
/** The owner as a user: `ownerId`, or an `owner` name matched to a user (created when new). Undefined when the request does not mention an owner. */
function ownerOf(db: DB, i: { owner?: unknown; ownerId?: string | null }): { id: string; name: string } | undefined {
  if (i.ownerId) { const u = findUser(db, i.ownerId); if (!u) throw bad(`unknown owner user '${i.ownerId}'`); return { id: u.id, name: u.name }; }
  if (i.owner === undefined) return undefined;
  const w = asValidation(() => identify(db, { name: i.owner, what: 'owner' }));
  return { id: w.id!, name: w.name };
}
function fieldsOf(i: unknown, partial: boolean) { const r = checkFields(i, partial, cleanName, MAX_AUTHOR); if ('error' in r) throw bad(r.error); return r.value; }
function stepOf(g: GraphIndex, env: string, service: string, ingress: string, step: unknown): string | null {
  if (step == null) return null;
  const fs = flowSteps(g, env, service, ingress);
  if (typeof step !== 'string' || !isStepKey(step) || !hasStepIn(fs, step)) throw bad(`step '${step}' is not in the flow ${service} / ${ingress}`);
  return step;
}
const at = () => new Date().toISOString();
function event(db: DB, itemId: number, kind: ActionKind, actor: string, when = at()) { db.prepare('INSERT INTO action_item_events (item_id, kind, actor, at) VALUES (?, ?, ?, ?)').run(itemId, kind, actor, when); }
const byId = (db: DB, id: number) => db.prepare('SELECT * FROM action_items WHERE id = ?').get(id) as unknown as R;

export function listItems(db: DB, env: string, anchor: string): ActionList {
  checkEnv(db, env); flowOf(anchor);
  const rows = db.prepare('SELECT * FROM action_items WHERE env = ? AND anchor = ? AND deleted_at IS NULL ORDER BY number').all(env, anchor) as unknown as R[];
  const names = nameIndex(db), shown = (r: R): ActionItem => { const t = toItem(r), o = r.owner_id && names.get(r.owner_id), c = r.created_by_id && names.get(r.created_by_id); return { ...t, owner: o ? o.name : t.owner, createdBy: c ? c.name : t.createdBy }; };
  const items = rows.map(shown), num = new Map(rows.map((r) => [r.id, r]));
  const evs = rows.length ? db.prepare(`SELECT * FROM action_item_events WHERE item_id IN (${rows.map(() => '?').join(',')}) ORDER BY at, id`).all(...rows.map((r) => r.id)) as unknown as { id: number; item_id: number; kind: ActionKind; actor: string; at: string }[] : [];
  const events: ActionEvent[] = evs.map((e) => ({ id: e.id, itemId: e.item_id, number: num.get(e.item_id)!.number, kind: e.kind, actor: e.actor, at: e.at, commentId: num.get(e.item_id)!.comment_id }));
  const next = ((db.prepare('SELECT MAX(number) AS m FROM action_items WHERE env = ? AND anchor = ?').get(env, anchor) as { m: number | null }).m ?? 0) + 1;
  return { items, events, next };
}

/** Open items per anchor, for the Flows list: `{anchor: n}` (anchors with none open are absent). */
export function counts(db: DB, env: string): Record<string, number> {
  checkEnv(db, env);
  return Object.fromEntries((db.prepare("SELECT anchor, COUNT(*) AS n FROM action_items WHERE env = ? AND deleted_at IS NULL AND status IN ('open', 'progress') GROUP BY anchor").all(env) as unknown as { anchor: string; n: number }[]).map((r) => [r.anchor, r.n]));
}

export interface NewItem { anchor: string; owner?: string; ownerId?: string | null; actorId?: string | null; actor?: string; description: string; status?: ActionStatus; due?: string | null; step?: string | null; commentId?: number | null; source?: 'human' | 'ai' }

export function addItem(db: DB, g: GraphIndex, env: string, i: NewItem): ActionItem {
  checkEnv(db, env);
  const { service, ingress } = flowOf(i?.anchor);
  const who = whoOf(db, i.actorId, i.actor), actor = who.name, own = ownerOf(db, i);
  const f = fieldsOf({ ...i, owner: own?.name ?? i.owner }, false);
  requireFlow(g, env, service, ingress);
  const step = stepOf(g, env, service, ingress, i.step);
  let commentId: number | null = null;
  if (i.commentId != null) {
    const c = db.prepare('SELECT id, deleted_at FROM comments WHERE id = ? AND env = ? AND anchor = ?').get(Number(i.commentId), env, i.anchor) as { id: number; deleted_at: string | null } | undefined;
    if (!c || c.deleted_at) throw bad(`commentId ${i.commentId} is not a comment under ${i.anchor}`);
    commentId = c.id;
  }
  const status = f.status ?? 'open', now = at();
  const id = tx(db, () => {
    const number = ((db.prepare('SELECT MAX(number) AS m FROM action_items WHERE env = ? AND anchor = ?').get(env, i.anchor) as { m: number | null }).m ?? 0) + 1;
    const n = Number(db.prepare('INSERT INTO action_items (env, anchor, number, owner, owner_id, created_by_id, description, status, due, step, comment_id, source, created_by, updated_by, created_at, updated_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(env, i.anchor, number, f.owner!, own?.id ?? null, who.id, f.description!, status, f.due ?? null, step, commentId, i.source ?? 'human', actor, actor, now, now, isOpen(status) ? null : now).lastInsertRowid);
    event(db, n, 'created', actor, now);
    return n;
  });
  const row = byId(db, id);
  actionItemChanged(db, 'created', { env, anchor: i.anchor, id, number: row.number, status, actor });
  return toItem(row);
}

export interface ItemPatch { actor?: string; actorId?: string | null; owner?: string; ownerId?: string | null; description?: string; status?: ActionStatus; due?: string | null; step?: string | null; source?: 'human' | 'ai' }

/** Anyone may change any field. A status change across the open/closed line writes an event and sets or clears closed_at. */
export function updateItem(db: DB, g: GraphIndex, env: string, id: number, p: ItemPatch): ActionItem {
  checkEnv(db, env);
  const r = db.prepare('SELECT * FROM action_items WHERE id = ? AND env = ?').get(Number(id), env) as unknown as R | undefined;
  if (!r || r.deleted_at) throw notFound(`action item ${id}`);
  const actor = whoOf(db, p?.actorId, p?.actor).name, own = ownerOf(db, p ?? {}), f = fieldsOf({ ...p, owner: own?.name ?? p?.owner }, true);
  const { service, ingress } = flowOf(r.anchor);
  const step = p.step === undefined ? r.step : stepOf(g, env, service, ingress, p.step);
  const status = f.status ?? r.status, now = at(), kind = eventFor(r.status, status);
  const closed = kind === 'reopened' ? null : kind ? now : r.closed_at;
  tx(db, () => {
    db.prepare('UPDATE action_items SET owner = ?, owner_id = ?, description = ?, status = ?, due = ?, step = ?, updated_by = ?, updated_at = ?, closed_at = ? WHERE id = ?')
      .run(f.owner ?? r.owner, own ? own.id : r.owner_id, f.description ?? r.description, status, f.due === undefined ? r.due : f.due, step, actor, now, closed, r.id);
    if (kind) event(db, r.id, kind, actor, now);
  });
  actionItemChanged(db, 'updated', { env, anchor: r.anchor, id: r.id, number: r.number, status, actor });
  return toItem(byId(db, r.id));
}

export function deleteItem(db: DB, env: string, id: number, actor: unknown, actorId?: string | null): { deleted: number } {
  checkEnv(db, env);
  const r = db.prepare('SELECT * FROM action_items WHERE id = ? AND env = ?').get(Number(id), env) as unknown as R | undefined;
  if (!r || r.deleted_at) throw notFound(`action item ${id}`);
  const who = whoOf(db, actorId, actor, false), a = who.name;
  if (r.created_by_id ? r.created_by_id !== who.id : a !== r.created_by) throw new HttpError(403, 'NOT_CREATOR', 'only the creator can delete an action item');
  db.prepare('UPDATE action_items SET deleted_at = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(at(), a, at(), r.id);
  actionItemChanged(db, 'deleted', { env, anchor: r.anchor, id: r.id, number: r.number, status: r.status, actor: a });
  return { deleted: r.id };
}
