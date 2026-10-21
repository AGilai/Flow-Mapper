// Import one level of another environment into an open draft of a design (core/import-level.ts has the rules): a preview that
// reads only, and the import itself, which appends one upsert per item with its origin (the baseline of what came in: marks read
// it from the ops until apply copies it into baseline_items). Sealed environments take no draft, so they take no import.

import type { Ctx } from '../context.ts';
import { tx } from '../db/connection.ts';
import { netOps, overlayRows } from '../../core/draft-ops.ts';
import { infraOwnerName } from '../../core/infra-owner.ts';
import { ImportError, importSet, type ImportSet } from '../../core/import-level.ts';
import { importOps, previewOf, type ImportPreview } from '../../core/import-preview.ts';
import type { ItemRow } from '../../core/item-rows.ts';
import { badRequest, HttpError, notFound } from '../errors.ts';
import { cached } from '../design-rows.ts';
import { getEnvRow, guardEnv } from './envs.ts';
import { appendOps, getDraft, loadOps } from './drafts.ts';
import { envItemRows } from './item-rows.ts';

export interface ImportRequest { source: string; anchor: string; groupPath?: string }

const STATUS = { NO_ITEM: 404, BAD_ANCHOR: 400, NOTHING_TO_IMPORT: 409, NO_GROUP: 422 } as const;

function plan(ctx: Ctx, env: string, slug: string, i: ImportRequest): { set: ImportSet; preview: ImportPreview } {
  const { db } = ctx;
  guardEnv(db, env, 'draft');
  const d = getDraft(db, env, slug);
  if (typeof i?.source !== 'string' || !getEnvRow(db, i.source)) throw notFound(`source environment '${i?.source}'`);
  if (i.source === env) throw badRequest(`source must be another environment than '${env}' (the one being designed)`);
  if (typeof i.anchor !== 'string') throw badRequest('anchor is required: ing:<service>/<id> or svc:<service>');
  if (i.groupPath !== undefined && typeof i.groupPath !== 'string') throw badRequest('groupPath must be a string');
  const here = overlayRows(envItemRows(db, env), netOps(loadOps(db, d.id)));
  const srcRows = cached<ItemRow[]>(`rows:${i.source}`, [i.source], () => envItemRows(db, i.source));
  const names = new Set([...here, ...srcRows].filter((r) => r.list === 'header').map((r) => r.service));
  const existing = here.find((r) => r.list === 'header' && r.data?.kind === 'infra' && r.service.startsWith(`${i.source}-infra`))?.service;
  try {
    const set = importSet({
      source: i.source, anchor: i.anchor, srcRows, srcGraph: ctx.view(i.source).g,
      srcVersions: new Map(srcRows.filter((r) => r.list === 'header').map((r) => [r.service, Number(r.data?.version) || 0])),
      here, groups: (JSON.parse(getEnvRow(db, env)!.groups) as { key: string }[]).map((g) => g.key), groupPath: i.groupPath,
      infraOwner: existing ?? infraOwnerName(names, i.source),
    });
    return { set, preview: previewOf(set, i.anchor, i.source) };
  } catch (e) {
    if (e instanceof ImportError) throw new HttpError(STATUS[e.code], e.code, e.message);
    throw e;
  }
}

/** What importing `anchor` from `source` into the draft would bring. Writes nothing. */
export const importPreview = (ctx: Ctx, env: string, slug: string, i: ImportRequest): ImportPreview => plan(ctx, env, slug, i).preview;

/** Import it: one upsert per item, all or nothing, in one transaction. The caller drops the draft's cached view (ctx.changedDraft). */
export function importIntoDraft(ctx: Ctx, env: string, slug: string, i: ImportRequest, who: { author?: string; byAi?: boolean } = {}) {
  return tx(ctx.db, () => {
    const { set, preview } = plan(ctx, env, slug, i);
    const { ops, origins } = importOps(set);
    return { ...appendOps(ctx.db, env, slug, ops, { ...who, origins }), preview };
  });
}
