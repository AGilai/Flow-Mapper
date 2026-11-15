// Cognito identity -> Flow-Mapper user. The Cognito `sub` is kept in user_external_ids (source 'cognito'); the user is created on first sign-in with the
// name and email of the ID token. A display name that is taken gets the email (then a number) added: sign-in never links to someone else's user by name.

import type { DB } from '../db/connection.ts';
import { createUser, findUser, touch } from '../store/users.ts';
import { HttpError } from '../errors.ts';
import type { Claims } from './jwt.ts';
import type { Principal } from './context.ts';

export const COGNITO = 'cognito';

export function userFromClaims(db: DB, c: Claims, adminEmail?: string): string {
  const email = typeof c.email === 'string' ? c.email.trim() : '';
  const hit = db.prepare('SELECT user_id FROM user_external_ids WHERE source = ? AND external_id = ?').get(COGNITO, c.sub) as { user_id: string } | undefined;
  let id = hit ? findUser(db, hit.user_id)?.id : undefined;
  if (!id) {
    const base = (typeof c.name === 'string' && c.name.trim()) || (email && email.split('@')[0]) || String(c['cognito:username'] ?? 'user');
    const tries = [base, email ? `${base} (${email})` : '', ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${base} ${n}`)].filter(Boolean);
    for (const name of tries) {
      try { id = createUser(db, name, [{ source: COGNITO, externalId: c.sub }]).id; break; } catch (e) { if (!(e instanceof HttpError) || e.code !== 'NAME_TAKEN') throw e; }
    }
    if (!id) throw new HttpError(500, 'INTERNAL', 'could not create a user for this sign-in');
  }
  if (email) db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, id);
  if (adminEmail && email.toLowerCase() === adminEmail && c.email_verified !== false && c.email_verified !== 'false') db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(id);
  touch(db, id);
  return id;
}

export function principalOf(db: DB, userId: string, via: 'session' | 'token', scope: 'user' | 'harvester', csrf?: string): Principal | null {
  const u = findUser(db, userId);
  if (!u) return null;
  const r = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(u.id) as { is_admin: number } | undefined;
  return { id: u.id, name: u.name, admin: !!r?.is_admin, scope, via, ...(csrf ? { csrf } : {}) };
}

export const userEmail = (db: DB, id: string): string | null => (db.prepare('SELECT email FROM users WHERE id = ?').get(id) as { email: string | null } | undefined)?.email ?? null;
