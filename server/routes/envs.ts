// Environments: metadata, create by copy, neighbours, components of a source, delete (design only). See docs/API.md.
// GET /api/envs (names only) stays in queries.ts: the preview and harvester scripts depend on its shape.

import type { Router } from '../http/router.ts';
import { created } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { carryRows, neighbours } from '../../core/neighbours.ts';
import { copyEnv } from '../store/env-copy.ts';
import { deleteEnv, getEnv, listEnvMeta, requireEnv } from '../store/envs.ts';
import { setEnvColor } from '../store/env-color.ts';
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

  /** The env colour: {color: 1..10} or {color: null} for automatic. Allowed on every environment (an annotation). */
  r.put('/api/envs/:env/color', async (req) => {
    const out = setEnvColor(db, req.params.env, (await req.json())?.color);
    ctx.changed(req.params.env);
    return out;
  });

  r.get('/api/envs/:env/meta', (req) => getEnv(db, req.params.env));

  /** The components of an environment with what each would bring into a Components copy. */
  r.get('/api/envs/:env/components', (req) => {
    requireEnv(db, req.params.env);
    if (!req.query.get('draft')) return carryRows(loadModel(db, req.params.env), dtoCounts(ctx, req.params.env));
    const counts: Record<string, number> = {};
    for (const d of ctx.readerOf(req).listDtos()) counts[d.service] = (counts[d.service] ?? 0) + 1;
    return carryRows(ctx.graphOf(req).model, counts);
  });

  r.get('/api/envs/:env/neighbours', (req) => {
    requireEnv(db, req.params.env);
    return neighbours(ctx.graphOf(req), (req.query.get('services') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  });

  r.delete('/api/envs/:env', (req) => {
    const out = deleteEnv(db, req.params.env);
    ctx.changed(req.params.env);
    return out;
  });
}
