// The one place per event kind that builds a push event's payload. Called by the store layer after the write committed.

import type { DB } from '../db/connection.ts';
import { emit } from './bus.ts';

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function bugCreated(db: DB, id: number, b: { title: string; severity: string; priority: string; env: string; reporter: string; links: unknown[] }) {
  emit(db, { type: 'bug.created', env: b.env, bugId: id, reporter: b.reporter, summary: `#${id} ${b.priority}/${b.severity} reported by ${b.reporter}: ${clip(b.title, 100)}`,
    data: { title: b.title, severity: b.severity, priority: b.priority, links: b.links.length } });
}

export function bugCommented(db: DB, bug: { id: number; env: string; reporter: string }, commentId: number, author: string, body: string) {
  emit(db, { type: 'bug.commented', env: bug.env, bugId: bug.id, reporter: bug.reporter, summary: `#${bug.id} comment by ${author}: ${clip(body.replace(/\s+/g, ' '), 100)}`,
    data: { commentId, author, body: clip(body, 1000) } });
}

/** One bug.status (status changed, with the fixedInVersion/resolution that came with it) and/or one bug.updated (other fields). */
export function bugPatched(db: DB, cur: any, after: any, patchKeys: string[]) {
  const base = { env: cur.env as string, bugId: cur.id as number, reporter: cur.reporter as string };
  const statusChanged = after.status !== cur.status;
  if (statusChanged) {
    const fixed = after.fixed_in_version ? ` in ${after.fixed_in_version}` : '';
    emit(db, { type: 'bug.status', ...base, summary: `#${cur.id} ${cur.status} -> ${after.status}${fixed}`,
      data: { from: cur.status, to: after.status, fixedInVersion: after.fixed_in_version ?? null, resolution: after.resolution ? JSON.parse(after.resolution) : null, assignee: after.assignee ?? null } });
  }
  const fields = patchKeys.filter((k) => k !== 'status' && !(statusChanged && (k === 'fixedInVersion' || k === 'resolution')));
  if (fields.length) emit(db, { type: 'bug.updated', ...base, summary: `#${cur.id} updated: ${fields.join(', ')}`, data: { fields } });
}

export function manifestIngested(db: DB, r: { env: string; service: string; fromVersion: unknown; toVersion: unknown; changes: unknown }, m: any, source: string) {
  const producer = (JSON.stringify(m).match(/"producer":"([^"]*)"/) ?? [])[1] ?? null;
  const n = (o: any) => Object.values(o ?? {}).reduce((a: number, l: any) => a + l.length, 0);
  const counts = { added: n((r.changes as any).added), changed: n((r.changes as any).changed), removed: n((r.changes as any).removed) };
  emit(db, { type: 'manifest.ingested', env: r.env, summary: `${r.service} ${r.fromVersion ?? 'new'} -> ${r.toVersion} (${m.kind}) in ${r.env}`,
    data: { service: r.service, version: r.toVersion, fromVersion: r.fromVersion, kind: m.kind, producer, source, changes: counts } });
}

export function envCreated(db: DB, e: { name: string; source?: string | null; createdBy?: string }) {
  emit(db, { type: 'env.created', env: e.name, summary: `environment ${e.name} created${e.source ? ` from ${e.source}` : ''}`, data: { source: e.source ?? null, createdBy: e.createdBy ?? null } });
}
export function envUpdated(db: DB, name: string, what: string) {
  emit(db, { type: 'env.updated', env: name, summary: `environment ${name}: ${what} changed`, data: { what } });
}
export function envDeleted(db: DB, name: string) {
  emit(db, { type: 'env.deleted', env: name, summary: `environment ${name} deleted`, data: {} });
}

const commentEvent = (kind: string, db: DB, c: { env: string; anchor: string; id: number; author: string; text?: string }) =>
  emit(db, { type: `comment.${kind}`, env: c.env, summary: `${c.author} ${kind} a comment on ${c.anchor.replace(/^flow:/, '')}${c.text ? `: ${clip(c.text.replace(/\s+/g, ' '), 100)}` : ''}`,
    data: { anchor: c.anchor, id: c.id, author: c.author, ...(c.text !== undefined && { text: clip(c.text, 300) }) } });
export const commentCreated = (db: DB, c: { env: string; anchor: string; id: number; author: string; text: string }) => commentEvent('created', db, c);
export const commentEdited = (db: DB, c: { env: string; anchor: string; id: number; author: string; text: string }) => commentEvent('edited', db, c);
export const commentResolved = (db: DB, c: { env: string; anchor: string; id: number; author: string; resolved: boolean }) => commentEvent(c.resolved ? 'resolved' : 'reopened', db, c);
export const commentDeleted = (db: DB, c: { env: string; anchor: string; id: number; author: string }) => commentEvent('deleted', db, c);

/** A flow's Notes were saved (0.34.0): `version` is the new one; `restoredFrom` when it was a restore. */
export function notesUpdated(db: DB, n: { env: string; anchor: string; version: number; author: string; restoredFrom: number | null; text: string }) {
  emit(db, { type: 'notes.updated', env: n.env, summary: `${n.author} ${n.restoredFrom != null ? `restored version ${n.restoredFrom} of` : 'saved'} the notes of ${n.anchor.replace(/^flow:/, '')} (version ${n.version})`,
    data: { anchor: n.anchor, version: n.version, author: n.author, ...(n.restoredFrom != null && { restoredFrom: n.restoredFrom }), text: clip(n.text, 300) } });
}

export function actionItemChanged(db: DB, kind: 'created' | 'updated' | 'deleted', a: { env: string; anchor: string; id: number; number: number; status: string; actor: string }) {
  emit(db, { type: `action_item.${kind}`, env: a.env, summary: `${a.actor} ${kind} action #${a.number} on ${a.anchor.replace(/^flow:/, '')} (${a.status})`, data: { anchor: a.anchor, id: a.id, number: a.number, status: a.status, actor: a.actor } });
}
