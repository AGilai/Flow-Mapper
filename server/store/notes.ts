// A flow's Notes (0.34.0, migration 017): one rich document per (env, anchor) kept as versions. Every Save is a new row, the latest is current,
// a restore writes a new version and nothing is deleted. Bodies are sanitized HTML (core/rich-text.ts, notes: true); every write sanitizes and
// every read does again. Annotations like comments and descriptions: any environment takes them (sealed and harvested ones too), anyone writes.
// A Save names the version it started from (`baseVersion`); a mismatch is a 409 STALE_NOTES that carries the current version, never a silent overwrite.
// Spec: docs/plans/notes-tabs.md.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import type { GraphIndex } from '../../core/graph-index.ts';
import { requireFlow } from './flow-check.ts';
import { parseFlowAnchor } from '../../core/comments.ts';
import type { NotesDoc, NotesVersion } from '../../core/notes.ts';
import { sanitize, notesTooLong } from '../../core/rich-text.ts';
import { plainText } from '../../core/rich-text-text.ts';
import { badRequest, conflict, invalid, notFound } from '../errors.ts';
import { notesUpdated } from '../events/emitters.ts';
import { checkEnv } from './comments-rows.ts';
import { identify } from '../identity.ts';
import { nameIndex } from './users.ts';
import { resolveMentions } from './mentions.ts';
import { sinceWrite } from './write-memo.ts';

interface R { env: string; anchor: string; version: number; body: string; author: string; author_id: string | null; restored_from: number | null; created_at: string }
const HISTORY = 30;

function anchorOf(a: unknown): string { if (!parseFlowAnchor(a)) throw badRequest("anchor must be 'flow:<service>/<ingress>'"); return a as string; }
const doc = (db: DB, r: R, names = nameIndex(db)): NotesDoc => ({ anchor: r.anchor, version: r.version, body: sanitize(r.body, { notes: true }), author: (r.author_id && names.get(r.author_id)?.name) || r.author, authorId: r.author_id, createdAt: r.created_at, restoredFrom: r.restored_from });
const none = (anchor: string): NotesDoc => ({ anchor, version: 0, body: '', author: null, authorId: null, createdAt: null, restoredFrom: null });
const latest = (db: DB, env: string, anchor: string) => db.prepare('SELECT * FROM flow_notes WHERE env = ? AND anchor = ? ORDER BY version DESC LIMIT 1').get(env, anchor) as unknown as R | undefined;

/** The notes of a flow: the latest version, or `version` N; version 0 with an empty body when the flow has none yet. */
export function getNotes(db: DB, env: string, anchorIn: unknown, version?: number | null): NotesDoc {
  checkEnv(db, env);
  const anchor = anchorOf(anchorIn);
  if (version == null) { const r = latest(db, env, anchor); return r ? doc(db, r) : none(anchor); }
  const r = db.prepare('SELECT * FROM flow_notes WHERE env = ? AND anchor = ? AND version = ?').get(env, anchor, Number(version)) as unknown as R | undefined;
  if (!r) throw notFound(`version ${version} of the notes of ${anchor}`);
  return doc(db, r);
}

/** The latest versions, newest first (`limit` at most 100, default 30), with the total. */
export function history(db: DB, env: string, anchorIn: unknown, limit = HISTORY): { anchor: string; current: number; total: number; versions: NotesVersion[] } {
  checkEnv(db, env);
  const anchor = anchorOf(anchorIn), names = nameIndex(db), n = Math.min(100, Math.max(1, Math.floor(Number(limit)) || HISTORY));
  const rows = db.prepare('SELECT * FROM flow_notes WHERE env = ? AND anchor = ? ORDER BY version DESC LIMIT ?').all(env, anchor, n) as unknown as R[];
  const total = (db.prepare('SELECT COUNT(*) AS n FROM flow_notes WHERE env = ? AND anchor = ?').get(env, anchor) as unknown as { n: number }).n;
  return { anchor, current: rows[0]?.version ?? 0, total, versions: rows.map((r) => ({ version: r.version, author: (r.author_id && names.get(r.author_id)?.name) || r.author, authorId: r.author_id, createdAt: r.created_at, restoredFrom: r.restored_from, size: plainText(r.body).length })) };
}

export interface NotesWrite { anchor: string; body: string; baseVersion?: number | null; author?: string; authorId?: string | null }
export type Saved = NotesDoc & { unchanged?: true };

/** Write the next version. `baseVersion` (the version the writer started from) must be the current one; null / omitted skips the check (a REST or MCP writer that does not track versions). */
export function putNotes(db: DB, g: GraphIndex, env: string, i: NotesWrite, restoredFrom: number | null = null): Saved {
  checkEnv(db, env);
  const anchor = anchorOf(i?.anchor);
  if (typeof i.body !== 'string') throw badRequest('body is required (HTML or text; empty clears the notes)');
  const body = sanitize(resolveMentions(db, i.body), { notes: true }), long = notesTooLong(body);
  if (long) throw invalid(long);
  const f = parseFlowAnchor(anchor)!;
  requireFlow(g, env, f.service, f.ingress);
  const who = identify(db, { userId: i.authorId, name: i.author });
  const base = i.baseVersion == null ? null : Number(i.baseVersion);
  if (base !== null && (!Number.isInteger(base) || base < 0)) throw badRequest('baseVersion must be a whole number (0 for no notes yet)');
  const row = tx(db, () => {
    const cur = latest(db, env, anchor), have = cur?.version ?? 0;
    if (base !== null && base !== have) throw conflict('STALE_NOTES', `the notes are at version ${have}, not ${base}: someone saved since you opened them`, { current: cur ? doc(db, cur) : none(anchor) });
    if (cur && restoredFrom === null && cur.body === body) return { r: cur, unchanged: true as const };
    const at = new Date().toISOString();
    db.prepare('INSERT INTO flow_notes (env, anchor, version, body, author, author_id, restored_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(env, anchor, have + 1, body, who.name, who.id, restoredFrom, at);
    return { r: latest(db, env, anchor)!, unchanged: false as const };
  });
  if (!row.unchanged) notesUpdated(db, { env, anchor, version: row.r.version, author: who.name, restoredFrom, text: plainText(body) });
  return { ...doc(db, row.r), ...(row.unchanged && { unchanged: true as const }) };
}

/** Restore: the text of an older version as a new version ("Restored from version N"). */
export function restoreNotes(db: DB, g: GraphIndex, env: string, i: { anchor: string; version: number; baseVersion?: number | null; author?: string; authorId?: string | null }): Saved {
  const old = getNotes(db, env, i?.anchor, Number(i?.version));
  return putNotes(db, g, env, { anchor: old.anchor, body: old.body, baseVersion: i.baseVersion, author: i.author, authorId: i.authorId }, old.version);
}

/** A Full copy carries the notes: every version, as written. */
export function copyNotes(db: DB, from: string, to: string) {
  db.prepare('INSERT INTO flow_notes (env, anchor, version, body, author, author_id, restored_from, created_at) SELECT ?, anchor, version, body, author, author_id, restored_from, created_at FROM flow_notes WHERE env = ? ORDER BY id').run(to, from);
}

/** Every flow that has notes with content, for the static preview build: the latest version and the history rows. */
export function allNotes(db: DB, env: string): R[] { return db.prepare('SELECT * FROM flow_notes WHERE env = ? ORDER BY anchor, version').all(env) as unknown as R[]; }

/** The flows of an env that have notes with content: `{anchor: version}` (for the Flows list and the default tab). */
export function notesIndex(db: DB, env: string): Record<string, number> {
  checkEnv(db, env);
  return sinceWrite(db, `notes-index|${env}`, () => { // the text check of every flow's latest version runs once between writes (F6)
    const rows = db.prepare('SELECT n.anchor, n.version, n.body FROM flow_notes n WHERE n.env = ? AND n.version = (SELECT MAX(version) FROM flow_notes WHERE env = n.env AND anchor = n.anchor)').all(env) as unknown as R[];
    return Object.fromEntries(rows.filter((r) => plainText(r.body)).map((r) => [r.anchor, r.version]));
  });
}

export interface SampleNotes { service: string; ingress: string; author: string; body: string; ago?: number; versions?: { author: string; body: string; ago?: number }[] }
/** Seed data (samples/notes/*.json: `{env, notes: [...]}`): earlier `versions` first, then the body as the latest. Seeding twice adds nothing (a flow that already has a version with the final text is skipped). */
export function loadNotes(db: DB, g: GraphIndex, env: string, list: SampleNotes[], warn: (m: string) => void = () => {}): number {
  let n = 0;
  for (const s of list) {
    try {
      const anchor = `flow:${s.service}/${s.ingress}`, steps = [...(s.versions ?? []), { author: s.author, body: s.body, ago: s.ago }];
      const final = sanitize(resolveMentions(db, s.body), { notes: true });
      if (db.prepare('SELECT 1 FROM flow_notes WHERE env = ? AND anchor = ? AND body = ?').get(env, anchor, final)) continue; // seeded before (or typed in by hand)
      for (const v of steps) {
        const r = putNotes(db, g, env, { anchor, body: v.body, author: v.author });
        if (r.unchanged) continue;
        if (v.ago != null) db.prepare('UPDATE flow_notes SET created_at = ? WHERE env = ? AND anchor = ? AND version = ?').run(new Date(Date.now() - v.ago * 60000).toISOString(), env, anchor, r.version);
        n++;
      }
    } catch (e) { warn(`skipped notes on ${s.service} / ${s.ingress}: ${(e as Error).message}`); }
  }
  return n;
}
