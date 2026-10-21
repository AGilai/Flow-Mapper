// References of a design environment on the server (definition: core/references.ts), and the decoration of a trace with them.
// A sealed environment has none: its traces and entry points are returned as they are (plus a flow name where one is set).

import type { Ctx } from './context.ts';
import { decorateDesignTrace, refsReached } from '../core/flow-refs.ts';
import { decorateEntries } from '../core/flow-text.ts';
import { originsOf, referencesOf, type EnvRefs } from '../core/references.ts';
import { entryPoints, type Trace } from '../core/trace.ts';
import { notFound } from './errors.ts';
import { designRows, type DesignRows } from './design-rows.ts';
import { checkFresh, memoGet, memoSet } from './graph-cache.ts';
import { getEnvRow } from './store/envs.ts';

export const NO_REFS: EnvRefs = { endpoints: {}, components: {}, origins: {} };

/** The references of an environment, as read with `draft` (an open draft's slug) laid over it. Memoised; empty for a sealed environment. */
export function refsFor(ctx: Ctx, env: string, draft: string | null, rows?: DesignRows): EnvRefs {
  checkFresh(ctx.db);
  const key = `${env}|${draft ?? ''}|refs`;
  const hit = memoGet<EnvRefs>(key);
  if (hit) return hit;
  const row = getEnvRow(ctx.db, env);
  if (!row) throw notFound(`environment '${env}'`);
  if (row.kind === 'sealed') return memoSet(key, NO_REFS, [env]);
  const d = rows ?? designRows(ctx, env, draft);
  return memoSet(key, referencesOf(d.cur, originsOf(d.stored, d.imported), row.copied_at), d.deps);
}

/** A trace as the reader should get it: in a design environment decorated with references (`reference`, `partial`, `serviceKind`). */
export function designTrace(ctx: Ctx, env: string, draft: string | null, t: Trace) {
  if (getEnvRow(ctx.db, env)?.kind !== 'design') return t;
  const g = ctx.view(env, draft).g;
  return decorateDesignTrace(t, refsFor(ctx, env, draft), (s) => g.services.get(s)?.kind);
}

/** A trace for a reader: the flow's name on `start` where one is set, then (design environments) the reference decoration. */
export function traceOut(ctx: Ctx, env: string, draft: string | null, t: Trace) {
  const name = t.start.ingress ? ctx.view(env, draft).reader.flowText(t.start.service, t.start.ingress)?.name : undefined;
  return designTrace(ctx, env, draft, name ? { ...t, start: { ...t.start, name } } as Trace : t);
}

/** The flow names of an environment (or of it as a draft would leave it), by `<service>/<ingress>`: the plain reads use the same names the draft reads do. */
export function flowNameMap(ctx: Ctx, env: string, draft: string | null): Map<string, string> {
  return new Map([...ctx.view(env, draft).reader.flowTexts()].flatMap(([k, t]) => (t.name ? [[k, t.name] as [string, string]] : [])));
}

/** Entry points with their flow's `name` and `summary` (first 140 characters of its description) where set; in a design environment
 *  also `reference: true` (the entry itself is a reference) and `partial: n` (reference endpoints its flow reaches). */
export function entryPointsOut(ctx: Ctx, env: string, draft: string | null) {
  const { g, reader } = ctx.view(env, draft);
  const texts = reader.flowTexts();
  const design = getEnvRow(ctx.db, env)?.kind === 'design';
  const refs = design ? refsFor(ctx, env, draft) : NO_REFS, reached = design ? refsReached(g, refs) : new Map<string, number>();
  return decorateEntries(entryPoints(g), texts, refs, reached);
}
