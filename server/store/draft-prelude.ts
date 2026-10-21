// The prelude of a dry run `?draft=<slug>`: apply the draft inside the dry run's transaction first, so what is being checked
// (manifests, DTOs) meets the environment as that open draft would leave it. A draft that changes nothing is simply skipped.

import type { DB } from '../db/connection.ts';
import { HttpError, badRequest } from '../errors.ts';
import { applyDraftIn } from './draft-apply.ts';

export function draftPrelude(db: DB, manifests: { env?: string }[], slug: string): () => void {
  const envs = new Set(manifests.map((m) => m?.env ?? 'default'));
  if (envs.size !== 1) throw badRequest('with a draft, all manifests must name the draft\'s environment (env)');
  const env = [...envs][0];
  return () => {
    try { applyDraftIn(db, env, slug, { by: 'dry-run', source: 'api', dryRun: true }); }
    catch (e) { if (!(e instanceof HttpError && e.code === 'DRAFT_EMPTY')) throw e; }
  };
}
