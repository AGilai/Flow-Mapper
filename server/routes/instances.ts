// Redis instances (#29): the instance page, and the key templates pushed per instance. See docs/API.md.
// `:id` is the instance key (`redis:cache-main`, URL-encoded), the defining resource's id, or the bare name.

import type { Router } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { badRequest } from '../errors.ts';
import { instances } from '../../core/instances.ts';
import * as keys from '../store/keys.ts';

/** `?db=` as a database index; absent or empty means all. */
export function dbParam(v: string | null | undefined): number | undefined {
  if (v == null || v === '') return undefined;
  if (!/^\d+$/.test(String(v))) throw badRequest('db must be a database index (an integer >= 0)');
  return Number(v);
}

export function registerInstances(r: Router, ctx: Ctx) {
  const { db } = ctx;

  r.get('/api/envs/:env/instances', (req) => instances(ctx.graph(req.params.env), keys.allSummaries(db, req.params.env)));

  r.get('/api/envs/:env/instances/:id', (req) => keys.readInstance(db, ctx.graph(req.params.env), req.params.env, req.params.id));

  r.get('/api/envs/:env/resources/:id/keys', (req) => keys.readKeys(db, ctx.graph(req.params.env), req.params.env, req.params.id,
    { db: dbParam(req.query.get('db')), q: req.query.get('q') ?? undefined, problems: ['1', 'true'].includes(req.query.get('problems') ?? '') }));

  r.put('/api/envs/:env/resources/:id/keys', async (req) => keys.putKeys(db, ctx.graph(req.params.env), req.params.env, req.params.id, await req.json()));
}
