// Drafts of a design environment: a named list of whole-item ops, read as an overlay on the environment and applied
// later as one delta per touched service (store/draft-apply.ts). The ops table is append-only apart from undo / revert.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { badRequest, conflict, invalid, notFound } from '../errors.ts';
import { rowId, type ItemRow } from '../../core/item-rows.ts';
import { draftChanges, netOps, overlayRows, type DraftChanges, type DraftOp, type DraftOpInput, type OpOrigin } from '../../core/draft-ops.ts';
import { rawHash } from '../../core/diff/normalise.ts';
import { rowOfAnchor } from '../../core/anchors.ts';
import { guardEnv } from './envs.ts';
import { envItemRows } from './item-rows.ts';
import { prepareOps } from './draft-validate.ts';
import { assignColorsIn } from './colors.ts';

export interface DraftRow { id: number; env: string; slug: string; name: string; status: 'open' | 'applied' | 'discarded'; plan: string | null; report: string | null; created_by: string; created_at: string; updated_at: string; closed_at: string | null; closed_by: string | null }
export interface DraftInfo {
  id: number; slug: string; name: string; status: DraftRow['status']; createdBy: string; createdAt: string; updatedAt: string; closedAt: string | null;
  ops: number; authors: string[]; counts: { added: number; removed: number; changed: number };
}
const now = () => new Date().toISOString();
const SLUG = /^[a-z0-9][a-z0-9-]{0,48}$/;

export function getDraft(db: DB, env: string, slug: string, opts: { any?: boolean } = {}): DraftRow {
  const r = db.prepare('SELECT * FROM drafts WHERE env = ? AND slug = ?').get(env, slug) as DraftRow | undefined;
  if (!r) throw notFound(`draft '${slug}' in environment '${env}'`);
  if (!opts.any && r.status !== 'open') throw conflict('DRAFT_CLOSED', `draft '${slug}' is ${r.status}: it takes no more changes`, { status: r.status });
  return r;
}

export function loadOps(db: DB, id: number): DraftOp[] {
  return (db.prepare('SELECT * FROM draft_ops WHERE draft_id = ? ORDER BY seq').all(id) as any[]).map((r) => ({
    seq: r.seq, op: r.op, anchor: r.anchor, service: r.service, list: r.list, key: r.key, ...(r.data !== null ? { data: JSON.parse(r.data) } : {}),
    baseHash: r.base_hash, author: r.author, byAi: !!r.by_ai, at: r.at, ...(r.origin ? { origin: JSON.parse(r.origin) } : {}),
  }));
}

/** The environment's rows with the draft's net ops laid over them, plus the ops themselves. */
export function draftView(db: DB, env: string, slug: string) {
  const d = getDraft(db, env, slug);
  const ops = loadOps(db, d.id), net = netOps(ops), envRows = envItemRows(db, env);
  return { draft: d, ops, net, envRows, rows: overlayRows(envRows, net) };
}

export function changesOf(envRows: ItemRow[], ops: DraftOp[]): DraftChanges { return draftChanges(envRows, netOps(ops), ops); }

function info(db: DB, d: DraftRow, envRows: ItemRow[]): DraftInfo {
  const ops = loadOps(db, d.id);
  const closed = d.status !== 'open' && d.report ? JSON.parse(d.report).counts : null;
  return {
    id: d.id, slug: d.slug, name: d.name, status: d.status, createdBy: d.created_by, createdAt: d.created_at, updatedAt: d.updated_at, closedAt: d.closed_at,
    ops: ops.length, authors: [...new Set(ops.map((o) => o.author))], counts: closed ?? (d.status === 'open' ? changesOf(envRows, ops).counts : { added: 0, removed: 0, changed: 0 }),
  };
}
export const draftInfo = (db: DB, env: string, d: DraftRow): DraftInfo => info(db, d, d.status === 'open' ? envItemRows(db, env) : []);

export function listDrafts(db: DB, env: string, status: 'open' | 'all' = 'open'): DraftInfo[] {
  const rows = db.prepare(`SELECT * FROM drafts WHERE env = ? ${status === 'open' ? "AND status = 'open'" : ''} ORDER BY id`).all(env) as unknown as DraftRow[];
  const envRows = rows.some((r) => r.status === 'open') ? envItemRows(db, env) : [];
  return rows.map((r) => info(db, r, envRows));
}

function slugFor(db: DB, env: string, name: string, wanted?: string): string {
  const taken = (s: string) => !!db.prepare('SELECT 1 FROM drafts WHERE env = ? AND slug = ?').get(env, s);
  if (wanted !== undefined) {
    if (!SLUG.test(wanted)) throw invalid(`slug '${wanted}' must be lowercase letters, digits and '-' (it is used in links), at most 49 characters`);
    if (taken(wanted)) throw conflict('EXISTS', `draft '${wanted}' already exists in environment '${env}'`);
    return wanted;
  }
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'draft';
  let slug = base;
  for (let i = 2; taken(slug); i++) slug = `${base}-${i}`;
  return slug;
}

export function createDraft(db: DB, env: string, i: { name: string; slug?: string; createdBy?: string }): DraftInfo {
  if (typeof i?.name !== 'string' || !i.name.trim()) throw invalid('name is required');
  return tx(db, () => {
    guardEnv(db, env, 'draft');
    const slug = slugFor(db, env, i.name, i.slug), at = now();
    db.prepare('INSERT INTO drafts (env, slug, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(env, slug, i.name.trim().slice(0, 120), String(i.createdBy ?? 'anonymous').slice(0, 80), at, at);
    return draftInfo(db, env, getDraft(db, env, slug));
  });
}

export function renameDraft(db: DB, env: string, slug: string, name: unknown): DraftInfo {
  if (typeof name !== 'string' || !name.trim()) throw invalid('name is required');
  guardEnv(db, env, 'draft');
  const d = getDraft(db, env, slug);
  db.prepare('UPDATE drafts SET name = ?, updated_at = ? WHERE id = ?').run(name.trim().slice(0, 120), now(), d.id);
  return draftInfo(db, env, getDraft(db, env, slug));
}

/** Close a draft without applying it; its ops stay for the record. */
export function discardDraft(db: DB, env: string, slug: string, by = 'anonymous') {
  return tx(db, () => {
    guardEnv(db, env, 'draft');
    const d = getDraft(db, env, slug);
    const counts = changesOf(envItemRows(db, env), loadOps(db, d.id)).counts, at = now();
    db.prepare("UPDATE drafts SET status = 'discarded', closed_at = ?, closed_by = ?, updated_at = ?, report = ? WHERE id = ?").run(at, by.slice(0, 80), at, JSON.stringify({ discarded: true, counts }), d.id);
    return { discarded: slug };
  });
}

/** Append ops (validated against the overlay so far, all or nothing). seq = MAX(seq)+1 inside the transaction. */
export function appendOps(db: DB, env: string, slug: string, inputs: DraftOpInput[], who: { author?: string; byAi?: boolean; origins?: (OpOrigin | null)[] } = {}) {
  return tx(db, () => {
    guardEnv(db, env, 'draft');
    const d = getDraft(db, env, slug);
    const envRows = envItemRows(db, env), prior = loadOps(db, d.id);
    const overlay = new Map(overlayRows(envRows, netOps(prior)).map((r) => [rowId(r), r]));
    const prepared = prepareOps(overlay, inputs);
    const envMap = new Map(envRows.map((r) => [rowId(r), r]));
    const first = new Map<string, string | null>();
    for (const o of prior) if (!first.has(rowId(o))) first.set(rowId(o), o.baseHash);
    let seq = (db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM draft_ops WHERE draft_id = ?').get(d.id) as { m: number }).m;
    const from = seq + 1, at = now(), author = String(who.author ?? (who.byAi ? 'assistant' : 'anonymous')).slice(0, 80);
    const ins = db.prepare('INSERT INTO draft_ops (draft_id, seq, op, anchor, service, list, key, data, base_hash, author, by_ai, at, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [k, p] of prepared.entries()) {
      const id = rowId(p), e = envMap.get(id), origin = who.origins?.[k];
      if (!first.has(id)) first.set(id, e ? rawHash(e.data, p.list) : null);
      ins.run(d.id, ++seq, p.op, p.anchor, p.service, p.list, p.key, p.data === undefined ? null : JSON.stringify(p.data), first.get(id)!, author, who.byAi ? 1 : 0, at, origin ? JSON.stringify(origin) : null);
    }
    assignColorsIn(db, env, prepared.filter((p) => p.list === 'header' && p.op === 'upsert').map((p) => ({ name: p.service, kind: p.data?.kind })));
    db.prepare('UPDATE drafts SET updated_at = ? WHERE id = ?').run(at, d.id);
    return { from, to: seq, counts: changesOf(envRows, loadOps(db, d.id)).counts };
  });
}

export function undoLast(db: DB, env: string, slug: string) {
  return tx(db, () => {
    guardEnv(db, env, 'draft');
    const d = getDraft(db, env, slug);
    const last = db.prepare('SELECT MAX(seq) AS m FROM draft_ops WHERE draft_id = ?').get(d.id) as { m: number | null };
    if (last.m === null) throw notFound('an op to undo in this draft');
    db.prepare('DELETE FROM draft_ops WHERE draft_id = ? AND seq = ?').run(d.id, last.m);
    db.prepare('UPDATE drafts SET updated_at = ? WHERE id = ?').run(now(), d.id);
    return { removed: last.m };
  });
}

/** Revert one item: drop every op on its anchor (for `svc:<s>` also every op of that service's items). */
export function revertItem(db: DB, env: string, slug: string, anchor: string) {
  return tx(db, () => {
    guardEnv(db, env, 'draft');
    const d = getDraft(db, env, slug);
    let r: ReturnType<typeof rowOfAnchor>;
    try { r = rowOfAnchor(anchor); } catch (e: any) { throw badRequest(e.message); }
    const out = r.list === 'header'
      ? db.prepare('DELETE FROM draft_ops WHERE draft_id = ? AND (anchor = ? OR service = ?)').run(d.id, anchor, r.service)
      : db.prepare('DELETE FROM draft_ops WHERE draft_id = ? AND anchor = ?').run(d.id, anchor);
    if (!out.changes) throw notFound(`an op on '${anchor}' in this draft`);
    db.prepare('UPDATE drafts SET updated_at = ? WHERE id = ?').run(now(), d.id);
    return { removed: Number(out.changes) };
  });
}
