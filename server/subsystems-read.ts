// Reads of the subsystem level: the subsystems of an environment, its roll-up map and its abstract links, for the environment as stored or
// as an open draft would leave it. Memoised per (env, draft) like the marks; any write to the environment or the draft drops them.

import type { Ctx } from './context.ts';
import type { AbstractView } from '../core/abstract-links.ts';
import { suggestRefinements, type Suggestion } from '../core/link-suggest.ts';
import type { ItemRow } from '../core/item-rows.ts';
import { rollUp, type SubsystemMap } from '../core/subsystem-rollup.ts';
import { subsystemsOf, type SubsystemInfo } from '../core/subsystems.ts';
import { notFound } from './errors.ts';
import { designRows } from './design-rows.ts';
import { checkFresh, memoGet, memoSet } from './graph-cache.ts';
import { requireEnv } from './store/envs.ts';
import { getDraft } from './store/drafts.ts';

interface Loaded { subRows: ItemRow[]; linkRows: ItemRow[] }
const pick = (rows: ItemRow[]): Loaded => ({ subRows: rows.filter((r) => r.list === 'subsystem'), linkRows: rows.filter((r) => r.list === 'link') });

/** The subsystem and link rows of the environment, with the draft laid over them if given (memoised, so the roll-up memo keeps hitting). */
function loaded(ctx: Ctx, env: string, draft: string | null): Loaded {
  checkFresh(ctx.db);
  requireEnv(ctx.db, env);
  if (draft) getDraft(ctx.db, env, draft);
  const key = `${env}|${draft ?? ''}|sub-rows`;
  return memoGet<Loaded>(key) ?? memoSet(key, pick(designRows(ctx, env, draft).cur), [env]);
}

export function subsystemsFor(ctx: Ctx, env: string, draft: string | null): { levels: string[]; subsystems: SubsystemInfo[]; notSet: string[] } {
  const { subRows } = loaded(ctx, env, draft);
  const g = ctx.view(env, draft).g;
  return { levels: requireEnv(ctx.db, env).levels, subsystems: subsystemsOf(subRows, g.model.services), notSet: g.model.services.filter((s) => !s.groupPath).map((s) => s.name).sort() };
}

export function subsystemMapFor(ctx: Ctx, env: string, draft: string | null): SubsystemMap {
  const key = `${env}|${draft ?? ''}|sub-map`;
  const { subRows, linkRows } = loaded(ctx, env, draft);
  return memoGet<SubsystemMap>(key) ?? memoSet(key, rollUp(ctx.view(env, draft).g, subRows, linkRows), [env]);
}

/** The abstract links (all, or those with an end in `subsystem`). */
export function linksFor(ctx: Ctx, env: string, draft: string | null, subsystem?: string | null): AbstractView[] {
  const all = subsystemMapFor(ctx, env, draft).abstract;
  return subsystem ? all.filter((v) => v.from.subsystem === subsystem || v.to.subsystem === subsystem) : all;
}

export function linkViewFor(ctx: Ctx, env: string, draft: string | null, id: string): AbstractView & { suggestions: Suggestion[] } {
  const map = subsystemMapFor(ctx, env, draft), view = map.abstract.find((v) => v.id === id);
  if (!view) throw notFound(`abstract link '${id}' in '${env}'`);
  const { subRows } = loaded(ctx, env, draft);
  return { ...view, suggestions: suggestRefinements(view, map, ctx.view(env, draft).g, subRows) };
}
