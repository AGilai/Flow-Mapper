// Mentions in an `about` (0.33.0, info pane extra 2): a `@[userId]` in the About of a component or a subsystem counts on the Mentions page like a comment mention,
// as "about of <item>". They are read from the environments as they are (a draft's about shows once it is applied). An about has no thread to answer, so there is
// nothing "unread" about it: these rows never count in the rail's badge.

import type { DB } from '../db/connection.ts';
import { MENTION_RE } from '../../core/mentions.ts';
import { nameIndex } from './users.ts';
import { userOf } from './mentions-read.ts';

export interface AboutMention { env: string; kind: 'component' | 'subsystem'; id: string; label: string; text: string }

/** The line of `about` that holds the token, as plain text with every `@[id]` written as `@Name` and the Markdown marks left out. */
export function mentionLine(about: string, user: string, names: Map<string, { name: string }>): string {
  const token = `@[${user}]`, line = about.split('\n').find((l) => l.includes(token)) ?? '';
  return line.replace(/^\s*(#{1,6}|[-*]|\d+[.)])\s+/, '').replace(MENTION_RE, (_m, id) => `@${names.get(id)?.name ?? 'unknown user'}`).replace(/[*_~`]/g, '').trim().slice(0, 200);
}

/** Newest environment first is not meaningful here: components by environment and name, then subsystems by environment and key. */
export function listAboutMentions(db: DB, userId: unknown, env: string | null = null): AboutMention[] {
  const user = userOf(db, userId), names = nameIndex(db), like = `%@[${user}]%`, out: AboutMention[] = [];
  const envOk = (e: string) => !env || e === env;
  for (const r of db.prepare('SELECT env, service, meta FROM snapshots WHERE meta LIKE ? ORDER BY env, service').all(like) as unknown as { env: string; service: string; meta: string }[]) {
    const about = (JSON.parse(r.meta) as { about?: unknown }).about;
    if (envOk(r.env) && typeof about === 'string' && about.includes(`@[${user}]`)) out.push({ env: r.env, kind: 'component', id: r.service, label: r.service, text: mentionLine(about, user, names) });
  }
  for (const r of db.prepare('SELECT name, groups FROM envs WHERE groups LIKE ? ORDER BY name').all(like) as unknown as { name: string; groups: string }[]) {
    for (const g of JSON.parse(r.groups) as { key: string; label: string; about?: string }[]) {
      if (envOk(r.name) && typeof g.about === 'string' && g.about.includes(`@[${user}]`)) out.push({ env: r.name, kind: 'subsystem', id: g.key, label: g.label || g.key, text: mentionLine(g.about, user, names) });
    }
  }
  return out;
}
