// Mentions in a flow's Notes (0.34.0): a `@[userId]` in the current version of Notes counts on the Mentions page, as "in Notes". Like an About, a document has no
// thread to answer, so nothing is "unread": these rows never count in the rail's badge. A user merge re-points the token and the author id in every version.

import type { DB } from '../db/connection.ts';
import { parseFlowAnchor } from '../../core/comments.ts';
import { sanitize } from '../../core/rich-text.ts';
import { plainText } from '../../core/rich-text-text.ts';
import { MENTION_RE } from '../../core/mentions.ts';
import { nameIndex } from './users.ts';
import { userOf } from './mentions-read.ts';
import { sinceWrite } from './write-memo.ts';

export interface NotesMention { env: string; anchor: string; service: string; ingress: string; label: string; text: string }

/** The line of the notes that holds the token as plain text, every `@[id]` written as `@Name`. */
export function notesLine(body: string, user: string, names: Map<string, { name: string }>): string {
  const token = `@[${user}]`, line = plainText(sanitize(body, { notes: true })).split('\n').find((l) => l.includes(token)) ?? '';
  return line.replace(/^[-\s]+/, '').replace(MENTION_RE, (_m, id) => `@${names.get(id)?.name ?? 'unknown user'}`).trim().slice(0, 200);
}

/** The flows whose current Notes mention the user, by environment and flow. */
export function listNotesMentions(db: DB, userId: unknown, env: string | null = null): NotesMention[] {
  const user = userOf(db, userId); // the LIKE scan of the notes runs once per user between writes (F11)
  const all = sinceWrite(db, `notes-mentions|${user}`, () => scanNotes(db, user));
  return env ? all.filter((m) => m.env === env) : all;
}
function scanNotes(db: DB, user: string): NotesMention[] {
  const names = nameIndex(db), out: NotesMention[] = [];
  const rows = db.prepare(`SELECT n.env, n.anchor, n.body FROM flow_notes n WHERE n.body LIKE ? AND n.version = (SELECT MAX(version) FROM flow_notes WHERE env = n.env AND anchor = n.anchor)
    AND EXISTS (SELECT 1 FROM envs e WHERE e.name = n.env) ORDER BY n.env, n.anchor`).all(`%@[${user}]%`) as unknown as { env: string; anchor: string; body: string }[];
  for (const r of rows) {
    const f = parseFlowAnchor(r.anchor);
    if (f && r.body.includes(`@[${user}]`)) out.push({ env: r.env, anchor: r.anchor, service: f.service, ingress: f.ingress, label: `${f.service} · ${f.ingress}`, text: notesLine(r.body, user, names) });
  }
  return out;
}

/** A merge: the token and the author id of every version move to the surviving user. Call inside the merge transaction. */
export function repointNotes(db: DB, from: string, into: string) {
  db.prepare('UPDATE flow_notes SET body = replace(body, ?, ?) WHERE body LIKE ?').run(`@[${from}]`, `@[${into}]`, `%@[${from}]%`);
  db.prepare('UPDATE flow_notes SET author_id = ? WHERE author_id = ?').run(into, from);
}
