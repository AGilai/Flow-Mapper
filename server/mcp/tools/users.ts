// The users registry for agents (0.32.0): who exists, so an agent can @mention someone by id or by name.

import { listUsers, findUser } from '../../store/users.ts';
import { listMentions } from '../../store/mentions-read.ts';
import { filterUsers, matchUser } from '../../../core/users-match.ts';
import { badRequest } from '../../errors.ts';
import { type Tool, obj } from './common.ts';

export const listUsersTool: Tool = {
  name: 'list_users',
  description: "The users registry: id, name, aliases and external ids (e.g. a Confluence id) of every user, most recently active first. query: filter by name. To mention someone in add_comment write @[id] or @{Display Name}. Read only.",
  inputSchema: obj({ query: { type: 'string', description: 'Part of a name' } }),
  run: (c, a) => { const users = listUsers(c.db); return { users: a.query ? filterUsers(users, String(a.query)) : users }; },
};

export const listMentionsTool: Tool = {
  name: 'list_mentions',
  description: "The comments that @mention a user, across every environment, newest first: comment id, env, flow (service + ingress), step key, who wrote it, plain text and html, time and `unread` (a mention is unread until that user has seen it in the UI). user: a user id or an exact name (see list_users). unread: only the unread ones. env: only one environment. Read only.",
  inputSchema: obj({ user: { type: 'string', description: 'User id (u_...) or exact name' }, unread: { type: 'boolean' }, env: { type: 'string' }, limit: { type: 'integer' } }, ['user']),
  run: (c, a) => {
    const u = findUser(c.db, String(a.user)) ?? matchUser(listUsers(c.db), { name: String(a.user) })?.user;
    if (!u) throw badRequest(`no user '${a.user}' (see list_users)`);
    const mentions = listMentions(c.db, { user: u.id, unread: !!a.unread, env: a.env ?? null, limit: a.limit });
    return { user: { id: u.id, name: u.name }, unread: mentions.filter((m) => m.unread).length, mentions };
  },
};
