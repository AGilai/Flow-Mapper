// Personal access tokens (`fm_...`): created by a signed-in user, shown once, stored as a SHA-256 hash. scope 'harvester' (admins only) may ingest into
// sealed environments. An optional expiry (30, 90 or 365 days; default never): an expired token answers 401 TOKEN_EXPIRED.

import { createHash, randomBytes } from 'node:crypto';
import type { DB } from '../db/connection.ts';
import { badRequest, notFound, HttpError } from '../errors.ts';

export const TOKEN_PREFIX = 'fm_';
export const EXPIRY_DAYS = [30, 90, 365] as const;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export interface TokenInfo { id: string; name: string; scope: 'user' | 'harvester'; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; expiresAt: string | null }
interface Row { id: string; user_id: string; name: string; scope: 'user' | 'harvester'; created_at: string; last_used_at: string | null; revoked_at: string | null; expires_at: string | null }
const info = (r: Row): TokenInfo => ({ id: r.id, name: r.name, scope: r.scope, createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at, expiresAt: r.expires_at });

export function createToken(db: DB, userId: string, input: { name?: unknown; scope?: unknown; expiresInDays?: unknown }, isAdmin: boolean, now = Date.now()): TokenInfo & { token: string } {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 80) throw badRequest('name is required (at most 80 characters)');
  const scope = input.scope === undefined || input.scope === null ? 'user' : input.scope;
  if (scope !== 'user' && scope !== 'harvester') throw badRequest("scope must be 'user' or 'harvester'");
  if (scope === 'harvester' && !isAdmin) throw new HttpError(403, 'FORBIDDEN', 'only an admin can create a harvester token');
  const d = input.expiresInDays;
  if (d !== undefined && d !== null && !(EXPIRY_DAYS as readonly unknown[]).includes(d)) throw badRequest(`expiresInDays must be null (never) or one of ${EXPIRY_DAYS.join(', ')}`);
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const id = 't_' + randomBytes(5).toString('hex');
  const at = new Date(now).toISOString();
  const expires = typeof d === 'number' ? new Date(now + d * 86400_000).toISOString() : null;
  db.prepare('INSERT INTO api_tokens (id, user_id, name, scope, hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, userId, name, scope, sha(token), at, expires);
  return { ...info(db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(id) as unknown as Row), token };
}

export const listTokens = (db: DB, userId: string): TokenInfo[] =>
  (db.prepare('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC, id').all(userId) as unknown as Row[]).map(info);

export function revokeToken(db: DB, userId: string, id: string, now = Date.now()): TokenInfo {
  const r = db.prepare('SELECT * FROM api_tokens WHERE id = ? AND user_id = ?').get(id, userId) as unknown as Row | undefined;
  if (!r) throw notFound(`token '${id}'`);
  if (!r.revoked_at) db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ?').run(new Date(now).toISOString(), id);
  return info(db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(id) as unknown as Row);
}

export type TokenLookup = { ok: true; userId: string; scope: 'user' | 'harvester' } | { ok: false; code: 'TOKEN_INVALID' | 'TOKEN_EXPIRED'; message: string };

/** Resolves a presented bearer token and records its use. */
export function lookupToken(db: DB, presented: string, now = Date.now()): TokenLookup {
  const r = db.prepare('SELECT * FROM api_tokens WHERE hash = ?').get(sha(presented)) as unknown as Row | undefined;
  if (!r || r.revoked_at) return { ok: false, code: 'TOKEN_INVALID', message: 'this token is not valid (unknown or revoked); create a new one under Tokens' };
  if (r.expires_at && Date.parse(r.expires_at) <= now) return { ok: false, code: 'TOKEN_EXPIRED', message: `token '${r.name}' expired on ${r.expires_at.slice(0, 10)}; create a new one under Tokens` };
  db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(new Date(now).toISOString(), r.id);
  return { ok: true, userId: r.user_id, scope: r.scope };
}
