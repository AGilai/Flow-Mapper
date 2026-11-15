// Access enforcement: loads the rows the pure rules in core/env-access.ts need and applies them for the current caller.
// With auth off (or no request context: scripts, stdio MCP) nothing is ever refused. A hidden env is 404, never 403.

import type { DB } from './db/connection.ts';
import { HttpError, notFound } from './errors.ts';
import { atLeast, canEditDraft, canReadDraft, roleOf, visibilityOf, type DraftAcl, type EnvAcl, type MemberRole, type Role, type Who } from '../core/env-access.ts';
import { currentWho, type Principal } from './auth/context.ts';

export const isOff = (p?: Principal | null) => !p || p.via === 'off';
export const whoOf = (p: Principal): Who => ({ id: p.id, admin: p.admin });

export function aclOf(db: DB, env: string): EnvAcl | null {
  const r = db.prepare('SELECT kind, owner_user_id, visibility FROM envs WHERE name = ?').get(env) as { kind: 'sealed' | 'design'; owner_user_id: string | null; visibility: EnvAcl['visibility'] } | undefined;
  if (!r) return db.prepare('SELECT 1 FROM snapshots WHERE env = ? LIMIT 1').get(env) ? { kind: 'sealed', ownerId: null, visibility: 'published', members: {} } : null;
  const members: Record<string, MemberRole> = {};
  for (const m of db.prepare('SELECT user_id, role FROM env_members WHERE env = ?').all(env) as { user_id: string; role: MemberRole }[]) members[m.user_id] = m.role;
  return { kind: r.kind, ownerId: r.owner_user_id, visibility: r.visibility, members };
}

/** The caller's role in `env`: 'none' for an unknown or hidden env. Auth off: owner. */
export function roleFor(db: DB, env: string, p: Principal | undefined | null = currentWho()): Role {
  if (isOff(p)) return 'owner';
  const a = aclOf(db, env);
  return a ? roleOf(a, whoOf(p!)) : 'none';
}

const forbidden = (what: string) => new HttpError(403, 'FORBIDDEN', what);

/** Throws 404 when the env is hidden (or unknown), 403 when it is readable but the role is below `need`. */
export function requireRole(db: DB, env: string, need: Role, p: Principal | undefined | null = currentWho()): Role {
  const r = roleFor(db, env, p);
  if (r === 'none') throw notFound(`environment '${env}'`);
  if (!atLeast(r, need)) throw forbidden(need === 'owner' ? `only the owner of '${env}' (or an admin) can do this` : `you have read-only access to '${env}'`);
  return r;
}

/** The names the caller may read, or null when everything is readable. */
export function readableEnvs(db: DB, p: Principal | undefined | null = currentWho()): Set<string> | null {
  if (isOff(p) || p!.admin) return null;
  const out = new Set<string>();
  const who = whoOf(p!);
  const members = new Map<string, Record<string, MemberRole>>();
  for (const m of db.prepare('SELECT env, user_id, role FROM env_members').all() as { env: string; user_id: string; role: MemberRole }[]) (members.get(m.env) ?? members.set(m.env, {}).get(m.env)!)[m.user_id] = m.role;
  for (const r of db.prepare('SELECT name, kind, owner_user_id, visibility FROM envs').all() as { name: string; kind: EnvAcl['kind']; owner_user_id: string | null; visibility: EnvAcl['visibility'] }[])
    if (roleOf({ kind: r.kind, ownerId: r.owner_user_id, visibility: r.visibility, members: members.get(r.name) ?? {} }, who) !== 'none') out.add(r.name);
  for (const r of db.prepare('SELECT DISTINCT env FROM snapshots').all() as { env: string }[]) if (!db.prepare('SELECT 1 FROM envs WHERE name = ?').get(r.env)) out.add(r.env);
  return out;
}
/** Keeps what the caller may read: `env` of each item (null / undefined env = not env-bound, kept). */
export function filterByEnv<T>(db: DB, items: T[], envOfItem: (x: T) => string | null | undefined, p: Principal | undefined | null = currentWho()): T[] {
  const ok = readableEnvs(db, p);
  return ok ? items.filter((x) => { const e = envOfItem(x); return e == null || ok.has(e); }) : items;
}

export function draftAclOf(db: DB, env: string, slug: string): DraftAcl | null {
  const r = db.prepare('SELECT owner_user_id, visibility FROM drafts WHERE env = ? AND slug = ?').get(env, slug) as { owner_user_id: string | null; visibility: DraftAcl['visibility'] } | undefined;
  return r ? { ownerId: r.owner_user_id, visibility: r.visibility } : null;
}

/** A draft the caller may not read is not found. */
export function requireDraftRead(db: DB, env: string, slug: string, p: Principal | undefined | null = currentWho()) {
  if (isOff(p)) return;
  const d = draftAclOf(db, env, slug);
  if (d && !canReadDraft(roleFor(db, env, p), d, whoOf(p!))) throw notFound(`draft '${slug}' in environment '${env}'`);
}
export function requireDraftEdit(db: DB, env: string, slug: string, p: Principal | undefined | null = currentWho()) {
  if (isOff(p)) return;
  const d = draftAclOf(db, env, slug), role = roleFor(db, env, p);
  if (!d) return; // unknown draft: the handler answers 404
  if (!canReadDraft(role, d, whoOf(p!))) throw notFound(`draft '${slug}' in environment '${env}'`);
  if (!canEditDraft(role, d, whoOf(p!))) throw forbidden(`you cannot change draft '${slug}' (it is private to its author, or you only have read access to '${env}')`);
}

export { visibilityOf };
