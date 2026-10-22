// The users registry (0.31.0, migration 016): who writes comments and owns action items, and who can be @mentioned. Users are global (not per
// environment). Matching is core/users-match.ts. No delete: a merge folds a user into another (re-points everything, keeps an alias).
// Spec: docs/plans/users-mentions.md. Identity is naive (see server/identity.ts).

import { randomBytes } from 'node:crypto';
import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { cleanName } from '../../core/comments.ts';
import { colorSlot, matchUser, nameKey, MAX_USER_NAME, type User, type Probe } from '../../core/users-match.ts';
import { mapMentions } from '../../core/mentions.ts';
import { badRequest, notFound, conflict } from '../errors.ts';
import { emit } from '../events/bus.ts';

interface UR { id: string; name: string; color: number; created_at: string; last_seen_at: string | null; merged_into: string | null }
const now = () => new Date().toISOString();

/** Live users (merged ones are gone from the list), most recently seen first, then by name. */
export function listUsers(db: DB): User[] {
  const rows = db.prepare('SELECT * FROM users WHERE merged_into IS NULL').all() as unknown as UR[];
  const al = db.prepare('SELECT user_id, alias FROM user_aliases').all() as unknown as { user_id: string; alias: string }[];
  const ex = db.prepare('SELECT user_id, source, external_id FROM user_external_ids').all() as unknown as { user_id: string; source: string; external_id: string }[];
  return rows.map((r) => ({
    id: r.id, name: r.name, color: r.color, createdAt: r.created_at, lastSeenAt: r.last_seen_at,
    aliases: al.filter((a) => a.user_id === r.id).map((a) => a.alias), externalIds: ex.filter((e) => e.user_id === r.id).map((e) => ({ source: e.source, externalId: e.external_id })),
  })).sort((a, b) => (b.lastSeenAt ?? b.createdAt).localeCompare(a.lastSeenAt ?? a.createdAt) || a.name.localeCompare(b.name));
}

/** A user by id; an id that was merged answers the user it went into. Undefined when unknown. */
export function findUser(db: DB, id: string): User | undefined {
  let cur = id;
  for (let i = 0; i < 20; i++) {
    const r = db.prepare('SELECT merged_into FROM users WHERE id = ?').get(cur) as unknown as { merged_into: string | null } | undefined;
    if (!r) return undefined;
    if (!r.merged_into) return listUsers(db).find((u) => u.id === cur);
    cur = r.merged_into;
  }
  return undefined;
}
export const getUser = (db: DB, id: string): User => findUser(db, id) ?? (() => { throw notFound(`user '${id}'`); })();

export function userName(name: unknown, what = 'name'): string {
  const n = typeof name === 'string' ? cleanName(name) : '';
  if (!n) throw badRequest(`${what} is required`);
  if (n.length > MAX_USER_NAME) throw badRequest(`${what} is longer than ${MAX_USER_NAME} characters`);
  return n;
}
const ext = (x: unknown): { source: string; externalId: string }[] => {
  if (x == null) return [];
  if (!Array.isArray(x)) throw badRequest('externalIds must be a list of {source, externalId}');
  return x.map((e) => {
    if (typeof e?.source !== 'string' || !e.source.trim() || typeof e?.externalId !== 'string' || !e.externalId.trim()) throw badRequest('each external id needs a source and an externalId');
    return { source: e.source.trim(), externalId: e.externalId.trim() };
  });
};

function link(db: DB, userId: string, es: { source: string; externalId: string }[]) {
  for (const e of es) {
    const owner = db.prepare('SELECT user_id FROM user_external_ids WHERE source = ? AND external_id = ?').get(e.source, e.externalId) as unknown as { user_id: string } | undefined;
    if (owner && owner.user_id !== userId) throw conflict('EXTERNAL_ID_TAKEN', `${e.source} id '${e.externalId}' already belongs to another user`);
    if (!owner) db.prepare('INSERT INTO user_external_ids (user_id, source, external_id) VALUES (?, ?, ?)').run(userId, e.source, e.externalId);
  }
}

/** Creates a user. The name must be free among live users (a taken name is a 409 NAME_TAKEN). */
export function createUser(db: DB, nameIn: unknown, externalIds?: unknown): User {
  const name = userName(nameIn), es = ext(externalIds);
  if (listUsers(db).some((u) => nameKey(u.name) === nameKey(name))) throw conflict('NAME_TAKEN', `a user named '${name}' exists`);
  const id = `u_${randomBytes(4).toString('hex')}`;
  tx(db, () => { db.prepare('INSERT INTO users (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(id, name, colorSlot(id), now()); link(db, id, es); });
  return getUser(db, id);
}

/** The user a name / external id points at, created when nothing matches. An external id seen with a matched user is attached to it. */
export function ensureUser(db: DB, p: Probe & { name: string }, create = true): User | null {
  const users = listUsers(db);
  const m = matchUser(users, p);
  if (m) {
    if (p.source && p.externalId && m.by !== 'external') { try { link(db, m.user.id, [{ source: p.source, externalId: p.externalId }]); } catch { /* taken by another user: keep the name match */ } }
    return m.user;
  }
  return create ? createUser(db, p.name, p.source && p.externalId ? [{ source: p.source, externalId: p.externalId }] : undefined) : null;
}

export function touch(db: DB, id: string) { db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now(), id); }

export function renameUser(db: DB, id: string, nameIn: unknown, keepAlias = false): User {
  const u = getUser(db, id), name = userName(nameIn);
  if (listUsers(db).some((x) => x.id !== u.id && nameKey(x.name) === nameKey(name))) throw conflict('NAME_TAKEN', `a user named '${name}' exists`);
  tx(db, () => {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, u.id);
    if (keepAlias && nameKey(u.name) !== nameKey(name)) db.prepare('INSERT INTO user_aliases (user_id, alias) VALUES (?, ?)').run(u.id, u.name);
  });
  return getUser(db, u.id);
}

/** Folds `from` into `into`: comments, action items, mentions (rows and body tokens), seen marks, external ids and aliases move; the old name stays as an alias. */
export function mergeUser(db: DB, from: string, into: string, by = 'unknown'): User {
  const a = getUser(db, from), b = getUser(db, into);
  if (a.id === b.id) throw badRequest('cannot merge a user into itself');
  tx(db, () => {
    db.prepare('UPDATE comments SET author_id = ? WHERE author_id = ?').run(b.id, a.id);
    db.prepare('UPDATE action_items SET owner_id = ? WHERE owner_id = ?').run(b.id, a.id);
    db.prepare('UPDATE action_items SET created_by_id = ? WHERE created_by_id = ?').run(b.id, a.id);
    const ids = (db.prepare('SELECT comment_id FROM comment_mentions WHERE user_id = ?').all(a.id) as unknown as { comment_id: number }[]).map((r) => r.comment_id);
    for (const cid of ids) {
      const c = db.prepare('SELECT body FROM comments WHERE id = ?').get(cid) as unknown as { body: string } | undefined;
      if (c) db.prepare('UPDATE comments SET body = ? WHERE id = ?').run(mapMentions(c.body, (x) => (x === a.id ? b.id : x)), cid);
    }
    db.prepare('INSERT OR IGNORE INTO comment_mentions (comment_id, user_id) SELECT comment_id, ? FROM comment_mentions WHERE user_id = ?').run(b.id, a.id);
    db.prepare('DELETE FROM comment_mentions WHERE user_id = ?').run(a.id);
    db.prepare('INSERT OR IGNORE INTO mention_seen (user_id, comment_id, seen_at) SELECT ?, comment_id, seen_at FROM mention_seen WHERE user_id = ?').run(b.id, a.id);
    db.prepare('DELETE FROM mention_seen WHERE user_id = ?').run(a.id);
    db.prepare('UPDATE user_external_ids SET user_id = ? WHERE user_id = ?').run(b.id, a.id);
    db.prepare('UPDATE user_aliases SET user_id = ? WHERE user_id = ?').run(b.id, a.id);
    db.prepare('INSERT INTO user_aliases (user_id, alias) VALUES (?, ?)').run(b.id, a.name);
    db.prepare('UPDATE users SET merged_into = ? WHERE id = ?').run(b.id, a.id);
  });
  emit(db, { type: 'user.merged', summary: `${by} merged user ${a.name} into ${b.name}`, data: { from: a.id, into: b.id, by } });
  return getUser(db, b.id);
}

/** What each user has written and been given, for the sign-in list and the Users page: live comments, live action items owned, live comments that mention them. */
export function userCounts(db: DB): Record<string, { comments: number; items: number; mentions: number }> {
  const out: Record<string, { comments: number; items: number; mentions: number }> = {};
  const add = (sql: string, k: 'comments' | 'items' | 'mentions') => { for (const r of db.prepare(sql).all() as unknown as { id: string; n: number }[]) (out[r.id] ??= { comments: 0, items: 0, mentions: 0 })[k] = r.n; };
  add('SELECT author_id AS id, COUNT(*) AS n FROM comments WHERE deleted_at IS NULL AND author_id IS NOT NULL GROUP BY author_id', 'comments');
  add('SELECT owner_id AS id, COUNT(*) AS n FROM action_items WHERE deleted_at IS NULL AND owner_id IS NOT NULL GROUP BY owner_id', 'items');
  add('SELECT m.user_id AS id, COUNT(*) AS n FROM comment_mentions m JOIN comments c ON c.id = m.comment_id WHERE c.deleted_at IS NULL GROUP BY m.user_id', 'mentions');
  return out;
}

/** Id -> {name, color} for every user, merged ones included (they read as the user they went into). For display of stored ids. */
export function nameIndex(db: DB): Map<string, { id: string; name: string; color: number }> {
  const rows = db.prepare('SELECT id, name, color, merged_into FROM users').all() as unknown as UR[];
  const by = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, { id: string; name: string; color: number }>();
  for (const r of rows) { let c = r; for (let i = 0; c.merged_into && by.has(c.merged_into) && i < 20; i++) c = by.get(c.merged_into)!; out.set(r.id, { id: c.id, name: c.name, color: c.color }); }
  return out;
}
