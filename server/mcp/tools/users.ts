// The users registry for agents (0.31.0): who exists, so an agent can @mention someone by id or by name.

import { listUsers } from '../../store/users.ts';
import { filterUsers } from '../../../core/users-match.ts';
import { type Tool, obj } from './common.ts';

export const listUsersTool: Tool = {
  name: 'list_users',
  description: "The users registry: id, name, aliases and external ids (e.g. a Confluence id) of every user, most recently active first. query: filter by name. To mention someone in add_comment write @[id] or @{Display Name}. Read only.",
  inputSchema: obj({ query: { type: 'string', description: 'Part of a name' } }),
  run: (c, a) => { const users = listUsers(c.db); return { users: a.query ? filterUsers(users, String(a.query)) : users }; },
};
