// Mermaid import into a draft (0.27.2): parse, match the participants to the design's components, make the edits, and (for the import
// itself) append them as ops of one batch. docs/plans/mermaid.md, API.md "Mermaid". The preview reads only; the import is all or nothing;
// Undo import removes one batch's ops unless a later op depends on them. Sealed environments refuse everything here (409 ENV_SEALED).

import { randomBytes } from 'node:crypto';
import type { Ctx } from '../context.ts';
import { tx } from '../db/connection.ts';
import { applyOp, netOps, opRow, overlayRows, type DraftOpInput, type OpOrigin } from '../../core/draft-ops.ts';
import { EditError } from '../../core/design-edit.ts';
import { ImportError, importSet } from '../../core/import-level.ts';
import { importOps, previewOf } from '../../core/import-preview.ts';
import { pickInfraOwner } from '../../core/infra-owner.ts';
import { rowId, type ItemRow } from '../../core/item-rows.ts';
import { mermaidPlan, resolveTargets } from '../../core/mermaid-edits.ts';
import { componentName, matchParticipants } from '../../core/mermaid-match.ts';
import { parseMermaid, summarize } from '../../core/mermaid-parse.ts';
import { badRequest, conflict, HttpError, notFound } from '../errors.ts';
import { cached } from '../design-rows.ts';
import { getEnvRow, guardEnv } from './envs.ts';
import { appendOps, getDraft, loadOps } from './drafts.ts';
import { envItemRows } from './item-rows.ts';
import { prepareOps } from './draft-validate.ts';

export interface MermaidInput { text: string; matches?: Record<string, unknown>; groupPath?: string }
const MAX_TEXT = 200_000;
const names = (rows: ItemRow[]) => rows.filter((r) => r.list === 'header').map((r) => r.service);

function plan(ctx: Ctx, env: string, slug: string, i: MermaidInput) {
  const { db } = ctx;
  guardEnv(db, env, 'draft');
  const d = getDraft(db, env, slug);
  if (typeof i?.text !== 'string' || !i.text.trim()) throw badRequest('text is required: the Mermaid sequenceDiagram');
  if (i.text.length > MAX_TEXT) throw badRequest(`text is longer than ${MAX_TEXT} characters`);
  if (i.matches !== undefined && (typeof i.matches !== 'object' || i.matches === null || Array.isArray(i.matches))) throw badRequest('matches must be an object: participant id -> component name | {create} | {fromSource} | {client}');
  if (i.groupPath !== undefined && typeof i.groupPath !== 'string') throw badRequest('groupPath must be a string');
  const env0 = getEnvRow(db, env)!, groups = (JSON.parse(env0.groups) as { key: string }[]).map((g) => g.key);
  if (i.groupPath && !groups.includes(i.groupPath)) throw new HttpError(422, 'NO_GROUP', `groupPath '${i.groupPath}' is not one of this environment's subsystems (${groups.join(', ') || 'none'})`);
  const envRows = envItemRows(db, env), base = overlayRows(envRows, netOps(loadOps(db, d.id)));
  const source = env0.source && getEnvRow(db, env0.source) ? env0.source : null;
  const srcRows = source ? cached<ItemRow[]>(`rows:${source}`, [source], () => envItemRows(db, source)) : [];

  const parsed = parseMermaid(i.text);
  const rows = matchParticipants(parsed.participants, names(base), names(srcRows));
  const r = resolveTargets(rows, i.matches);

  // components copied from the source first (one level, the same rules as POST .../import)
  const imports: { component: string; source: string; preview: ReturnType<typeof previewOf>; ops: DraftOpInput[]; origins: OpOrigin[] }[] = [];
  let here = base;
  for (const f of r.fromSource) {
    if (imports.some((x) => x.component === f.name) || names(here).includes(f.name)) continue;
    if (!source) throw new HttpError(422, 'NO_SOURCE', `'${f.name}' cannot be imported: this environment has no source environment`);
    try {
      const set = importSet({
        source, anchor: `svc:${f.name}`, srcRows, srcGraph: ctx.view(source).g,
        srcVersions: new Map(srcRows.filter((x) => x.list === 'header').map((x) => [x.service, Number(x.data?.version) || 0])),
        here, groups, groupPath: i.groupPath, infraOwner: pickInfraOwner(here, srcRows, source),
      });
      const { ops, origins } = importOps(set);
      const map = new Map(here.map((x) => [rowId(x), x]));
      for (const o of ops) applyOp(map, { ...o, ...opRow(o) } as any);
      here = [...map.values()];
      imports.push({ component: f.name, source, preview: previewOf(set, `svc:${f.name}`, source), ops, origins });
    } catch (e) {
      if (e instanceof ImportError) throw new HttpError(422, e.code, `'${f.name}': ${e.message}`);
      throw e;
    }
  }
  let mp: ReturnType<typeof mermaidPlan>;
  try { mp = mermaidPlan(parsed, r.targets, here, { groupPath: i.groupPath }); } catch (e) {
    if (e instanceof EditError) throw new HttpError(422, e.code, e.message, e.field ? { field: e.field } : undefined);
    throw e;
  }
  const all = [...imports.flatMap((x) => x.ops), ...mp.ops];
  if (all.length) prepareOps(new Map(base.map((x) => [rowId(x), x])), all, { groups });   // what append would refuse, said before anything is written
  return { d, parsed, rows, r, imports, mp, all, groups, components: names(base), source };
}

const out = (p: ReturnType<typeof plan>) => ({
  title: p.parsed.title ?? null, description: p.parsed.description ?? null, summary: summarize(p.parsed),
  participants: p.rows.map((x) => ({ ...x, choice: p.r.choices[x.id], createName: componentName(x.source ?? x.label) })), matches: p.r.choices, components: p.components, source: p.source,
  creates: p.mp.creates, imports: p.imports.map((x) => ({ component: x.component, source: x.source, counts: x.preview.counts, total: x.preview.total })),
  counts: p.mp.counts, undecided: p.mp.undecided, flow: p.mp.flow, edits: p.mp.edits, ops: p.all.length,
  warnings: [...p.parsed.warnings, ...p.r.warnings.map((text) => ({ text })), ...p.mp.warnings],
});

/** What importing `text` would do: the matches, the edits, the counts and the warnings. Writes nothing. */
export const mermaidPreview = (ctx: Ctx, env: string, slug: string, i: MermaidInput) => out(plan(ctx, env, slug, i));

/** Import it: all the ops in one transaction, as one batch (`origin.batch`). The caller drops the draft's cached view (ctx.changedDraft). */
export function mermaidImport(ctx: Ctx, env: string, slug: string, i: MermaidInput, who: { author?: string; byAi?: boolean } = {}) {
  return tx(ctx.db, () => {
    const p = plan(ctx, env, slug, i), body = out(p);
    if (!p.mp.flow) throw new HttpError(422, 'NO_MESSAGES', p.mp.warnings[0]?.text ?? 'the diagram has no message that can start a flow');
    if (!p.all.length) return { ...body, batch: null, added: 0, from: null, to: null };
    const batch = randomBytes(4).toString('hex');
    const origins: OpOrigin[] = [...p.imports.flatMap((x) => x.origins.map((o) => ({ ...o, batch }))), ...p.mp.ops.map(() => ({ kind: 'mermaid' as const, batch }))];
    const res = appendOps(ctx.db, env, slug, p.all, { ...who, origins });
    return { ...body, batch, added: p.all.length, from: res.from, to: res.to, draftCounts: res.counts };
  });
}

/** Remove one import's ops (a 409 DEPENDENT_OPS listing the blocking ops when a later op touches what it made). */
export function undoMermaid(ctx: Ctx, env: string, slug: string, batch: string) {
  return tx(ctx.db, () => {
    guardEnv(ctx.db, env, 'draft');
    const d = getDraft(ctx.db, env, slug), ops = loadOps(ctx.db, d.id);
    const mine = ops.filter((o) => (o.origin as { batch?: string } | undefined)?.batch === batch);
    if (!mine.length) throw notFound(`Mermaid import '${batch}' in draft '${slug}'`);
    const first = mine[0].seq, ids = new Set(mine.map((o) => rowId(o)));
    const created = new Set(mine.filter((o) => o.list === 'header' && o.op === 'upsert').map((o) => o.service));
    const keys = new Set(mine.filter((o) => o.list === 'ingress' && o.op === 'upsert').map((o) => o.data?.bindKey).filter(Boolean));
    const blocking = ops.filter((o) => !mine.includes(o) && o.seq > first && (ids.has(rowId(o)) || created.has(o.service) || (o.list === 'egress' && keys.has(o.data?.bindKey))))
      .map((o) => ({ seq: o.seq, op: o.op, anchor: o.anchor, author: o.author }));
    if (blocking.length) throw conflict('DEPENDENT_OPS', `${blocking.length} later op(s) in the draft depend on this import (${blocking[0].anchor}${blocking.length > 1 ? ` and ${blocking.length - 1} more` : ''}): undo or revert them first`, { blocking });
    const del = ctx.db.prepare('DELETE FROM draft_ops WHERE draft_id = ? AND seq = ?');
    for (const o of mine) del.run(d.id, o.seq);
    ctx.db.prepare('UPDATE drafts SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), d.id);
    return { batch, removed: mine.length };
  });
}
