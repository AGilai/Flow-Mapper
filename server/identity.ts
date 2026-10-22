// Who is calling: the ONE module that turns a request into a user. Naive identity (0.32.0): the web client sends `X-Flow-User: <userId>` (the
// user it signed in as in that browser; there is no password), and REST clients without the header keep sending an `author` / `actor` name,
// matched to a user (created when new). MCP writes are "Assistant" unless an author is given. When Cognito comes, only this module changes
// (a verified token -> user id); the stores and routes already take a Caller. Spec: docs/plans/users-mentions.md "Maintainer amendment".

import type { IncomingHttpHeaders } from 'node:http';
import type { DB } from './db/connection.ts';
import { badRequest } from './errors.ts';
import { cleanName } from '../core/comments.ts';
import { ensureUser, findUser, touch, userName } from './store/users.ts';

export const USER_HEADER = 'x-flow-user';
export const ASSISTANT = 'Assistant';
/** `id` is null only for a read-only identification (`create: false`) of a name nobody has. */
export interface Caller { id: string | null; name: string }
export interface Claim { userId?: string | null; name?: unknown; source?: unknown; externalId?: unknown; what?: string }

/** The user id a request claims with the header, or undefined. */
export function headerUser(h: IncomingHttpHeaders | undefined): string | undefined {
  const v = h?.[USER_HEADER];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : undefined;
}

/** The caller: the header's user wins over a name; else the name (or external id) is matched, and created unless `create` is false. */
export function identify(db: DB, c: Claim, create = true): Caller {
  if (c.userId) {
    const u = findUser(db, c.userId);
    if (!u) throw badRequest(`unknown user '${c.userId}' in X-Flow-User`);
    touch(db, u.id);
    return { id: u.id, name: u.name };
  }
  const name = userName(typeof c.name === 'string' ? cleanName(c.name) : c.name, c.what ?? 'author');
  const source = typeof c.source === 'string' && c.source ? c.source : null, externalId = typeof c.externalId === 'string' && c.externalId ? c.externalId : null;
  const u = ensureUser(db, { name, source, externalId }, create);
  if (!u) return { id: null, name };
  touch(db, u.id);
  return { id: u.id, name: u.name };
}
