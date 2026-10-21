// Apply a draft: its net ops become manifests (one delta per touched service, a full manifest per new one), ingested in ONE
// transaction through the same code as a harvester push, plus the side tables (DTOs, schemas, flow texts). Newer edit wins:
// an op whose item changed in the environment since the draft first touched it overwrites it, and the report lists it.

import type { DB } from '../db/connection.ts';
import type { Ctx } from '../context.ts';
import { buildIndex } from '../../core/graph-index.ts';
import { draftChanges, netOps, type DraftOp } from '../../core/draft-ops.ts';
import { draftManifests } from '../../core/draft-manifests.ts';
import { rowId } from '../../core/item-rows.ts';
import { rawHash } from '../../core/diff/normalise.ts';
import { conflict } from '../errors.ts';
import { guardEnv } from './envs.ts';
import { getDraft, loadOps } from './drafts.ts';
import { envItemRows } from './item-rows.ts';
import { ingestIn } from './snapshots-ingest.ts';
import { deleteServiceIn } from './snapshots-crud.ts';
import { loadModel, type Source, type WriteResult } from './snapshots-read.ts';
import { writeChangelog } from './snapshots-write.ts';
import { writeSide } from './draft-side.ts';
import { writeDesignSide } from './design-side.ts';
import { writeImportBaseline } from './baseline-write.ts';
import { withDry } from './dry-run.ts';

export interface ApplyResult { applied: boolean; dryRun?: boolean; results: WriteResult[]; replaced: Replaced[]; changelogId?: number; warnings: string[] }
export interface Replaced { anchor: string; baseHash: string | null; nowHash: string | null; now: unknown }

/** Net ops whose environment item is not what it was when the draft first touched it: they overwrite a newer edit. */
function replacedBy(net: DraftOp[], env: Map<string, { data: any; list: string }>): Replaced[] {
  const out: Replaced[] = [];
  for (const o of net) {
    const e = env.get(rowId(o)), nowHash = e ? rawHash(e.data, o.list) : null;
    if (nowHash !== o.baseHash && (e || o.baseHash !== null)) out.push({ anchor: o.anchor, baseHash: o.baseHash, nowHash, now: e?.data ?? null });
  }
  return out;
}

/** The apply itself, inside the caller's transaction (dry runs and `?draft=` preludes use this directly). */
export function applyDraftIn(db: DB, env: string, slug: string, opts: { by: string; source: Source; dryRun?: boolean }): ApplyResult {
  guardEnv(db, env, opts.dryRun ? 'dry' : 'draft');
  const d = getDraft(db, env, slug);
  const ops = loadOps(db, d.id), net = netOps(ops), envRows = envItemRows(db, env);
  const changes = draftChanges(envRows, net, ops);
  if (!changes.items.length) throw conflict('DRAFT_EMPTY', `draft '${slug}' changes nothing: there is nothing to apply`);
  const replaced = replacedBy(net, new Map(envRows.map((r) => [rowId(r), r])));
  const dm = draftManifests(net, envRows, new Date().toISOString(), env);
  const results = dm.manifests.length ? ingestIn(db, dm.manifests, opts.source, { writer: 'draft', tolerateExisting: true, replaceHeader: dm.replaceHeader, draftId: d.id }) : [];
  for (const name of dm.deletes) deleteServiceIn(db, env, name, opts.source, d.id);
  const warnings = writeSide(db, env, dm.side, buildIndex(loadModel(db, env)), opts.by);
  writeDesignSide(db, env, dm.side, opts.by);
  const imported = writeImportBaseline(db, env, ops);
  const changelogId = writeChangelog(db, env, '', null, null, 'draft', opts.source, { draft: slug, name: d.name, counts: changes.counts, replaced: replaced.map((r) => r.anchor), ...(imported ? { imported } : {}) }, d.id);
  const at = new Date().toISOString();
  db.prepare("UPDATE drafts SET status = 'applied', closed_at = ?, closed_by = ?, updated_at = ?, report = ? WHERE id = ?")
    .run(at, opts.by.slice(0, 80), at, JSON.stringify({ results: results.map(({ contract: _c, ...r }) => r), replaced, warnings, counts: changes.counts }), d.id);
  return { applied: true, results, replaced, changelogId, warnings };
}

/** Apply in one transaction. dryRun: everything runs and is rolled back; the result says what would have happened. */
export function applyDraft(db: DB, env: string, slug: string, opts: { by: string; source: Source; dryRun?: boolean }): ApplyResult {
  const out = withDry(db, !!opts.dryRun, () => applyDraftIn(db, env, slug, opts));
  return opts.dryRun ? { ...out, applied: false, dryRun: true } : out;
}

/** applyDraft plus the cache invalidations a real apply needs (REST and MCP both call this). */
export function runApply(ctx: Ctx, env: string, slug: string, opts: { by: string; source: Source; dryRun?: boolean }): ApplyResult {
  const out = applyDraft(ctx.db, env, slug, opts);
  if (!opts.dryRun) { ctx.changed(env); ctx.changedDraft(env, slug); }
  return out;
}
