// Sharing of a design environment: its owner, the people it is shared with (viewer | editor) and whether it is published (everyone reads).
// The badge (Private / Shared / Published) is derived and stored in envs.visibility. Rules: core/env-access.ts.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { visibilityOf, type MemberRole, type Role, type Visibility } from '../../core/env-access.ts';
import { findUser } from './users.ts';
import { userEmail } from '../auth/accounts.ts';
import { getEnvRow } from './envs.ts';
import { roleFor } from '../access.ts';
import { currentWho } from '../auth/context.ts';

export interface Person { id: string; name: string; email: string | null; color: number }
export interface EnvAccess { env: string; kind: 'sealed' | 'design'; owner: Person | null; visibility: Visibility; published: boolean; members: { user: Person; role: MemberRole }[]; memberCount: number; role: Role }

const person = (db: DB, id: string): Person | null => { const u = findUser(db, id); return u ? { id: u.id, name: u.name, email: userEmail(db, u.id), color: u.color } : null; };

export function getAccess(db: DB, env: string, role: Role): EnvAccess {
  const r = getEnvRow(db, env) as unknown as { kind: 'sealed' | 'design'; owner_user_id: string | null; visibility: Visibility } | undefined;
  if (!r) throw notFound(`environment '${env}'`);
  const rows = db.prepare('SELECT user_id, role FROM env_members WHERE env = ? ORDER BY rowid').all(env) as { user_id: string; role: MemberRole }[];
  const members = rows.flatMap((m) => { const u = person(db, m.user_id); return u ? [{ user: u, role: m.role }] : []; });
  const sees = role === 'owner' || role === 'editor'; // the list of people is for those who can change things
  return { env, kind: r.kind, owner: r.owner_user_id ? person(db, r.owner_user_id) : null, visibility: r.visibility, published: r.visibility === 'published', members: sees ? members : [], memberCount: members.length, role };
}

export function setAccess(db: DB, env: string, input: any, actorIsAdmin: boolean): void {
  const r = getEnvRow(db, env) as unknown as { kind: string; owner_user_id: string | null; visibility: Visibility } | undefined;
  if (!r) throw notFound(`environment '${env}'`);
  if (r.kind !== 'design') throw conflict('ENV_SEALED', `environment '${env}' is sealed: everyone signed in reads it, only admins manage it`);
  if (!input || typeof input !== 'object') throw badRequest('body must be {published?, members?: [{userId, role}], owner?}');
  tx(db, () => {
    let owner = r.owner_user_id;
    if (input.owner !== undefined) {
      if (!actorIsAdmin) throw badRequest('only an admin can change the owner');
      const u = typeof input.owner === 'string' ? findUser(db, input.owner) : null;
      if (!u) throw badRequest(`unknown user '${input.owner}' as owner`);
      owner = u.id;
      db.prepare('UPDATE envs SET owner_user_id = ? WHERE name = ?').run(owner, env);
    }
    let count = (db.prepare('SELECT count(*) AS n FROM env_members WHERE env = ?').get(env) as { n: number }).n;
    if (input.members !== undefined) {
      if (!Array.isArray(input.members)) throw badRequest('members must be a list of {userId, role}');
      const seen = new Map<string, MemberRole>();
      for (const m of input.members) {
        const u = typeof m?.userId === 'string' ? findUser(db, m.userId) : null;
        if (!u) throw badRequest(`unknown user '${m?.userId}' in members`);
        if (m.role !== 'viewer' && m.role !== 'editor') throw badRequest("each member's role must be 'viewer' or 'editor'");
        if (u.id !== owner) seen.set(u.id, m.role);
      }
      db.prepare('DELETE FROM env_members WHERE env = ?').run(env);
      for (const [id, role] of seen) db.prepare('INSERT INTO env_members (env, user_id, role) VALUES (?, ?, ?)').run(env, id, role);
      count = seen.size;
    }
    if (input.published !== undefined && typeof input.published !== 'boolean') throw badRequest('published must be true or false');
    const published = input.published ?? (r.visibility === 'published');
    db.prepare('UPDATE envs SET visibility = ? WHERE name = ?').run(visibilityOf(published, count), env);
  });
}

export interface AccessSummary { ownerId: string | null; ownerName: string | null; visibility: Visibility; published: boolean; memberCount: number; role: Role; /** The caller's role as a listed member (null: not listed). */ member: MemberRole | null }
/** What the pickers need per env: who owns it, the badge, how many people it is shared with, and the caller's own role (auth off: owner). */
export function summaries(db: DB, names: string[]): Record<string, AccessSummary> {
  const rows = new Map((db.prepare('SELECT name, owner_user_id, visibility FROM envs').all() as { name: string; owner_user_id: string | null; visibility: Visibility }[]).map((r) => [r.name, r]));
  const counts = new Map((db.prepare('SELECT env, count(*) AS n FROM env_members GROUP BY env').all() as { env: string; n: number }[]).map((r) => [r.env, r.n]));
  const me = currentWho()?.id, mine = new Map<string, MemberRole>();
  if (me) for (const m of db.prepare('SELECT env, role FROM env_members WHERE user_id = ?').all(me) as { env: string; role: MemberRole }[]) mine.set(m.env, m.role);
  const out: Record<string, AccessSummary> = {};
  for (const n of names) {
    const r = rows.get(n);
    out[n] = { ownerId: r?.owner_user_id ?? null, ownerName: r?.owner_user_id ? findUser(db, r.owner_user_id)?.name ?? null : null, visibility: r?.visibility ?? 'published', published: (r?.visibility ?? 'published') === 'published', memberCount: counts.get(n) ?? 0, role: roleFor(db, n), member: mine.get(n) ?? null };
  }
  return out;
}
