// Account tools: who am I, and share a design environment (owner or admin).

import { HttpError, badRequest } from '../../errors.ts';
import { currentWho } from '../../auth/context.ts';
import { findUser, listUsers } from '../../store/users.ts';
import { matchUser } from '../../../core/users-match.ts';
import { getAccess, setAccess } from '../../store/env-access.ts';
import { requireRole } from '../../access.ts';
import { userEmail } from '../../auth/accounts.ts';
import { type Tool, obj } from './common.ts';

export const whoamiTool: Tool = {
  name: 'whoami', description: 'The user this connection acts as (the owner of the token), whether they are an admin, and the token scope (user | harvester). With auth off: {auth: "off"}.',
  inputSchema: obj({}),
  run: (c) => {
    const p = currentWho();
    if (!p || p.via === 'off') return { auth: 'off', admin: true, scope: 'harvester' };
    const u = p.id ? findUser(c.db, p.id) : undefined;
    return { auth: 'cognito', user: u ? { id: u.id, name: u.name, email: userEmail(c.db, u.id) } : null, admin: p.admin, scope: p.scope };
  },
};

export const shareEnvTool: Tool = {
  name: 'share_env', description: "Share a design environment you own (or as an admin): `members` replaces the list of people with access ([{user: id or exact name, role: 'viewer' | 'editor'}]; viewers read, editors also open and apply drafts), `published` makes it readable by everyone signed in. Omit a field to leave it. Returns the access as it is now. Designs you create start private.",
  inputSchema: obj({ env: { type: 'string' }, published: { type: 'boolean' }, members: { type: 'array', items: obj({ user: { type: 'string', description: 'User id (u_...) or exact name' }, role: { enum: ['viewer', 'editor'] } }, ['user', 'role']) } }, ['env']),
  run: (c, a) => {
    const role = requireRole(c.db, a.env, 'owner');
    const members = a.members === undefined ? undefined : (() => {
      if (!Array.isArray(a.members)) throw badRequest('members must be a list of {user, role}');
      return a.members.map((m: any) => {
        const u = findUser(c.db, String(m?.user)) ?? matchUser(listUsers(c.db), { name: String(m?.user) })?.user;
        if (!u) throw new HttpError(400, 'BAD_REQUEST', `no user '${m?.user}' (see list_users)`);
        return { userId: u.id, role: m.role };
      });
    })();
    setAccess(c.db, a.env, { published: a.published, members }, !!currentWho()?.admin);
    return getAccess(c.db, a.env, role);
  },
};
