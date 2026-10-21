// Environments: metadata, create by copy, neighbours, components of a source, delete (design only). See docs/API.md.
// GET /api/envs (names only) stays in queries.ts: the preview and harvester scripts depend on its shape.

import type { Router } from '../http/router.ts';
import { created } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { carryRows, neighbours } from '../../core/neighbours.ts';
import { copyEnv } from '../store/env-copy.ts';
import { deleteEnv, getEnv, listEnvMeta } from '../store/envs.ts';
import { loadModel } from '../store/snapshots-read.ts';

export function dtoCounts(ctx: Ctx, env: string): Record<string, number> {
  const rows = ctx.db.prepare('SELECT service, count(*) AS n FROM endpoint_dtos WHERE env = ? GROUP BY service').all(env) as { service: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.service, r.n]));
}

export function registerEnvs(r: Router, ctx: Ctx) {
  const { db } = ctx;

  r.get('/api/envs/meta', () => listEnvMeta(db));

  r.post('/api/envs', async (req) => {
    const out = copyEnv(db, await req.json());
    ctx.changed(out.name);
    return created(out);
  });

  r.get('/api/envs/:env/meta', (req) => getEnv(db, req.params.env));

  /** The components of an environment with what each would bring into a Components copy. */
  r.get('/api/envs/:env/components', (req) => {
    getEnv(db, req.params.env);
    return carryRows(loadModel(db, req.params.env), dtoCounts(ctx, req.params.env));
  });

  r.get('/api/envs/:env/neighbours', (req) => {
    getEnv(db, req.params.env);
    return neighbours(ctx.graph(req.params.env), (req.query.get('services') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  });

  r.delete('/api/envs/:env', (req) => {
    const out = deleteEnv(db, req.params.env);
    ctx.changed(req.params.env);
    return out;
  });
}
