// Reads of the flow relations (0.28.2, #50) of a design environment, as stored or as an open draft would leave them. A sealed environment has none.

import type { Ctx } from './context.ts';
import { relationsOf, type RelationView } from '../core/flow-relations.ts';
import { designRows } from './design-rows.ts';
import { checkFresh } from './graph-cache.ts';
import { requireEnv } from './store/envs.ts';
import { getDraft } from './store/drafts.ts';

/** All relations of the environment, or those of one flow (`service` + `ingress`, from either end), or of one `type`. */
export function relationsFor(ctx: Ctx, env: string, draft: string | null, q: { service?: string | null; ingress?: string | null; type?: string | null } = {}): RelationView[] {
  checkFresh(ctx.db);
  if (requireEnv(ctx.db, env).kind !== 'design') return [];
  if (draft) getDraft(ctx.db, env, draft);
  return relationsOf(designRows(ctx, env, draft).cur, q.service && q.ingress ? { service: q.service, ingress: q.ingress } : null, q.type || null);
}
