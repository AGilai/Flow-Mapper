// Browser sessions: a random id stored server-side (as a SHA-256 hash) in `sessions`, sent as an httpOnly cookie `fm_session` = <id>.<hmac>.
// Sliding 30 days. The HMAC key is generated once per database (app_secrets). A readable cookie `fm_csrf` carries the session's CSRF value for the
// double-submit check: non-GET cookie requests must send it back as X-Flows-CSRF.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DB } from '../db/connection.ts';

export const SESSION_COOKIE = 'fm_session', CSRF_COOKIE = 'fm_csrf', OIDC_COOKIE = 'fm_oidc', CSRF_HEADER = 'x-flows-csrf';
export const SESSION_MS = 30 * 86400_000;
const SLIDE_AFTER_MS = 10 * 60_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function secretOf(db: DB): string {
  const r = db.prepare("SELECT value FROM app_secrets WHERE name = 'cookie'").get() as { value: string } | undefined;
  if (r) return r.value;
  const v = randomBytes(32).toString('base64url');
  db.prepare("INSERT OR IGNORE INTO app_secrets (name, value) VALUES ('cookie', ?)").run(v);
  return (db.prepare("SELECT value FROM app_secrets WHERE name = 'cookie'").get() as { value: string }).value;
}
export const sign = (secret: string, v: string) => createHmac('sha256', secret).update(v).digest('base64url');
export const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
/** `<value>.<mac>` -> value when the mac is right. */
export function unsign(secret: string, s: string | undefined): string | null {
  const i = s ? s.lastIndexOf('.') : -1;
  if (!s || i < 1) return null;
  return safeEq(sign(secret, s.slice(0, i)), s.slice(i + 1)) ? s.slice(0, i) : null;
}

export function parseCookies(h: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (h ?? '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
  return out;
}
export function cookie(name: string, value: string, o: { maxAgeS?: number; httpOnly?: boolean; secure: boolean }): string {
  return `${name}=${value}; Path=/; SameSite=Lax${o.httpOnly === false ? '' : '; HttpOnly'}${o.secure ? '; Secure' : ''}${o.maxAgeS !== undefined ? `; Max-Age=${o.maxAgeS}` : ''}`;
}

export function createSession(db: DB, userId: string, now = Date.now()): { cookie: string; csrf: string } {
  const id = randomBytes(32).toString('base64url'), csrf = randomBytes(18).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date(now).toISOString());
  db.prepare('INSERT INTO sessions (id_hash, user_id, csrf, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha(id), userId, csrf, new Date(now).toISOString(), new Date(now).toISOString(), new Date(now + SESSION_MS).toISOString());
  return { cookie: `${id}.${sign(secretOf(db), id)}`, csrf };
}

export function lookupSession(db: DB, cookieValue: string | undefined, now = Date.now()): { userId: string; csrf: string } | null {
  const id = unsign(secretOf(db), cookieValue);
  if (!id) return null;
  const r = db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(sha(id)) as { user_id: string; csrf: string; last_seen_at: string; expires_at: string } | undefined;
  if (!r || Date.parse(r.expires_at) <= now) return null;
  if (now - Date.parse(r.last_seen_at) > SLIDE_AFTER_MS) db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?').run(new Date(now).toISOString(), new Date(now + SESSION_MS).toISOString(), sha(id));
  return { userId: r.user_id, csrf: r.csrf };
}

export function endSession(db: DB, cookieValue: string | undefined) {
  const id = unsign(secretOf(db), cookieValue);
  if (id) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha(id));
}
