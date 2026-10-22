// Preview backend, users (0.31.0): the same rules as server/store/users.ts, in memory, with the same core/ matcher. The bundled list comes from
// the build (`data.users`); what the viewer creates, renames or merges is lost on reload.

import { matchUser, nameKey, colorSlot, MAX_USER_NAME } from '../core/users-match.js';
import { cleanName } from '../core/comments.js';

export function createUsers(data) {
  const fail = (message, status, code) => { const e = new Error(message); e.status = status; e.code = code; throw e; };
  const list = () => (data.users ??= []);
  const name = (n) => { const s = typeof n === 'string' ? cleanName(n) : ''; if (!s) fail('name is required', 400); if (s.length > MAX_USER_NAME) fail(`name is longer than ${MAX_USER_NAME} characters`, 400); return s; };
  const counts = (id) => {
    const rows = Object.values(data.comments ?? {}).flat(), items = Object.values(data.actionItems ?? {}).flatMap((x) => x.items ?? []);
    return { comments: rows.filter((r) => r.authorId === id && !r.deletedAt).length, items: items.filter((i) => i.ownerId === id).length, mentions: rows.filter((r) => !r.deletedAt && (r.body ?? '').includes(`@[${id}]`)).length };
  };
  const get = (id) => list().find((u) => u.id === id) ?? fail(`user '${id}' not found`, 404, 'NOT_FOUND');
  const make = (n, externalIds) => {
    const u = { id: `u_${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`, name: n, color: 0, createdAt: new Date().toISOString(), lastSeenAt: null, aliases: [], externalIds: externalIds ?? [] };
    u.color = colorSlot(u.id); list().push(u); return u;
  };
  return {
    users: async () => ({ users: list().map((u) => ({ ...structuredClone(u), counts: counts(u.id) })) }),
    createUser: async (b) => {
      const n = name(b?.name), m = matchUser(list(), { name: n });
      if (m && b?.match) return structuredClone(m.user);
      if (m) fail(`a user named '${n}' exists`, 409, 'NAME_TAKEN');
      return structuredClone(make(n, b?.externalIds));
    },
    renameUser: async (id, b) => {
      const u = get(id), n = name(b?.name);
      if (list().some((x) => x.id !== id && nameKey(x.name) === nameKey(n))) fail(`a user named '${n}' exists`, 409, 'NAME_TAKEN');
      if (b?.keepAlias && nameKey(u.name) !== nameKey(n)) u.aliases.push(u.name);
      u.name = n; return structuredClone(u);
    },
    mergeUser: async (id, into) => {
      const a = get(id), b = get(into);
      if (a.id === b.id) fail('cannot merge a user into itself', 400);
      for (const r of Object.values(data.comments ?? {}).flat()) { if (r.authorId === a.id) r.authorId = b.id; r.body = (r.body ?? '').replaceAll(`@[${a.id}]`, `@[${b.id}]`); }
      for (const l of Object.values(data.actionItems ?? {})) for (const i of l.items ?? []) { if (i.ownerId === a.id) i.ownerId = b.id; if (i.createdById === a.id) i.createdById = b.id; }
      b.aliases.push(...a.aliases, a.name); b.externalIds.push(...a.externalIds);
      data.users = list().filter((u) => u.id !== a.id);
      return structuredClone(b);
    },
    /** The user a write names (by id, else by name; created when new), for the preview's comment and item writes. */
    userFor: (id, n) => (id && list().find((u) => u.id === id)) || matchUser(list(), { name: n })?.user || make(name(n)),
  };
}
