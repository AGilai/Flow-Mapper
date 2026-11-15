// Who is signed in (AWS v1 accounts). `auth` is 'off' on a server without Cognito (and in the static preview): nothing changes there, everyone is an admin.
// With cognito the browser holds an httpOnly session cookie; this module only knows the answer of GET /api/me and the readable CSRF cookie that writes echo back.

import { state } from './state.js';

export const account = { auth: 'off', signedIn: true, user: null, admin: true, via: null };
export const isCognito = () => account.auth === 'cognito';

export async function loadAccount() {
  if (globalThis.FLOW_PREVIEW) return account;
  try { const r = await fetch('/api/me'); if (r.ok) Object.assign(account, await r.json()); } catch { /* an old server: auth off */ }
  return account;
}

/** The value of the fm_csrf cookie: sent as X-Flows-CSRF on every write (double submit). */
export const csrfToken = () => ((globalThis.document?.cookie ?? '').match(/(?:^|; )fm_csrf=([^;]*)/) ?? [])[1] ?? '';

/** What the server told the env list about the caller: {ownerId, ownerName, visibility, published, memberCount, role, member}; null on a server without accounts. */
export const accessOf = (name = state.env) => state.envMeta.find((m) => m.name === name)?.access ?? null;
/** The caller's role in an env: owner | editor | viewer | none. Without accounts everyone is an owner. */
export const roleIn = (name = state.env) => (isCognito() ? accessOf(name)?.role ?? 'viewer' : 'owner');
export const canEditEnv = (name = state.env) => ['editor', 'owner'].includes(roleIn(name));
export const canManageEnv = (name = state.env) => roleIn(name) === 'owner';
export const isMine = (a) => !!a && !!account.user && a.ownerId === account.user.id;
